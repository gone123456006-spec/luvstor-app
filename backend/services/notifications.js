/**
 * Notification service.
 *
 * Single entry point used by every feature in the app. It:
 *   1. persists the notification (history / notification center)
 *   2. emits it over the socket for instant in-app delivery
 *   3. enqueues an FCM push so offline users still get it
 *
 * Chat notifications from the same sender are coalesced into one row so the
 * notification center mirrors the chat list instead of listing every message.
 */
const Notification = require('../models/Notification');
const { TYPE_CHANNEL } = require('../models/Notification');
const User = require('../models/User');
const ConversationState = require('../models/ConversationState');
const { notifyUser, actorPayload } = require('../utils/realtime');
const { isViewingChat } = require('../utils/activeChat');
const deviceTokens = require('./deviceTokens');
const pushQueue = require('./pushQueue');

/**
 * Per-type push defaults.
 *
 * Custom sounds are opt-in via PUSH_CUSTOM_SOUNDS=true: on Android 8+ the sound
 * is owned by the notification channel, so the matching raw resources must be
 * bundled in the app first (see PUSH_NOTIFICATIONS.md). Until then every type
 * falls back to the system default.
 */
const CUSTOM_SOUNDS = process.env.PUSH_CUSTOM_SOUNDS === 'true';

const TYPE_DEFAULTS = {
  chat: { priority: 'high', sound: 'message' },
  call: { priority: 'high', sound: 'call' },
  match: { priority: 'high', sound: 'match' },
  like: { priority: 'high', sound: 'default' },
  friend_request: { priority: 'high', sound: 'default' },
  friends: { priority: 'high', sound: 'match' },
  token: { priority: 'normal', sound: 'default' },
  token_purchase: { priority: 'normal', sound: 'default' },
  token_low: { priority: 'normal', sound: 'default' },
  spin: { priority: 'normal', sound: 'default' },
  subscription: { priority: 'normal', sound: 'default' },
  security: { priority: 'high', sound: 'default' },
  system: { priority: 'normal', sound: 'default' },
  promo: { priority: 'low', sound: 'default' },
  suggestion: { priority: 'normal', sound: 'default' },
};

/** Pref keys on User.notificationPrefs (separate from Android channel ids). */
const TYPE_PREF = {
  chat: 'chat',
  call: 'calls',
  match: 'social',
  like: 'social',
  friend_request: 'social',
  friends: 'social',
  token: 'wallet',
  token_purchase: 'wallet',
  token_low: 'wallet',
  spin: 'wallet',
  subscription: 'wallet',
  security: null, // always on
  system: 'system',
  promo: 'promotions',
  // The daily digest is a nudge, not a real-time event: it shares the
  // promotions opt-out so muting it never silences an actual like or match.
  suggestion: 'promotions',
};

const SOCIAL_TYPES = new Set(['friend_request', 'friends', 'like', 'match', 'chat', 'call']);

/** Personal DMs belong in Chats — never the Notification Center (WhatsApp-style). */
const HIDE_FROM_CENTER = new Set(['chat']);

function defaultsFor(type) {
  const base = TYPE_DEFAULTS[type] || TYPE_DEFAULTS.system;
  return CUSTOM_SOUNDS ? base : { ...base, sound: 'default' };
}

/** Where tapping the notification should land the user. */
function resolveDeepLink(type, data = {}, actorId = null) {
  const userId = data.userId || (actorId ? String(actorId) : null);
  switch (type) {
    case 'chat':
    case 'call':
    case 'match':
    case 'friends':
      return userId ? `/messages/${userId}` : '/(tabs)/chat';
    case 'friend_request':
    case 'like':
      return '/(tabs)/chat';
    case 'token':
    case 'token_purchase':
    case 'token_low':
    case 'spin':
    case 'subscription':
      return '/(tabs)/token';
    case 'security':
      return '/settings/account';
    case 'suggestion':
      // The digest is about people to discover, so it lands on Discover unless
      // the job overrides it with something more specific.
      return '/(tabs)';
    default:
      return '/notifications';
  }
}

/** Titles/bodies that read naturally once we know who triggered them. */
function applyActorCopy(type, title, body, actorName) {
  if (!actorName) return { title, body };
  switch (type) {
    case 'friend_request':
      return {
        title: `${actorName} liked you`,
        body: body || 'Open Requests to respond.',
      };
    case 'friends':
      return {
        title: `You're friends with ${actorName}!`,
        body: body || 'Say hi and start chatting.',
      };
    case 'match':
      return {
        title: `It's a match with ${actorName}!`,
        body: body || 'Start the conversation now.',
      };
    case 'like':
      return { title: `${actorName} liked your profile`, body };
    case 'chat':
      return { title: actorName, body };
    case 'call':
      return {
        title: `${actorName} is calling`,
        body: body || 'Tap to answer',
      };
    default:
      return { title, body };
  }
}

