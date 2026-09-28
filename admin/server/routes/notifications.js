const express = require('express');
const rateLimit = require('express-rate-limit');
const { User } = require('../models/app');
const { Campaign } = require('../models/admin');
const { asyncHandler, HttpError, cleanText, oneOf, toObjectId, pageParams } = require('../lib/http');
const { audit } = require('../lib/audit');
const { mainApi } = require('../lib/mainApi');
const { segmentFilter, audienceQuery, segmentList } = require('../lib/segments');
const { loadUserRefs } = require('../lib/users');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

// Mirrors backend/models/Notification.js NOTIFICATION_TYPES (sendable subset)
const SENDABLE_TYPES = ['system', 'promo', 'subscription', 'token', 'security', 'suggestion'];
const MAX_RECIPIENTS = 1000;

const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  // Always mounted after requirePermission, so req.admin is set
  keyGenerator: (req) => `admin:${req.admin._id}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Send limit reached (30/hour). Try again later.' },
});

function readMessage(body) {
  const type = oneOf(body?.type, SENDABLE_TYPES, '');
  const title = cleanText(body?.title, 200);
  const text = cleanText(body?.body, 1000);
  const deepLink = cleanText(body?.deepLink, 300);
  if (!type) throw new HttpError(400, `type must be one of: ${SENDABLE_TYPES.join(', ')}`);
  if (!title) throw new HttpError(400, 'Title is required');
  if (deepLink && !/^(\/|luvstor:\/\/)/.test(deepLink)) {
    throw new HttpError(400, 'Deep link must start with / or luvstor://');
  }
  return { type, title, body: text, deepLink };
}

router.get(
  '/meta',
  requirePermission('notifications.view'),
  asyncHandler(async (_req, res) => {
    res.json({ types: SENDABLE_TYPES, segments: segmentList() });
  }),
);

router.get(
  '/audience',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const query = audienceQuery(String(req.query.segment || ''));
    if (!query) throw new HttpError(400, 'Unknown segment');
    const count = await User.countDocuments(query).maxTimeMS(20_000);
    res.json({ segment: req.query.segment, count });
  }),
);

/** Resolve a mixed list of ids / public IDs / emails to app user ids. */
async function resolveRecipients(list) {
  const items = [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,]+/))
    .map((s) => String(s).trim())
    .filter(Boolean))];
  if (!items.length) throw new HttpError(400, 'Add at least one recipient');
  if (items.length > MAX_RECIPIENTS) throw new HttpError(400, `Max ${MAX_RECIPIENTS} recipients per send`);
  const ids = items.filter((s) => /^[a-f0-9]{24}$/i.test(s));
  const publicIds = items.filter((s) => /^[A-Za-z]{4}\d{4}$/.test(s)).map((s) => s.toUpperCase());
  const emails = items.filter((s) => s.includes('@')).map((s) => s.toLowerCase());
  const users = await User.find({
    $or: [{ _id: { $in: ids } }, { publicId: { $in: publicIds } }, { email: { $in: emails } }],
  })
    .select('_id')
    .lean();
  return { userIds: users.map((u) => String(u._id)), requested: items.length };
}

router.post(
  '/send',
  requirePermission('notifications.send'),
  sendLimiter,
  asyncHandler(async (req, res) => {
    const message = readMessage(req.body);
    const { userIds, requested } = await resolveRecipients(req.body?.recipients);
    if (!userIds.length) throw new HttpError(404, 'No matching users found');
    const result = await mainApi('/api/notifications/send', {
      method: 'POST',
      body: { ...message, userIds },
    });
    await audit(req, 'notifications.send', {
      targetType: 'users',
      targetId: userIds.length === 1 ? userIds[0] : '',
      details: { ...message, recipients: userIds.length, requested },
    });
    res.json({ ok: true, matched: userIds.length, requested, result });
  }),
);

router.post(
  '/broadcast',
  requirePermission('notifications.send'),
  sendLimiter,
  asyncHandler(async (req, res) => {
    const message = readMessage(req.body);
    const segment = String(req.body?.segment || '');
    const filter = segmentFilter(segment);
    if (!filter) throw new HttpError(400, 'Unknown segment');
    if (req.body?.confirm !== 'SEND') throw new HttpError(400, 'Type SEND to confirm a broadcast');
    const audience = await User.countDocuments(audienceQuery(segment));
    await mainApi('/api/notifications/broadcast', { method: 'POST', body: { ...message, filter } });
    await audit(req, 'notifications.broadcast', { targetType: 'segment', targetId: segment, details: { ...message, audience } });
    res.json({ ok: true, accepted: true, audience });
  }),
);

// ── Scheduled campaigns ────────────────────────────────────────────────
function campaignView(c) {
  return {
    id: String(c._id),
    title: c.title,
    body: c.body,
    type: c.type,
    deepLink: c.deepLink,
    segment: c.segment,
    sendAt: c.sendAt,
    status: c.status,
    createdByEmail: c.createdByEmail,
    audienceAtSend: c.audienceAtSend,
    error: c.error,
    sentAt: c.sentAt,
    createdAt: c.createdAt,
  };
}

router.get(
  '/campaigns',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const [rows, total] = await Promise.all([
      Campaign.find().sort({ sendAt: -1 }).skip(skip).limit(limit).lean(),
      Campaign.countDocuments(),
    ]);
    res.json({ campaigns: rows.map(campaignView), page, limit, total });
  }),
);

router.post(
  '/campaigns',
  requirePermission('notifications.send'),
  asyncHandler(async (req, res) => {
    const message = readMessage(req.body);
    const segment = String(req.body?.segment || '');
    if (!segmentFilter(segment)) throw new HttpError(400, 'Unknown segment');
    const sendAt = new Date(req.body?.sendAt);
    if (Number.isNaN(sendAt.getTime())) throw new HttpError(400, 'Valid send time required');
    if (sendAt.getTime() < Date.now() + 60_000) throw new HttpError(400, 'Send time must be at least 1 minute ahead');
    if (sendAt.getTime() > Date.now() + 90 * 86_400_000) throw new HttpError(400, 'Send time must be within 90 days');
    const campaign = await Campaign.create({
      ...message,
      segment,
      sendAt,
      createdBy: req.admin._id,
      createdByEmail: req.admin.email,
    });
    await audit(req, 'notifications.campaign_create', {
      targetType: 'campaign',
      targetId: campaign._id,
      details: { ...message, segment, sendAt },
    });
    res.status(201).json({ campaign: campaignView(campaign) });
  }),
);

router.post(
  '/campaigns/:id/cancel',
  requirePermission('notifications.send'),
  asyncHandler(async (req, res) => {
    const id = toObjectId(req.params.id);
    const updated = await Campaign.findOneAndUpdate(
      { _id: id, status: 'scheduled' },
      { $set: { status: 'cancelled' } },
      { returnDocument: 'after' },
    ).lean();
    if (!updated) throw new HttpError(409, 'Only scheduled campaigns can be cancelled');
    await audit(req, 'notifications.campaign_cancel', { targetType: 'campaign', targetId: id });
    res.json({ campaign: campaignView(updated) });
  }),
);

// ── Delivery observability (main backend) ─────────────────────────────
router.get(
  '/logs',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const status = oneOf(req.query.status, ['queued', 'sent', 'partial', 'failed', 'skipped'], '');
    const qs = new URLSearchParams({ limit: '100', ...(status ? { status } : {}) });
    const data = (await mainApi(`/api/notifications/admin/logs?${qs}`)) || {};
    const logs = Array.isArray(data.logs) ? data.logs : [];
    const refs = await loadUserRefs(User, logs.map((l) => l.userId));
    res.json({
      fcmEnabled: data.fcmEnabled ?? null,
      // Push tokens are credentials; never forward them to the browser
      logs: logs.map((l) => ({
        id: String(l._id),
        user: refs.get(String(l.userId)) || null,
        type: l.type,
        channel: l.channel,
        status: l.status,
        attempts: l.attempts || 0,
        successCount: l.successCount || 0,
        failureCount: l.failureCount || 0,
        invalidatedTokens: l.invalidatedTokens || 0,
        error: l.error || '',
        errorCodes: [...new Set((l.results || []).map((r) => r.errorCode).filter(Boolean))],
        createdAt: l.createdAt,
        completedAt: l.completedAt || null,
      })),
    });
  }),
);

router.get(
  '/health',
  requirePermission('notifications.view'),
  asyncHandler(async (_req, res) => {
    res.json(await mainApi('/api/notifications/admin/health'));
  }),
);

router.post(
  '/daily-suggestions',
  requirePermission('notifications.send'),
  asyncHandler(async (req, res) => {
    const stats = await mainApi('/api/notifications/admin/daily-suggestions', { method: 'POST', body: {}, timeoutMs: 120_000 });
    await audit(req, 'notifications.daily_suggestions', { details: stats || {} });
    res.json(stats);
  }),
);

module.exports = router;
