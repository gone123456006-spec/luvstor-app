const express = require('express');
const {
  User,
  Report,
  SupportTicket,
  Call,
  Referral,
  Friendship,
  Message,
  DeviceToken,
} = require('../models/app');
const {
  asyncHandler,
  HttpError,
  toObjectId,
  escapeRegex,
  pageParams,
  cleanText,
  oneOf,
  daysAgo,
  startOfUtcDay,
} = require('../lib/http');
const { audit } = require('../lib/audit');
const { cached, invalidate } = require('../lib/cache');
const { mainApi } = require('../lib/mainApi');
const { LIST_FIELDS, listUser, loadUserRefs, accountStatus, PAID_PLANS } = require('../lib/users');
const { requirePermission } = require('../middleware/auth');
const { revokeAppSessions } = require('../lib/sessions');
const { appInfoForUsers } = require('../lib/appVersions');

const APP_VERSION_FIELDS = 'appVersion appBuild appPlatform appVersionSeenAt';

const router = express.Router();
const MAX_MS = 15_000;
const MAX_TOKEN_ADJUST = 10_000;

function buildSearchFilter(q) {
  const text = String(q || '').trim();
  if (!text) return {};
  if (/^[a-f0-9]{24}$/i.test(text)) return { _id: toObjectId(text) };
  if (/^[A-Za-z]{4}\d{4}$/.test(text)) return { publicId: text.toUpperCase() };
  const safe = escapeRegex(text.slice(0, 100));
  if (text.includes('@')) return { email: { $regex: `^${safe.toLowerCase()}` } };
  return { $or: [{ name: { $regex: safe, $options: 'i' } }, { email: { $regex: `^${safe.toLowerCase()}` } }] };
}

function statusFilter(status) {
  switch (status) {
    case 'active':
      return { isDeactivated: { $ne: true }, deletionScheduledAt: null };
    case 'banned':
      return {
        $or: [{ isBanned: true }, { isDeactivated: true, deletionReason: { $regex: '^moderation:' } }],
      };
    case 'deleting':
      return { deletionScheduledAt: { $ne: null } };
    case 'deactivated':
      return { isDeactivated: true };
    default:
      return {};
  }
}

router.get(
  '/',
  requirePermission('users.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const parts = [
      buildSearchFilter(req.query.q),
      statusFilter(oneOf(req.query.status, ['active', 'banned', 'deleting', 'deactivated'], 'all')),
    ].filter((p) => Object.keys(p).length);
    // Search and status can both use $or, so combine them with $and
    const filter = parts.length > 1 ? { $and: parts } : { ...(parts[0] || {}) };
    const provider = oneOf(req.query.provider, ['google', 'email'], '');
    if (provider) filter.authProvider = provider;
    const verification = oneOf(req.query.verification, ['none', 'pending', 'approved', 'rejected'], '');
    if (verification) filter['photoVerification.status'] = verification;
    const plan = oneOf(req.query.plan, ['paid', ...PAID_PLANS], '');
    if (plan) {
      filter.subscriptionPlan = plan === 'paid' ? { $in: PAID_PLANS } : plan;
      filter.subscriptionExpiresAt = { $gt: new Date() };
    }
    const sort = oneOf(req.query.sort, ['newest', 'oldest', 'lastSeen', 'tokens'], 'newest');
    const sortSpec = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      lastSeen: { lastSeen: -1 },
      tokens: { tokenBalance: -1 },
    }[sort];

    const [rows, total] = await Promise.all([
      User.find(filter)
        .select(`${LIST_FIELDS} ${APP_VERSION_FIELDS}`)
        .sort(sortSpec)
        .skip(skip)
        .limit(limit)
        .lean()
        .maxTimeMS(MAX_MS),
      User.countDocuments(filter).maxTimeMS(MAX_MS),
    ]);
    const appInfo = await appInfoForUsers(rows).catch(() => new Map());
    res.json({
      users: rows.map((u) => ({ ...listUser(u), app: appInfo.get(String(u._id)) || null })),
      page,
      limit,
      total,
    });
  }),
);