function serialize(doc, actor = {}) {
  return {
    _id: String(doc._id),
    type: doc.type,
    title: doc.title,
    body: doc.body || '',
    imageUrl: doc.imageUrl || '',
    deepLink: doc.deepLink || '',
    groupKey: doc.groupKey || null,
    priority: doc.priority || 'normal',
    data: doc.data || {},
    actorId: doc.actorId ? String(doc.actorId) : null,
    actorName: doc.actorName || actor.actorName || '',
    actorPhoto: doc.actorPhoto || actor.actorPhoto || '',
    actorGender: doc.actorGender || actor.actorGender || '',
    read: !!doc.read,
    createdAt: doc.createdAt,
  };
}

/**
 * Whether the user still wants pushes for this type.
 * Security alerts always go through — they are not opt-outable.
 */
async function pushAllowed(userId, type, { actorId } = {}) {
  const prefKey = Object.prototype.hasOwnProperty.call(TYPE_PREF, type)
    ? TYPE_PREF[type]
    : 'system';
  if (prefKey === null) return true; // security

  try {
    const user = await User.findById(userId).select('notificationPrefs').lean();
    const prefs = user?.notificationPrefs;
    if (prefs && prefKey && prefs[prefKey] === false) return false;

    // Per-conversation mute (WhatsApp)
    if (type === 'chat' && actorId) {
      const muted = await ConversationState.exists({
        userId,
        otherUserId: actorId,
        muted: true,
      });
      if (muted) return false;
    }

    return true;
  } catch {
    return true;
  }
}

/** Apply WhatsApp-style "hide message content" for chat pushes. */
async function applyPreviewPrivacy(userId, type, title, body) {
  if (type !== 'chat') return { title, body };
  try {
    const user = await User.findById(userId).select('notificationPrefs').lean();
    if (user?.notificationPrefs?.showMessagePreview === false) {
      return { title, body: 'New message' };
    }
  } catch {
    /* keep original */
  }
  return { title, body };
}

async function unreadCountFor(userId) {
  try {
    return await Notification.countDocuments({
      userId,
      read: false,
      type: { $nin: [...HIDE_FROM_CENTER] },
    });
  } catch {
    return 0;
  }
}

/**
 * Queue the FCM push for a persisted notification.
 * Never throws — push failure must not break the caller's flow.
 */
async function queuePush(userId, notification, { badge } = {}) {
  try {
    if (
      !(await pushAllowed(userId, notification.type, {
        actorId: notification.actorId,
      }))
    ) {
      return;
    }

    const tokens = await deviceTokens.getActiveTokens(userId);
    if (!tokens.length) return;

    const opts = defaultsFor(notification.type);
    const badgeCount =
      typeof badge === 'number' ? badge : await unreadCountFor(userId);

    const preview = await applyPreviewPrivacy(
      userId,
      notification.type,
      notification.title,
      notification.body,
    );

    pushQueue.enqueue({
      userId: String(userId),
      notificationId: notification._id,
      tokens,
      payload: {
        title: preview.title,
        body: preview.body,
        imageUrl: notification.imageUrl || undefined,
        channelId: TYPE_CHANNEL[notification.type] || 'system',
        priority: notification.priority || opts.priority,
        sound: opts.sound,
        groupKey: notification.groupKey || undefined,
        collapseKey: notification.groupKey || undefined,
        badge: badgeCount,
        data: {
          notificationId: String(notification._id),
          type: notification.type,
          deepLink: notification.deepLink || '',
          groupKey: notification.groupKey || '',
          actorId: notification.actorId ? String(notification.actorId) : '',
          actorName: notification.actorName || '',
          actorPhoto: notification.actorPhoto || '',
          badge: String(badgeCount),
          ...(notification.data || {}),
        },
      },
    });
  } catch (err) {
    console.error('[Notifications] queuePush failed:', err.message);
  }
}

/**
 * Create a notification for a single user.
 *
 * @param {import('socket.io').Server|null} io
 * @param {object} opts
 * @param {string} opts.userId       recipient
 * @param {string} opts.type         one of NOTIFICATION_TYPES
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {object} [opts.data]       extra payload merged into the push data
 * @param {string} [opts.actorId]    who triggered it (fills name/photo)
 * @param {string} [opts.imageUrl]
 * @param {string} [opts.deepLink]   overrides the type default
 * @param {string} [opts.groupKey]   groups related notifications
 * @param {string} [opts.dedupeKey]  idempotency key — repeats are ignored
 * @param {'low'|'normal'|'high'} [opts.priority]
 * @param {boolean} [opts.push=true] set false for silent/in-app-only
 */
