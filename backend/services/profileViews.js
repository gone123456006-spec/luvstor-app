const mongoose = require('mongoose');
const ProfileView = require('../models/ProfileView');
const Friendship = require('../models/Friendship');
const { getBlockState } = require('../utils/blockState');

function toObjectId(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

/** UTC day key for once-per-day dedupe (YYYY-MM-DD). */
function utcDayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Notify the profile owner that someone viewed them.
 * Rate-limited: one notification per viewer→target per calendar day.
 * Skips self, blocks, and existing friends.
 */
async function notifyProfileViewed(io, viewerId, targetId) {
  try {
    if (!viewerId || !targetId) return null;
    if (String(viewerId) === String(targetId)) return null;

    const block = await getBlockState(viewerId, targetId);
    if (block?.blocked || block?.iBlocked || block?.theyBlocked) return null;

    // Friends already chat — skip noisy profile-view pings
    try {
      const { userA, userB } = Friendship.getSortedPair(viewerId, targetId);
      const friendship = await Friendship.findOne({ userA, userB })
        .select('status')
        .lean();
      if (
        friendship &&
        (friendship.status === 'friends' || friendship.status === 'mutual_match')
      ) {
        return null;
      }
    } catch {
      /* friendship check is best-effort */
    }

    const { createNotification } = require('./notifications');
    const day = utcDayKey();

    return await createNotification(io, {
      userId: String(targetId),
      type: 'profile_view',
      title: 'Someone viewed your profile.',
      body: 'Like or message them back.',
      actorId: String(viewerId),
      data: {
        userId: String(viewerId),
        action: 'profile_view',
      },
      deepLink: `/(tabs)`,
      groupKey: `profile_view:${viewerId}`,
      // One alert per viewer per day — re-views same day are silent
      dedupeKey: `profile_view:${viewerId}:${day}`,
      priority: 'normal',
      push: true,
    });
  } catch (err) {
    console.warn('[profileViews] notify failed:', err?.message || err);
    return null;
  }
}

/**
 * Record that `viewerId` opened `targetId`'s profile.
 *
 * Best-effort and never awaited by the request path — a failure to log a view
 * must never turn into a failed profile load.
 *
 * @param {object} [io] Socket.io instance for realtime notification delivery
 */
async function recordProfileView(viewerId, targetId, now = new Date(), io = null) {
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

    // Fire-and-forget notify — never block the profile response
    if (io) {
      void notifyProfileViewed(io, viewerId, targetId);
    }

    return true;
  } catch (err) {
    // Racing upserts on the unique index surface as duplicate keys; the pair
    // already exists, which is all we cared about.
    if (err?.code !== 11000) {
      console.warn('[profileViews] record failed:', err?.message || err);
    } else if (io) {
      // Still try to notify on race — dedupeKey prevents duplicates
      void notifyProfileViewed(io, viewerId, targetId);
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
  notifyProfileViewed,
  countViewersSince,
  countViewersSinceBulk,
  recentlyViewedByBulk,
};
