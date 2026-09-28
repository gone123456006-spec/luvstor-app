const express = require('express');
const { User, Report, Friendship, Message, DeviceToken } = require('../models/app');
const {
  asyncHandler,
  HttpError,
  toObjectId,
  pageParams,
  cleanText,
  oneOf,
  daysAgo,
  fillDaySeries,
  startOfUtcDay,
} = require('../lib/http');
const { audit } = require('../lib/audit');
const { cached, invalidate } = require('../lib/cache');
const { mainApi } = require('../lib/mainApi');
const { revokeAppSessions } = require('../lib/sessions');
const { loadUserRefs, listUser, LIST_FIELDS } = require('../lib/users');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();
const MAX_MS = 20_000;

const REPORT_STATUSES = ['open', 'reviewed', 'actioned', 'dismissed'];
const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'fake_profile', 'underage', 'other'];
const REPORT_ACTIONS = ['none', 'warned', 'hidden', 'banned', 'dismissed'];

// ── Reports ────────────────────────────────────────────────────────────
router.get(
  '/reports',
  requirePermission('moderation.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const status = oneOf(req.query.status, [...REPORT_STATUSES, 'all'], 'open');
    const reason = oneOf(req.query.reason, REPORT_REASONS, '');
    const filter = {};
    if (status !== 'all') filter.status = status;
    if (reason) filter.reason = reason;
    if (req.query.userId) filter.reportedUserId = toObjectId(req.query.userId);

    const [rows, total] = await Promise.all([
      Report.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().maxTimeMS(MAX_MS),
      Report.countDocuments(filter).maxTimeMS(MAX_MS),
    ]);
    const reportedIds = rows.map((r) => r.reportedUserId).filter(Boolean);
    const [refs, totals] = await Promise.all([
      loadUserRefs(User, rows.flatMap((r) => [r.reporterId, r.reportedUserId])),
      Report.aggregate([
        { $match: { reportedUserId: { $in: reportedIds } } },
        {
          $group: {
            _id: '$reportedUserId',
            total: { $sum: 1 },
            reporters: { $addToSet: '$reporterId' },
          },
        },
      ]).option({ maxTimeMS: MAX_MS }),
    ]);
    const totalMap = new Map(
      totals.map((t) => [String(t._id), { total: t.total, distinctReporters: t.reporters.length }]),
    );

    res.json({
      reports: rows.map((r) => ({
        id: String(r._id),
        reason: r.reason,
        details: r.details || '',
        status: r.status,
        actionTaken: r.actionTaken || 'none',
        moderatorNote: r.moderatorNote || '',
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt || null,
        reporter: refs.get(String(r.reporterId)) || null,
        reported: refs.get(String(r.reportedUserId)) || null,
        reportedHistory: totalMap.get(String(r.reportedUserId)) || { total: 1, distinctReporters: 1 },
      })),
      page,
      limit,
      total,
    });
  }),
);

router.get(
  '/reports/stats',
  requirePermission('moderation.view'),
  asyncHandler(async (_req, res) => {
    const data = await cached('moderation:stats', 60_000, async () => {
      const since = new Date(startOfUtcDay().getTime() - 29 * 86_400_000);
      const [byStatus, openByReason, series] = await Promise.all([
        Report.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        Report.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$reason', n: { $sum: 1 } } }]),
        Report.aggregate([
          { $match: { createdAt: { $gte: since } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        ]),
      ]);
      return {
        byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.n])),
        openByReason: Object.fromEntries(openByReason.map((r) => [r._id, r.n])),
        series: fillDaySeries(series, 30),
      };
    });
    res.json(data);
  }),
);