router.get(
  '/summary',
  requirePermission('users.view'),
  asyncHandler(async (_req, res) => {
    const data = await cached('users:summary', 30_000, async () => {
      const notGone = { deletionScheduledAt: null, isDeactivated: { $ne: true } };
      const [total, onlineNow, active24h, active7d, active30d, newToday, banned, completed] = await Promise.all([
        User.estimatedDocumentCount(),
        User.countDocuments({ isOnline: true, lastSeen: { $gte: daysAgo(1 / 24) } }).maxTimeMS(MAX_MS),
        User.countDocuments({ ...notGone, lastSeen: { $gte: daysAgo(1) } }).maxTimeMS(MAX_MS),
        User.countDocuments({ ...notGone, lastSeen: { $gte: daysAgo(7) } }).maxTimeMS(MAX_MS),
        User.countDocuments({ ...notGone, lastSeen: { $gte: daysAgo(30) } }).maxTimeMS(MAX_MS),
        User.countDocuments({ createdAt: { $gte: startOfUtcDay() } }).maxTimeMS(MAX_MS),
        User.countDocuments(statusFilter('banned')).maxTimeMS(MAX_MS),
        User.countDocuments({ profileCompleted: true }).maxTimeMS(MAX_MS),
      ]);
      return { total, onlineNow, active24h, active7d, active30d, newToday, banned, profileCompleted: completed };
    });
    res.json(data);
  }),
);

