const mongoose = require('mongoose');
const ProfileView = require('../models/ProfileView');

function toObjectId(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

/**
 * Record that `viewerId` opened `targetId`'s profile.
 *
 * Best-effort and never awaited by the request path — a failure to log a view
 * must never turn into a failed profile load.
 */
async function recordProfileView(viewerId, targetId, now = new Date()) {
  const viewerOid = toObjectId(viewerId);
  const targetOid = toObjectId(targetId);
  if (!viewerOid || !targetOid || String(viewerOid) === String(targetOid)) return false;

  try {
    await ProfileView.updateOne(
      { viewerId: viewerOid, targetId: targetOid },
      {
        $inc: { viewCount: 1 },
        $set: { lastViewedAt: now },
        $setOnInsert: { firstViewedAt: now },
      },
      { upsert: true },
    );
    return true;
  } catch (err) {
    // Racing upserts on the unique index surface as duplicate keys; the pair
    // already exists, which is all we cared about.
    if (err?.code !== 11000) {
      console.warn('[profileViews] record failed:', err?.message || err);
    }
    return false;
  }
}

/** How many distinct people opened this user's profile since `since`. */
async function countViewersSince(targetId, since) {
  const targetOid = toObjectId(targetId);
  if (!targetOid) return 0;
  return ProfileView.countDocuments({ targetId: targetOid, lastViewedAt: { $gte: since } });
}

/**
 * Viewer counts for many users at once — the digest job runs over thousands of
 * accounts, so it must never issue one query per user.
 *
 * @returns {Map<string, number>} userId → distinct viewers since `since`
 */
async function countViewersSinceBulk(targetIds, since) {
  const oids = [...new Set([...targetIds].map(String))].map(toObjectId).filter(Boolean);
  const map = new Map();
  if (!oids.length) return map;

  const rows = await ProfileView.aggregate([
    { $match: { targetId: { $in: oids }, lastViewedAt: { $gte: since } } },
    { $group: { _id: '$targetId', count: { $sum: 1 } } },
  ]);
  for (const row of rows) map.set(String(row._id), row.count);
  return map;
}

/** Profiles this user recently opened, most recent first. */
async function recentlyViewedByBulk(viewerIds, since, perViewer = 3) {
  const oids = [...new Set([...viewerIds].map(String))].map(toObjectId).filter(Boolean);
  const map = new Map();
  if (!oids.length) return map;

  const rows = await ProfileView.aggregate([
    { $match: { viewerId: { $in: oids }, lastViewedAt: { $gte: since } } },
    { $sort: { lastViewedAt: -1 } },
    { $group: { _id: '$viewerId', targets: { $push: '$targetId' } } },
    { $project: { targets: { $slice: ['$targets', perViewer] } } },
  ]);
  for (const row of rows) {
    map.set(String(row._id), row.targets.map(String));
  }
  return map;
}

module.exports = {
  recordProfileView,
  countViewersSince,
  countViewersSinceBulk,
  recentlyViewedByBulk,
};