async function createNotification(io, opts = {}) {
  const {
    userId,
    type,
    data = {},
    actorId = null,
    imageUrl = '',
    dedupeKey = null,
  } = opts;

  if (!userId || !type || !opts.title) return null;

  try {
    // WhatsApp: never tray-push while the recipient has this chat open
    let push = opts.push !== false;
    if (push && type === 'chat' && actorId && (await isViewingChat(userId, actorId))) {
      push = false;
    }

    let actorName = '';
    let actorPhoto = '';
    let actorGender = '';

    if (actorId) {
      try {
        const actor = await actorPayload(User, actorId);
        actorName = actor.fromName || '';
        actorPhoto = actor.fromPhoto || '';
        actorGender = actor.fromGender || '';
      } catch {
        /* actor details are cosmetic */
      }
    }

    const copy = applyActorCopy(type, opts.title, opts.body || '', actorName);
    const title = copy.title;
    const body = copy.body;

    const deepLink = opts.deepLink || resolveDeepLink(type, data, actorId);
    const groupKey =
      opts.groupKey ||
      (SOCIAL_TYPES.has(type) && actorId ? `${type}:${actorId}` : type);
    const priority = opts.priority || defaultsFor(type).priority;

    // Personal messages: FCM/tray only — never Notification Center / badge
    if (HIDE_FROM_CENTER.has(type)) {
      if (push) {
        await queuePush(userId, {
          _id: null,
          type,
          title: title || 'New message',
          body,
          imageUrl: imageUrl || actorPhoto || '',
          deepLink,
          groupKey,
          priority,
          data,
          actorId: actorId || null,
          actorName,
          actorPhoto,
          actorGender,
        });
      }
      return null;
    }

    let doc;
    try {
      doc = await Notification.create({
        userId,
        type,
        title,
        body,
        imageUrl,
        deepLink,
        groupKey,
        dedupeKey,
        priority,
        data,
        actorId: actorId || null,
        actorName,
        actorPhoto,
        actorGender,
        read: false,
        pushStatus: push ? 'pending' : 'skipped',
      });
    } catch (err) {
      // Duplicate dedupeKey — the notification already exists, nothing to do
      if (err.code === 11000) return null;
      throw err;
    }

    const payload = serialize(doc);
    if (io) notifyUser(io, userId, 'notification:new', payload);
    if (push) await queuePush(userId, doc);

    return payload;
  } catch (err) {
    console.error('[Notifications] createNotification failed:', err.message);
    return null;
  }
}

/**
 * Fan out the same notification to many users (matches, announcements…).
 * Uses insertMany + a single token lookup instead of N round trips.
 */
async function createBulkNotifications(io, userIds = [], opts = {}) {
  const ids = [...new Set(userIds.map(String))].filter(Boolean);
  if (!ids.length || !opts.type || !opts.title) {
    return { created: 0, pushed: 0 };
  }

  const {
    type,
    title,
    body = '',
    data = {},
    imageUrl = '',
    priority,
    push = true,
  } = opts;

  const deepLink = opts.deepLink || resolveDeepLink(type, data);
  const groupKey = opts.groupKey || type;
  const resolvedPriority = priority || defaultsFor(type).priority;

  const docs = ids.map((userId) => ({
    userId,
    type,
    title,
    body,
    imageUrl,
    deepLink,
    groupKey,
    priority: resolvedPriority,
    data,
    read: false,
    pushStatus: push ? 'pending' : 'skipped',
  }));

  // ordered:false → one bad doc (e.g. dedupe clash) doesn't abort the batch
  const inserted = await Notification.insertMany(docs, { ordered: false }).catch(
    (err) => err.insertedDocs || [],
  );

  for (const doc of inserted) {
    if (io) notifyUser(io, doc.userId, 'notification:new', serialize(doc));
  }

  let pushed = 0;
  if (push) {
    const tokenMap = await deviceTokens.getTokensByUser(ids);
    const opt = defaultsFor(type);

    // Respect per-category opt-outs in a single lookup for the whole batch
    const prefKey = Object.prototype.hasOwnProperty.call(TYPE_PREF, type)
      ? TYPE_PREF[type]
      : 'system';
    const optedOut = new Set();
    if (prefKey) {
      const rows = await User.find({
        _id: { $in: ids },
        [`notificationPrefs.${prefKey}`]: false,
      })
        .select('_id')
        .lean();
      rows.forEach((r) => optedOut.add(String(r._id)));
    }

    for (const doc of inserted) {
      if (optedOut.has(String(doc.userId))) continue;
      const tokens = tokenMap.get(String(doc.userId));
      if (!tokens?.length) continue;
      pushed += 1;
      pushQueue.enqueue({
        userId: String(doc.userId),
        notificationId: doc._id,
        tokens,
        payload: {
          title,
          body,
          imageUrl: imageUrl || undefined,
          channelId: TYPE_CHANNEL[type] || 'system',
          priority: resolvedPriority,
          sound: opt.sound,
          groupKey,
          collapseKey: groupKey,
          data: {
            notificationId: String(doc._id),
            type,
            deepLink,
            groupKey,
            ...data,
          },
        },
      });
    }
  }

  return { created: inserted.length, pushed };
}