router.get(
  '/:id',
  requirePermission('users.view'),
  asyncHandler(async (req, res) => {
    const id = toObjectId(req.params.id);
    const user = await User.findById(id)
      .select(
        '-engagementNudges -discoveryPrefs -explorePrefs -notificationPrefs -location -spinWindowStartedAt ' +
          '-spinCycleDay -spinCycleDate -subscriptionSpinsUsedToday -subscriptionSpinsDate -spinTokensWonToday',
      )
      .lean();
    if (!user) throw new HttpError(404, 'User not found');

    const [
      reportsReceived,
      reportsMade,
      recentReports,
      friends,
      matches,
      blockedBy,
      calls,
      recentCalls,
      messagesSent,
      devices,
      tickets,
      referralsMade,
      referredByRef,
    ] = await Promise.all([
      Report.countDocuments({ reportedUserId: id }),
      Report.countDocuments({ reporterId: id }),
      Report.find({ $or: [{ reportedUserId: id }, { reporterId: id }] }).sort({ createdAt: -1 }).limit(10).lean(),
      Friendship.countDocuments({ $or: [{ userA: id }, { userB: id }], status: 'friends' }),
      Friendship.countDocuments({ $or: [{ userA: id }, { userB: id }], status: 'mutual_match' }),
      Friendship.countDocuments({ $or: [{ userA: id }, { userB: id }], status: 'blocked', blockedBy: { $ne: id } }),
      Call.countDocuments({ $or: [{ callerId: id }, { calleeId: id }] }),
      Call.find({ $or: [{ callerId: id }, { calleeId: id }] }).sort({ startedAt: -1 }).limit(10).lean(),
      Message.countDocuments({ senderId: id }).maxTimeMS(MAX_MS),
      DeviceToken.find({ userId: id }).sort({ lastUsedAt: -1 }).limit(10).select('-token').lean(),
      SupportTicket.find({ userId: id }).sort({ createdAt: -1 }).limit(10).lean(),
      Referral.countDocuments({ referrerId: id, status: 'rewarded' }),
      user.referredBy ? loadUserRefs(User, [user.referredBy]) : Promise.resolve(new Map()),
    ]);

    const refs = await loadUserRefs(User, [
      ...recentReports.flatMap((r) => [r.reporterId, r.reportedUserId]),
      ...recentCalls.flatMap((c) => [c.callerId, c.calleeId]),
    ]);

    const appInfo = await appInfoForUsers([user]).catch(() => new Map());

    await audit(req, 'users.view', { targetType: 'user', targetId: id });

    res.json({
      app: appInfo.get(String(user._id)) || null,
      user: {
        ...listUser(user),
        bio: user.bio || '',
        interests: user.interests || [],
        relationshipGoal: user.relationshipGoal || '',
        height: user.height ?? null,
        coverPhoto: user.coverPhoto || '',
        photos: user.photos || [],
        showMe: user.showMe || '',
        isVerified: !!user.isVerified,
        photoVerificationDetail: user.photoVerification || {},
        openStreakDays: user.openStreakDays || 0,
        lastOpenDate: user.lastOpenDate || null,
        activeDeviceId: user.activeDeviceId ? `…${String(user.activeDeviceId).slice(-6)}` : null,
        activeDeviceBoundAt: user.activeDeviceBoundAt || null,
        subscriptionPlanRaw: user.subscriptionPlan || 'free',
        subscriptionExpiresAt: user.subscriptionExpiresAt || null,
        tokenPack10PurchaseCount: user.tokenPack10PurchaseCount || 0,
        welcomeTokensGrantedAt: user.welcomeTokensGrantedAt || null,
        photoVerificationTokensGrantedAt: user.photoVerificationTokensGrantedAt || null,
        referralCode: user.referralCode || '',
        referredBy: user.referredBy ? referredByRef.get(String(user.referredBy)) || null : null,
        deletionScheduledAt: user.deletionScheduledAt || null,
        deletionReason: user.deletionReason || '',
        isBanned: user.isBanned === true,
        bannedAt: user.bannedAt || null,
        banReason: user.banReason || '',
        updatedAt: user.updatedAt || null,
      },
      stats: { reportsReceived, reportsMade, friends, matches, blockedBy, calls, messagesSent, referralsMade },
      reports: recentReports.map((r) => ({
        id: String(r._id),
        reason: r.reason,
        details: r.details || '',
        status: r.status,
        actionTaken: r.actionTaken,
        createdAt: r.createdAt,
        reporter: refs.get(String(r.reporterId)) || null,
        reported: refs.get(String(r.reportedUserId)) || null,
      })),
      calls: recentCalls.map((c) => ({
        id: c.callId,
        type: c.callType,
        status: c.status,
        endReason: c.endReason || '',
        durationSec: c.durationSec || 0,
        startedAt: c.startedAt,
        direction: String(c.callerId) === String(id) ? 'outgoing' : 'incoming',
        other: refs.get(String(String(c.callerId) === String(id) ? c.calleeId : c.callerId)) || null,
      })),
      devices: devices.map((d) => ({
        id: String(d._id),
        platform: d.platform,
        deviceName: d.deviceName || '',
        appVersion: d.appVersion || '',
        active: !!d.active,
        lastUsedAt: d.lastUsedAt,
      })),
      tickets: tickets.map((t) => ({
        id: String(t._id),
        ticketNumber: t.ticketNumber,
        subject: t.subject,
        category: t.category,
        status: t.status,
        createdAt: t.createdAt,
      })),
    });
  }),
);

async function loadTarget(req) {
  const id = toObjectId(req.params.id);
  const user = await User.findById(id)
    .select('email isBanned isDeactivated deletionReason deletionScheduledAt tokenBalance subscriptionPlan subscriptionExpiresAt')
    .lean();
  if (!user) throw new HttpError(404, 'User not found');
  return { id, user };
}

router.post(
  '/:id/ban',
  requirePermission('users.ban'),
  asyncHandler(async (req, res) => {
    const { id, user } = await loadTarget(req);
    const reason = cleanText(req.body?.reason, 300);
    if (!reason) throw new HttpError(400, 'A reason is required');
    if (user.isBanned === true) throw new HttpError(409, 'User is already blocked');
    // The app backend sets the ban, refuses future sign-ins and revokes live sessions
    await mainApi(`/api/admin/users/${id}/ban`, { method: 'POST', body: { reason } });
    invalidate('overview');
    invalidate('users:summary');
    await audit(req, 'users.ban', { targetType: 'user', targetId: id, details: { reason, email: user.email } });
    res.json({ ok: true, status: 'banned' });
  }),
);

