/**
 * Notification Center APIs.
 *
 * User endpoints are scoped to req.userId — a caller can never read or mutate
 * another account's notifications. The send/broadcast endpoints additionally
 * require the admin key so the app itself is the only push originator.
 */
const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const {
  readLimiter,
  writeLimiter,
  sendLimiter,
  broadcastLimiter,
} = require('../middleware/rateLimit');
const Notification = require('../models/Notification');
const { NOTIFICATION_TYPES } = require('../models/Notification');
const NotificationLog = require('../models/NotificationLog');
const User = require('../models/User');
const {
  createNotification,
  createBulkNotifications,
  broadcastNotification,
} = require('../services/notifications');
const pushQueue = require('../services/pushQueue');
const fcm = require('../services/fcm');
const { sendDailySuggestions } = require('../jobs/dailySuggestions');

const MAX_PAGE_SIZE = 50;

/** Personal chat DMs are not part of the Notification Center. */
const HIDE_FROM_CENTER = ['chat'];

function centerQuery(extra = {}) {
  return {
    type: { $nin: HIDE_FROM_CENTER },
    ...extra,
  };
}

function isObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function serialize(n) {
  return {
    _id: String(n._id),
    type: n.type,
    title: n.title,
    body: n.body || '',
    imageUrl: n.imageUrl || '',
    deepLink: n.deepLink || '',
    groupKey: n.groupKey || null,
    priority: n.priority || 'normal',
    data: n.data || {},
    actorId: n.actorId ? String(n.actorId) : null,
    actorName: n.actorName || '',
    actorPhoto: n.actorPhoto || '',
    actorGender: n.actorGender || '',
    read: !!n.read,
    createdAt: n.createdAt,
  };
}

/**
 * GET /api/notifications?limit=25&cursor=<ISO>&filter=unread&type=chat
 *
 * Cursor pagination on createdAt — stable while new notifications arrive,
 * unlike skip/offset.
 */