router.patch(
  '/reports/:id',
  requirePermission('moderation.act'),
  asyncHandler(async (req, res) => {
    const id = toObjectId(req.params.id);
    const status = oneOf(req.body?.status, REPORT_STATUSES, '');
    const actionTaken = oneOf(req.body?.actionTaken, REPORT_ACTIONS, '');
    const moderatorNote = cleanText(req.body?.moderatorNote, 2000);
    if (!status || !actionTaken) throw new HttpError(400, 'status and actionTaken are required');

    const report = await Report.findById(id).select('reportedUserId').lean();
    if (!report) throw new HttpError(404, 'Report not found');

    // Runs the app's own moderation logic (deactivate, block pair, etc.)
    const alsoDeactivate = req.body?.alsoDeactivate === true;
    const result = await mainApi(`/api/admin/reports/${id}`, {
      method: 'PATCH',
      body: { status, actionTaken, moderatorNote, alsoDeactivate },
    });
    // "banned" is handled by the app backend (permanent block + session revoke)
    if (alsoDeactivate && actionTaken !== 'banned') {
      await User.updateOne({ _id: report.reportedUserId }, { $set: { deletionScheduledAt: null } });
      await revokeAppSessions(report.reportedUserId);
    }
    invalidate('moderation:');
    invalidate('overview');
    invalidate('users:summary');
    await audit(req, 'moderation.report', {
      targetType: 'report',
      targetId: id,
      details: { status, actionTaken, moderatorNote, reportedUserId: String(report.reportedUserId) },
    });
    res.json({ ok: true, result });
  }),
);

