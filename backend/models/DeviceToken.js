const mongoose = require('mongoose');

/**
 * FCM device tokens.
 *
 * One row per physical device. `token` is globally unique — when a device is
 * handed to another account, the row is re-assigned instead of duplicated.
 */
const deviceTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Raw FCM registration token */
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /** App installation id (stable across token refreshes) */
    deviceId: { type: String, default: null, index: true },
    platform: {
      type: String,
      enum: ['android', 'ios', 'web'],
      default: 'android',
    },
    deviceName: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    /** Disabled after FCM reports the token as unregistered/invalid */
    active: { type: Boolean, default: true, index: true },
    invalidReason: { type: String, default: null },
    /** Consecutive send failures — token is retired past the threshold */
    failureCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

deviceTokenSchema.index({ userId: 1, active: 1 });
deviceTokenSchema.index({ userId: 1, deviceId: 1 });
deviceTokenSchema.index({ updatedAt: 1 }); // stale token cleanup scans

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);
