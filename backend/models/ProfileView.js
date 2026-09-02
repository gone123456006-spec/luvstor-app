const mongoose = require('mongoose');

/**
 * Who opened whose full profile.
 *
 * Deliberately aggregated per (viewer, target) pair rather than append-only:
 * the app only ever needs "how many people looked at me / who did I look at",
 * so one row per pair keeps the collection bounded no matter how often someone
 * revisits a profile.
 */
const profileViewSchema = new mongoose.Schema(
  {
    /** Who opened the profile. */
    viewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Whose profile was opened. */
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    firstViewedAt: { type: Date, default: Date.now },
    lastViewedAt: { type: Date, default: Date.now },
    viewCount: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true },
);

profileViewSchema.index({ viewerId: 1, targetId: 1 }, { unique: true });
// "Who viewed me recently" for the daily digest.
profileViewSchema.index({ targetId: 1, lastViewedAt: -1 });
// "Whose profile did I open recently" — powers the re-engagement suggestion.
profileViewSchema.index({ viewerId: 1, lastViewedAt: -1 });

/**
 * Views older than the retention window are of no product value and would
 * otherwise grow without bound.
 */
const RETENTION_DAYS = Number(process.env.PROFILE_VIEW_RETENTION_DAYS) || 90;
profileViewSchema.index(
  { lastViewedAt: 1 },
  { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
);

module.exports = mongoose.model('ProfileView', profileViewSchema);