router.get('/', auth, readLimiter, async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 25, 1),
      MAX_PAGE_SIZE,
    );

    const query = centerQuery({ userId: req.userId });

    if (req.query.filter === 'unread') query.read = false;
    if (req.query.type && NOTIFICATION_TYPES.includes(req.query.type)) {
      if (HIDE_FROM_CENTER.includes(req.query.type)) {
        return res.json({
          notifications: [],
          nextCursor: null,
          hasMore: false,
          unread: await Notification.countDocuments(
            centerQuery({ userId: req.userId, read: false }),
          ),
        });
      }
      query.type = req.query.type;
    }

    if (req.query.cursor) {
      const cursor = new Date(req.query.cursor);
      if (Number.isNaN(cursor.getTime())) {
        return res.status(400).json({ error: 'Invalid cursor' });
      }
      query.createdAt = { $lt: cursor };
    }

    // Drop any legacy chat rows so the center stays clean
    Notification.deleteMany({
      userId: req.userId,
      type: { $in: HIDE_FROM_CENTER },
    }).catch(() => {});

    // Fetch one extra row to detect whether another page exists
    const rows = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const unread = await Notification.countDocuments(
      centerQuery({ userId: req.userId, read: false }),
    );

    res.json({
      notifications: items.map(serialize),
      nextCursor: hasMore ? items[items.length - 1].createdAt : null,
      hasMore,
      unread,
    });
  } catch (err) {
    console.error('notifications/list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', auth, readLimiter, async (req, res) => {
  try {
    const unread = await Notification.countDocuments(
      centerQuery({ userId: req.userId, read: false }),
    );
    res.json({ unread });
  } catch (err) {
    console.error('notifications/unread-count error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/notifications/read   { ids?: string[], all?: boolean }
router.post('/read', auth, writeLimiter, async (req, res) => {
  try {
    const { ids, all } = req.body || {};

    if (all === true) {
      const result = await Notification.updateMany(
        centerQuery({ userId: req.userId, read: false }),
        { $set: { read: true, readAt: new Date() } },
      );
      return res.json({ ok: true, all: true, count: result.modifiedCount, unread: 0 });
    }

    const idList = (Array.isArray(ids) ? ids : [])
      .filter((id) => typeof id === 'string' && isObjectId(id))
      .slice(0, 200);

    if (!idList.length) {
      return res.status(400).json({ error: 'Provide ids[] or all:true' });
    }

    const result = await Notification.updateMany(
      { userId: req.userId, _id: { $in: idList }, type: { $nin: HIDE_FROM_CENTER } },
      { $set: { read: true, readAt: new Date() } },
    );

    const unread = await Notification.countDocuments(
      centerQuery({ userId: req.userId, read: false }),
    );

    res.json({ ok: true, count: result.modifiedCount, unread });
  } catch (err) {
    console.error('notifications/read error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/notifications/unread   { ids: string[] }
router.post('/unread', auth, writeLimiter, async (req, res) => {
  try {
    const idList = (Array.isArray(req.body?.ids) ? req.body.ids : [])
      .filter((id) => typeof id === 'string' && isObjectId(id))
      .slice(0, 200);

    if (!idList.length) return res.status(400).json({ error: 'Provide ids[]' });

    await Notification.updateMany(
      { userId: req.userId, _id: { $in: idList } },
      { $set: { read: false, readAt: null } },
    );

    const unread = await Notification.countDocuments(
      centerQuery({ userId: req.userId, read: false }),
    );

    res.json({ ok: true, unread });
  } catch (err) {
    console.error('notifications/unread error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/notifications  — clear all for the caller
router.delete('/', auth, writeLimiter, async (req, res) => {
  try {
    const result = await Notification.deleteMany(
      centerQuery({ userId: req.userId }),
    );
    res.json({ ok: true, deleted: result.deletedCount || 0, unread: 0 });
  } catch (err) {
    console.error('notifications/clear error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/notifications/:id
router.delete('/:id', auth, writeLimiter, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }

    const result = await Notification.deleteOne({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!result.deletedCount) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const unread = await Notification.countDocuments(
      centerQuery({ userId: req.userId, read: false }),
    );

    res.json({ ok: true, unread });
  } catch (err) {
    console.error('notifications/delete error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Per-category push preferences ─────────────────────────────────────────

const PREF_KEYS = [
  'chat',
  'social',
  'calls',
  'wallet',
  'system',
  'promotions',
  'showMessagePreview',
];

// GET /api/notifications/preferences
router.get('/preferences', auth, readLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('notificationPrefs').lean();
    const prefs = user?.notificationPrefs || {};
    res.json({
      preferences: Object.fromEntries(
        PREF_KEYS.map((key) => [key, prefs[key] !== false]),
      ),
    });
  } catch (err) {
    console.error('notifications/preferences error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/notifications/preferences  { chat?: boolean, promotions?: boolean, ... }
router.patch('/preferences', auth, writeLimiter, async (req, res) => {
  try {
    const update = {};
    for (const key of PREF_KEYS) {
      const value = req.body?.[key];
      if (typeof value === 'boolean') update[`notificationPrefs.${key}`] = value;
    }

    if (!Object.keys(update).length) {
      return res.status(400).json({
        error: `Provide at least one boolean of: ${PREF_KEYS.join(', ')}`,
      });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: update },
      { new: true },
    )
      .select('notificationPrefs')
      .lean();

    const prefs = user?.notificationPrefs || {};
    res.json({
      ok: true,
      preferences: Object.fromEntries(
        PREF_KEYS.map((key) => [key, prefs[key] !== false]),
      ),
    });
  } catch (err) {
    console.error('notifications/preferences update error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: send / broadcast / observability ───────────────────────────────

/**
 * POST /api/notifications/send
 * headers: x-admin-key
 * body: { userIds: string[], type, title, body?, data?, imageUrl?, deepLink?, priority? }
 */
router.post('/send', adminAuth, sendLimiter, async (req, res) => {
  try {
    const {
      userIds,
      userId,
      type,
      title,
      body = '',
      data = {},
      imageUrl = '',
      deepLink = '',
      priority,
      dedupeKey,
    } = req.body || {};

    if (!type || !NOTIFICATION_TYPES.includes(type)) {
      return res.status(400).json({
        error: `type must be one of: ${NOTIFICATION_TYPES.join(', ')}`,
      });
    }
    if (typeof title !== 'string' || !title.trim() || title.length > 200) {
      return res.status(400).json({ error: 'title is required (max 200 chars)' });
    }
    if (typeof body !== 'string' || body.length > 1000) {
      return res.status(400).json({ error: 'body must be under 1000 chars' });
    }

    const targets = (Array.isArray(userIds) ? userIds : [userId])
      .filter((id) => typeof id === 'string' && isObjectId(id));

    if (!targets.length) {
      return res.status(400).json({ error: 'userIds[] with valid ids is required' });
    }
    if (targets.length > 1000) {
      return res.status(400).json({ error: 'Max 1000 recipients per request' });
    }

    const io = req.app.get('io');
    const opts = { type, title: title.trim(), body, data, imageUrl, deepLink, priority };

    if (targets.length === 1) {
      const created = await createNotification(io, {
        ...opts,
        userId: targets[0],
        dedupeKey,
      });
      return res.json({ ok: true, created: created ? 1 : 0, notification: created });
    }

    const result = await createBulkNotifications(io, targets, opts);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('notifications/send error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/notifications/broadcast
 * headers: x-admin-key
 * body: { type, title, body?, data?, imageUrl?, deepLink?, filter? }
 */
router.post('/broadcast', adminAuth, broadcastLimiter, async (req, res) => {
  try {
    const { type, title, body = '', data = {}, imageUrl = '', deepLink = '', filter } =
      req.body || {};

    if (!type || !NOTIFICATION_TYPES.includes(type)) {
      return res.status(400).json({
        error: `type must be one of: ${NOTIFICATION_TYPES.join(', ')}`,
      });
    }
    if (typeof title !== 'string' || !title.trim() || title.length > 200) {
      return res.status(400).json({ error: 'title is required (max 200 chars)' });
    }

    // Respond immediately; a broadcast can take a while for a large audience
    res.json({ ok: true, accepted: true });

    broadcastNotification(req.app.get('io'), {
      type,
      title: title.trim(),
      body,
      data,
      imageUrl,
      deepLink,
      filter,
    })
      .then((r) =>
        console.log(
          `[Broadcast] ${type} → ${r.created} stored / ${r.pushed} pushed of ${r.audience}`,
        ),
      )
      .catch((err) => console.error('[Broadcast] failed:', err.message));
  } catch (err) {
    console.error('notifications/broadcast error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/notifications/admin/logs?status=failed&limit=50
router.get('/admin/logs', adminAuth, readLimiter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.userId && isObjectId(req.query.userId)) {
      query.userId = req.query.userId;
    }

    const logs = await NotificationLog.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ logs, queue: pushQueue.stats(), fcmEnabled: fcm.isEnabled() });
  } catch (err) {
    console.error('notifications/admin/logs error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/notifications/admin/daily-suggestions
 * headers: x-admin-key
 *
 * Runs the daily digest immediately instead of waiting for the send window.
 * Still one notification per user per day — replays inside the same day are
 * absorbed by the dedupe key.
 */
router.post('/admin/daily-suggestions', adminAuth, broadcastLimiter, async (req, res) => {
  try {
    const stats = await sendDailySuggestions(req.app.get('io'), { force: true });
    res.json(stats);
  } catch (err) {
    console.error('notifications/admin/daily-suggestions error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/notifications/admin/health
router.get('/admin/health', adminAuth, async (req, res) => {
  const [queued, sent, failed] = await Promise.all([
    NotificationLog.countDocuments({ status: 'queued' }),
    NotificationLog.countDocuments({ status: 'sent' }),
    NotificationLog.countDocuments({ status: 'failed' }),
  ]);
  res.json({
    fcmEnabled: fcm.isEnabled(),
    queue: pushQueue.stats(),
    logs: { queued, sent, failed },
  });
});

module.exports = router;
