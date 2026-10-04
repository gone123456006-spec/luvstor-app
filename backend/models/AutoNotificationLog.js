/**
 * One row per automatic (non-event) notification sent to a user — the source
 * of truth for the weekly auto-notification budget. Rows expire after 14 days.
 */
const mongoose = require('mongoose');

const autoNotificationLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  code: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

autoNotificationLogSchema.index({ userId: 1, createdAt: -1 });
autoNotificationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

module.exports =
  mongoose.models.AutoNotificationLog ||
  mongoose.model('AutoNotificationLog', autoNotificationLogSchema);