router.post(
  '/:id/unban',
  requirePermission('users.ban'),
  asyncHandler(async (req, res) => {
    const { id, user } = await loadTarget(req);
    const reason = cleanText(req.body?.reason, 300);
    if (accountStatus(user) !== 'banned') throw new HttpError(409, 'User is not blocked');
    await mainApi(`/api/admin/users/${id}/unban`, { method: 'POST', body: {} });
    invalidate('overview');
    invalidate('users:summary');
    await audit(req, 'users.unban', { targetType: 'user', targetId: id, details: { reason, email: user.email } });
    res.json({ ok: true, status: 'active' });
  }),
);

router.post(
  '/:id/force-logout',
  requirePermission('users.logout'),
  asyncHandler(async (req, res) => {
    const { id, user } = await loadTarget(req);
    await revokeAppSessions(id);
    await audit(req, 'users.force_logout', {
      targetType: 'user',
      targetId: id,
      details: { reason: cleanText(req.body?.reason, 300), email: user.email },
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/tokens',
  requirePermission('users.tokens'),
  asyncHandler(async (req, res) => {
    const { id, user } = await loadTarget(req);
    const amount = Math.trunc(Number(req.body?.amount));
    const reason = cleanText(req.body?.reason, 300);
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_TOKEN_ADJUST) {
      throw new HttpError(400, `Amount must be a non-zero whole number up to ±${MAX_TOKEN_ADJUST}`);
    }
    if (!reason) throw new HttpError(400, 'A reason is required');
    // Deductions are conditional so the balance can never go negative
    const filter = amount < 0 ? { _id: id, tokenBalance: { $gte: -amount } } : { _id: id };
    const updated = await User.findOneAndUpdate(
      filter,
      { $inc: { tokenBalance: amount } },
      { returnDocument: 'after', projection: { tokenBalance: 1 } },
    ).lean();
    if (!updated) throw new HttpError(409, `Balance is only ${user.tokenBalance || 0} tokens`);
    await audit(req, 'users.tokens', {
      targetType: 'user',
      targetId: id,
      details: { amount, reason, before: user.tokenBalance || 0, after: updated.tokenBalance, email: user.email },
    });
    res.json({ ok: true, tokenBalance: updated.tokenBalance });
  }),
);

router.post(
  '/:id/reset-verification',
  requirePermission('users.verification'),
  asyncHandler(async (req, res) => {
    const { id, user } = await loadTarget(req);
    // Grant timestamps are left intact so tokens are never granted twice
    await User.updateOne(
      { _id: id },
      {
        $set: {
          'photoVerification.status': 'none',
          'photoVerification.reviewedAt': new Date(),
          'photoVerification.reviewNote': cleanText(req.body?.reason, 500) || 'Reset by admin',
          'photoVerification.verifiedMainPhoto': '',
          'photoVerification.matchScore': null,
        },
      },
    );
    await audit(req, 'users.reset_verification', { targetType: 'user', targetId: id, details: { email: user.email } });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/restore',
  requirePermission('users.restore'),
  asyncHandler(async (req, res) => {
    const { id, user } = await loadTarget(req);
    if (accountStatus(user) !== 'deleting') throw new HttpError(409, 'User is not scheduled for deletion');
    await User.updateOne(
      { _id: id },
      { $set: { isDeactivated: false, deletionScheduledAt: null, deletionReason: null, reminderSentAt: null } },
    );
    invalidate('overview');
    await audit(req, 'users.restore', { targetType: 'user', targetId: id, details: { email: user.email } });
    res.json({ ok: true, status: 'active' });
  }),
);

module.exports = router;
module.exports.buildSearchFilter = buildSearchFilter;
