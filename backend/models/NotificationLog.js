const mongoose = require('mongoose');

/**
 * Delivery audit trail for every push attempt (per user, per job).
 * Kept separate from Notification so history stays readable and prunable.
 */
const notificationLogSchema = new mongoose.Schema(
  {
    notificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Notification',
      default: null,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: { type: String, default: 'system' },
    channel: {
      type: String,
      enum: ['fcm', 'socket'],
      default: 'fcm',
    },
    status: {
      type: String,
      enum: ['queued', 'sent', 'partial', 'failed', 'skipped'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    /** Tokens removed as a result of this send */
    invalidatedTokens: { type: Number, default: 0 },
    error: { type: String, default: null },
    /** Per-token result detail, capped to avoid unbounded docs */
    results: {
      type: [
        {
          token: String,
          success: Boolean,
          errorCode: String,
          _id: false,
        },
      ],
      default: [],
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationLogSchema.index({ createdAt: -1 });
// Auto-prune logs after 30 days
notificationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
