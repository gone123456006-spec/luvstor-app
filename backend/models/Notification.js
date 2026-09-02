const mongoose = require('mongoose');

/**
 * Notification types supported across the app.
 * Kept in one place so backend + client stay in sync.
 */
const NOTIFICATION_TYPES = [
  'chat',
  'match',
  'like',
  'friend_request',
  'friends',
  'call',
  'token',
  'token_purchase',
  'token_low',
  'spin',
  'subscription',
  'security',
  'system',
  'promo',
  /** Once-a-day "here's what's waiting for you" digest. */
  'suggestion',
];

/** Android channel each type is delivered on (must exist on the client). */
const TYPE_CHANNEL = {
  chat: 'messages',
  match: 'social',
  like: 'social',
  friend_request: 'social',
  friends: 'social',
  call: 'calls',
  token: 'wallet',
  token_purchase: 'wallet',
  token_low: 'wallet',
  spin: 'wallet',
  subscription: 'wallet',
  security: 'security',
  system: 'system',
  promo: 'promotions',
  suggestion: 'suggestions',
};

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    /** Large image shown in the expanded notification */
    imageUrl: { type: String, default: '' },
    /** Deep link route, e.g. /messages/123 */
    deepLink: { type: String, default: '' },
    /** Groups notifications from the same conversation / subject */
    groupKey: { type: String, default: null, index: true },
    /** Client-supplied idempotency key to prevent duplicates */
    dedupeKey: { type: String, default: null },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high'],
      default: 'normal',
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actorName: { type: String, default: '' },
    actorPhoto: { type: String, default: '' },
    actorGender: { type: String, default: '' },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    /** Push delivery outcome for this notification */
    pushStatus: {
      type: String,
      enum: ['pending', 'queued', 'sent', 'partial', 'failed', 'skipped'],
      default: 'pending',
    },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1 });
notificationSchema.index({ userId: 1, type: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, type: 1, actorId: 1, read: 1 });
// Dedupe guard: same key can only exist once per user
notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

// Auto-prune old read notifications (90 days) — keeps Notification Center lean at scale
if (process.env.NOTIFICATION_TTL_DAYS !== '0') {
  const days = Number(process.env.NOTIFICATION_TTL_DAYS || 90);
  notificationSchema.index(
    { createdAt: 1 },
    {
      expireAfterSeconds: Math.max(1, days) * 24 * 60 * 60,
      partialFilterExpression: { read: true },
    },
  );
}

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.TYPE_CHANNEL = TYPE_CHANNEL;