/**
 * Send a batch of notifications that share a type but have per-user copy.
 *
 * `createBulkNotifications` reuses one title/body for everyone, and
 * `createNotification` costs three round trips per recipient — neither suits a
 * personalised digest going out to thousands of accounts. This keeps the cost
 * at one insert plus one preference and one token lookup per batch.
 *
 * @param {import('socket.io').Server|null} io
 * @param {Array<{userId: string, title: string, body?: string, data?: object,
 *   deepLink?: string, imageUrl?: string, dedupeKey?: string}>} items
 * @param {{ type: string, priority?: string, groupKey?: string, push?: boolean }} opts
 */
async function createPersonalNotifications(io, items = [], opts = {}) {
  const { type, priority, groupKey, push = true } = opts;
  const valid = items.filter((item) => item?.userId && item?.title);
  if (!type || !valid.length) return { created: 0, pushed: 0 };

  const resolvedPriority = priority || defaultsFor(type).priority;
  const resolvedGroupKey = groupKey || type;

  const docs = valid.map((item) => ({
    userId: item.userId,
    type,
    title: item.title,
    body: item.body || '',
    imageUrl: item.imageUrl || '',
    deepLink: item.deepLink || resolveDeepLink(type, item.data || {}),
    groupKey: resolvedGroupKey,
    dedupeKey: item.dedupeKey || undefined,
    priority: resolvedPriority,
    data: item.data || {},
    read: false,
    pushStatus: push ? 'pending' : 'skipped',
  }));

  // ordered:false → a dedupeKey clash (already sent today) skips just that row.
  const inserted = await Notification.insertMany(docs, { ordered: false }).catch(
    (err) => err.insertedDocs || [],
  );

  for (const doc of inserted) {
    if (io) notifyUser(io, doc.userId, 'notification:new', serialize(doc));
  }
  if (!push || !inserted.length) return { created: inserted.length, pushed: 0 };

  const ids = inserted.map((doc) => String(doc.userId));
  const prefKey = Object.prototype.hasOwnProperty.call(TYPE_PREF, type)
    ? TYPE_PREF[type]
    : 'system';

  const optedOut = new Set();
  if (prefKey) {
    const rows = await User.find({
      _id: { $in: ids },
      [`notificationPrefs.${prefKey}`]: false,
    })
      .select('_id')
      .lean();
    rows.forEach((r) => optedOut.add(String(r._id)));
  }

  const tokenMap = await deviceTokens.getTokensByUser(ids);
  const opt = defaultsFor(type);
  let pushed = 0;

  for (const doc of inserted) {
    const userId = String(doc.userId);
    if (optedOut.has(userId)) continue;
    const tokens = tokenMap.get(userId);
    if (!tokens?.length) continue;
    pushed += 1;
    pushQueue.enqueue({
      userId,
      notificationId: doc._id,
      tokens,
      payload: {
        title: doc.title,
        body: doc.body || '',
        imageUrl: doc.imageUrl || undefined,
        channelId: TYPE_CHANNEL[type] || 'system',
        priority: resolvedPriority,
        sound: opt.sound,
        groupKey: resolvedGroupKey,
        collapseKey: resolvedGroupKey,
        data: {
          notificationId: String(doc._id),
          type,
          deepLink: doc.deepLink || '',
          groupKey: resolvedGroupKey,
          ...(doc.data || {}),
        },
      },
    });
  }

  return { created: inserted.length, pushed };
}

/** Broadcast to every active (non-deactivated) account. */
async function broadcastNotification(io, opts = {}) {
  const filter = { isDeactivated: { $ne: true } };
  if (opts.filter && typeof opts.filter === 'object') {
    Object.assign(filter, opts.filter);
  }

  const users = await User.find(filter).select('_id').lean();
  const ids = users.map((u) => String(u._id));

  // Chunked so a large user base doesn't build one enormous insertMany
  const CHUNK = 1000;
  let created = 0;
  let pushed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await createBulkNotifications(io, ids.slice(i, i + CHUNK), opts);
    created += res.created;
    pushed += res.pushed;
  }
  return { created, pushed, audience: ids.length };
}

module.exports = {
  createNotification,
  createBulkNotifications,
  createPersonalNotifications,
  broadcastNotification,
  unreadCountFor,
  resolveDeepLink,
  TYPE_DEFAULTS,
  HIDE_FROM_CENTER,
};