// ── Photo verification ─────────────────────────────────────────────────
router.get(
  '/verifications',
  requirePermission('moderation.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query, { defaultLimit: 20, maxLimit: 50 });
    const status = oneOf(req.query.status, ['pending', 'approved', 'rejected'], 'pending');
    const filter = { 'photoVerification.status': status };
    const sort = status === 'pending' ? { 'photoVerification.submittedAt': 1 } : { 'photoVerification.reviewedAt': -1 };
    const [rows, total] = await Promise.all([
      User.find(filter)
        .select(`${LIST_FIELDS.replace('photoVerification.status', 'photoVerification')} photos`)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    res.json({
      items: rows.map((u) => ({
        user: listUser(u),
        photos: [u.photo, ...(u.photos || [])].filter(Boolean).slice(0, 7),
        selfieUrl: u.photoVerification?.selfieUrl || '',
        pose: u.photoVerification?.pose || '',
        matchScore: u.photoVerification?.matchScore ?? null,
        submittedAt: u.photoVerification?.submittedAt || null,
        reviewedAt: u.photoVerification?.reviewedAt || null,
        reviewNote: u.photoVerification?.reviewNote || '',
      })),
      page,
      limit,
      total,
    });
  }),
);

router.post(
  '/verifications/:userId',
  requirePermission('moderation.act'),
  asyncHandler(async (req, res) => {
    const userId = toObjectId(req.params.userId);
    const decision = oneOf(req.body?.decision, ['approve', 'reject'], '');
    const reviewNote = cleanText(req.body?.reviewNote, 500);
    if (!decision) throw new HttpError(400, 'decision must be approve or reject');
    if (decision === 'reject' && !reviewNote) throw new HttpError(400, 'A reason is required to reject');
    // App endpoint grants the one-time tokens + sends the notification
    const result = await mainApi(`/api/verification/admin/${userId}`, {
      method: 'PATCH',
      body: { decision, reviewNote },
    });
    invalidate('overview');
    await audit(req, `moderation.verification_${decision}`, {
      targetType: 'user',
      targetId: userId,
      details: { reviewNote },
    });
    res.json({ ok: true, result });
  }),
);

// ── Risk signals ───────────────────────────────────────────────────────
async function loadRisk() {
  const since90 = daysAgo(90);
  const since24h = daysAgo(1);

  const [repeatOffenders, blockedMany, messageBursts, likeBursts, sharedDevices, underageReports, underageProfiles] =
    await Promise.all([
      Report.aggregate([
        { $match: { createdAt: { $gte: since90 } } },
        { $group: { _id: '$reportedUserId', reporters: { $addToSet: '$reporterId' }, total: { $sum: 1 }, last: { $max: '$createdAt' } } },
        { $project: { distinct: { $size: '$reporters' }, total: 1, last: 1 } },
        { $match: { distinct: { $gte: 3 } } },
        { $sort: { distinct: -1, last: -1 } },
        { $limit: 50 },
      ]).option({ maxTimeMS: MAX_MS }),
      Friendship.aggregate([
        { $match: { status: 'blocked', blockedBy: { $ne: null } } },
        { $project: { blocked: { $cond: [{ $eq: ['$blockedBy', '$userA'] }, '$userB', '$userA'] } } },
        { $group: { _id: '$blocked', n: { $sum: 1 } } },
        { $match: { n: { $gte: 3 } } },
        { $sort: { n: -1 } },
        { $limit: 50 },
      ]).option({ maxTimeMS: MAX_MS }),
      Message.aggregate([
        { $match: { createdAt: { $gte: since24h }, type: 'text' } },
        { $group: { _id: '$senderId', n: { $sum: 1 }, rooms: { $addToSet: '$roomId' } } },
        { $project: { n: 1, rooms: { $size: '$rooms' } } },
        { $match: { rooms: { $gte: 20 } } },
        { $sort: { rooms: -1 } },
        { $limit: 30 },
      ]).option({ maxTimeMS: MAX_MS }),
      Friendship.aggregate([
        { $match: { likedAt: { $gte: since24h } } },
        { $group: { _id: '$initiatedBy', n: { $sum: 1 } } },
        { $match: { n: { $gte: 100 } } },
        { $sort: { n: -1 } },
        { $limit: 30 },
      ]).option({ maxTimeMS: MAX_MS }),
      DeviceToken.aggregate([
        { $match: { deviceId: { $nin: [null, ''] } } },
        { $group: { _id: '$deviceId', users: { $addToSet: '$userId' } } },
        { $project: { users: 1, n: { $size: '$users' } } },
        { $match: { n: { $gte: 3 } } },
        { $sort: { n: -1 } },
        { $limit: 30 },
      ]).option({ maxTimeMS: MAX_MS }),
      Report.find({ reason: 'underage', status: 'open' }).sort({ createdAt: 1 }).limit(50).lean(),
      User.find({ age: { $ne: null, $lt: 18 } }).select(LIST_FIELDS).limit(50).lean(),
    ]);

  const refs = await loadUserRefs(User, [
    ...repeatOffenders.map((r) => r._id),
    ...blockedMany.map((r) => r._id),
    ...messageBursts.map((r) => r._id),
    ...likeBursts.map((r) => r._id),
    ...sharedDevices.flatMap((d) => d.users),
    ...underageReports.flatMap((r) => [r.reportedUserId, r.reporterId]),
  ]);
  const ref = (id) => refs.get(String(id)) || { id: String(id), name: '(deleted)', email: '', publicId: '', photo: '', status: 'unknown' };

  return {
    generatedAt: new Date().toISOString(),
    childSafety: {
      openUnderageReports: underageReports.map((r) => ({
        id: String(r._id),
        details: r.details || '',
        createdAt: r.createdAt,
        reported: ref(r.reportedUserId),
        reporter: ref(r.reporterId),
      })),
      underageProfiles: underageProfiles.map(listUser),
    },
    repeatOffenders: repeatOffenders.map((r) => ({ user: ref(r._id), distinctReporters: r.distinct, total: r.total, lastReportAt: r.last })),
    blockedMany: blockedMany.map((r) => ({ user: ref(r._id), blockedBy: r.n })),
    messageBursts: messageBursts.map((r) => ({ user: ref(r._id), messages24h: r.n, conversations24h: r.rooms })),
    likeBursts: likeBursts.map((r) => ({ user: ref(r._id), likes24h: r.n })),
    sharedDevices: sharedDevices.map((d) => ({ deviceId: `…${String(d._id).slice(-6)}`, accounts: d.users.map(ref) })),
  };
}

router.get(
  '/risk',
  requirePermission('moderation.view'),
  asyncHandler(async (_req, res) => {
    res.json(await cached('moderation:risk', 5 * 60_000, loadRisk));
  }),
);

module.exports = router;
