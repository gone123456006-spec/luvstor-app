const DeviceToken = require('../models/DeviceToken');

/** FCM tokens go stale after ~270 days of inactivity; prune earlier. */
const STALE_AFTER_DAYS = 60;

/**
 * Remove tokens that have been deactivated or unused for a long time so
 * every send targets a realistic audience.
 */
async function pruneStaleTokens() {
  try {
    const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    const [inactive, stale] = await Promise.all([
      DeviceToken.deleteMany({ active: false }),
      DeviceToken.deleteMany({ lastUsedAt: { $lt: cutoff } }),
    ]);

    const removed = (inactive.deletedCount || 0) + (stale.deletedCount || 0);
    if (removed) {
      console.log(`[DeviceTokens] Pruned ${removed} stale token(s)`);
    }
    return removed;
  } catch (err) {
    console.error('[DeviceTokens] prune failed:', err.message);
    return 0;
  }
}

module.exports = { pruneStaleTokens, STALE_AFTER_DAYS };
