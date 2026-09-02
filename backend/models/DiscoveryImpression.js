const mongoose = require('mongoose');

/**
 * Viewer-specific discovery history.
 *
 * One aggregated row per (viewerId, candidateId) pair — never one row per
 * impression — so history stays bounded as the user base grows.
 *
 * Because the key includes viewerId, marking "A saw B" never hides B from
 * anyone else's Discover feed.
 */
const discoveryImpressionSchema = new mongoose.Schema(
  {
    viewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    firstShownAt: { type: Date, default: Date.now },
    lastShownAt: { type: Date, default: Date.now },
    impressionCount: { type: Number, default: 0, min: 0 },
    /** Rotation bucket (0–6) this candidate occupied at the last impression. */
    lastBucket: { type: Number, default: null, min: 0, max: 6 },
    /** Which radius pass produced it: 'nearby' | 'expanded' | 'global'. */
    lastSource: { type: String, default: null },
    /** Selection tier at the last impression — useful for tuning/debugging. */
    lastTier: { type: Number, default: null },
    /** Metres between viewer and candidate when last shown. */
    distanceAtImpression: { type: Number, default: null },
  },
  { timestamps: true },
);

/** Upsert key — also prevents duplicate history rows under concurrency. */
discoveryImpressionSchema.index({ viewerId: 1, candidateId: 1 }, { unique: true });

/** Feed queries load a viewer's history ordered by recency / frequency. */
discoveryImpressionSchema.index({ viewerId: 1, lastShownAt: 1 });
discoveryImpressionSchema.index({ viewerId: 1, impressionCount: 1 });

/**
 * Keep history bounded. `lastShownAt` is refreshed on every impression, so a
 * pair only expires once it has been dormant for the whole retention window —
 * far beyond the 7-day cooldown, after which the profile is fresh again.
 */
const RETENTION_DAYS = Number(process.env.DISCOVERY_HISTORY_RETENTION_DAYS) || 90;
discoveryImpressionSchema.index(
  { lastShownAt: 1 },
  { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
);

module.exports = mongoose.model('DiscoveryImpression', discoveryImpressionSchema);
