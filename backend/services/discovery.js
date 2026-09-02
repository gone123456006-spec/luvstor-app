const mongoose = require('mongoose');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const DiscoveryImpression = require('../models/DiscoveryImpression');
const { getEffectivePlan, serializeSubscription } = require('./subscriptions');
const {
  DEFAULT_TARGET_COUNT,
  MAX_TARGET_COUNT,
  FULL_COOLDOWN_MS,
  rotationDayKey,
  rotationBucketForDay,
  selectDiscoveryBatch,
} = require('./discoveryRotation');

/**
 * Timezone used to decide when the rotation day flips. Server-side only, so a
 * device with a wrong clock can never shift its own bucket.
 */
const ROTATION_TZ_OFFSET_MINUTES =
  parseInt(process.env.DISCOVERY_ROTATION_TZ_OFFSET_MINUTES, 10) || 0;

/**
 * How many candidates to rank per batch. A pool several times larger than the
 * batch gives the tier logic room to prefer unseen people, while staying
 * bounded so the query never degrades on a large user base.
 */
const POOL_MULTIPLIER = 6;
const MIN_POOL_SIZE = 100;
const MAX_POOL_SIZE = 300;

/**
 * Optional hard ceiling on how far discovery may reach.
 *
 * Unset by default, which preserves the existing product behaviour: the chosen
 * radius decides who counts as "nearby", and people beyond it are still offered
 * as `source: 'random'` once nearby supply runs out. Set this to turn the radius
 * into a strict limit instead.
 */
const MAX_RADIUS_METRES = Number(process.env.DISCOVERY_MAX_RADIUS_METRES) || null;

/**
 * How many recently-shown profiles may be skipped at the query level.
 *
 * In a dense city `$near` would otherwise keep returning the same nearest N
 * people every day, and the ranker could only reorder what it was given.
 * Excluding the cooldown set lets the geo scan reach past them to genuinely
 * unseen profiles. Capped so the `$nin` stays small and predictable.
 */
const RECENT_HISTORY_CAP = 500;

const DISCOVERY_SELECT =
  'publicId name age bio photo photos gender interests height relationshipGoal ' +
  'isOnline lastSeen location createdAt subscriptionPlan subscriptionExpiresAt ' +
  'discoverTopSpotUntil discoverTopSpotDate discoveryExposureCount discoveryPrefs';

function toObjectId(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function toObjectIds(ids) {
  return [...new Set([...ids].map(String))].map(toObjectId).filter(Boolean);
}

/**
 * True when a user has real GPS coordinates.
 *
 * The User schema defaults `location.coordinates` to `[0, 0]`, so everyone who
 * never granted location permission sits on the null island. Those accounts
 * must neither receive a nearby feed nor appear in anyone else's.
 */
function hasRealLocation(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
  const [lng, lat] = coordinates.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return lng !== 0 || lat !== 0;
}

/**
 * Saved Discover filters in the shape the ranker expects, or null when the user
 * has never applied a filter. Null matters: an unknown preference is scored as
 * neutral, never as a rejection.
 */
function normalisePrefs(prefs) {
  if (!prefs || !prefs.updatedAt) return null;
  const gender = String(prefs.gender || '').trim();
  const radiusKm = Number(prefs.radiusKm);
  return {
    gender: gender.toLowerCase() === 'all' ? '' : gender,
    radiusKm: Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : null,
    activeWithinMinutes: Number(prefs.activeWithinMinutes) || 0,
  };
}

/** Haversine distance in metres. */
function distanceMetres(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((n) => Number.isFinite(n))) return NaN;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Every user id the viewer must never see in Discover, in a single query.
 * Replaces the previous per-candidate block lookup (N+1).
 */
async function getBlockedUserIds(viewerId) {
  const oid = toObjectId(viewerId);
  if (!oid) return [];
  const rows = await Friendship.find({
    status: 'blocked',
    $or: [{ userA: oid }, { userB: oid }],
  })
    .select('userA userB')
    .lean();

  const self = String(viewerId);
  const ids = new Set();
  for (const row of rows) {
    const other = String(row.userA) === self ? String(row.userB) : String(row.userA);
    ids.add(other);
  }
  return [...ids];
}

/**
 * Relationship state for the whole batch in one query (replaces one
 * Friendship.findOne per rendered card).
 */
async function getFriendshipMap(viewerId, candidateIds) {
  const map = new Map();
  const candidateOids = toObjectIds(candidateIds);
  if (!candidateOids.length) return map;
  const viewerOid = toObjectId(viewerId);
  if (!viewerOid) return map;

  const rows = await Friendship.find({
    $or: [
      { userA: viewerOid, userB: { $in: candidateOids } },
      { userB: viewerOid, userA: { $in: candidateOids } },
    ],
  }).lean();

  const self = String(viewerId);
  for (const row of rows) {
    const other = String(row.userA) === self ? String(row.userB) : String(row.userA);
    map.set(other, row);
  }
  return map;
}

/** Viewer-specific history for the candidate pool, in one query. */
async function getImpressionMap(viewerId, candidateIds) {
  const map = new Map();
  const candidateOids = toObjectIds(candidateIds);
  const viewerOid = toObjectId(viewerId);
  if (!viewerOid || !candidateOids.length) return map;

  const rows = await DiscoveryImpression.find({
    viewerId: viewerOid,
    candidateId: { $in: candidateOids },
  })
    .select('candidateId lastShownAt firstShownAt impressionCount lastBucket')
    .lean();

  for (const row of rows) {
    map.set(String(row.candidateId), row);
  }
  return map;
}

/**
 * Ids this viewer has been shown inside the cooldown window, newest first.
 *
 * Used to push the geo scan past people the viewer has already seen so that
 * "fresh" really means fresh even when thousands of profiles sit inside the
 * radius. Served by the (viewerId, lastShownAt) index.
 */
async function getRecentlyShownIds(viewerId, now = new Date()) {
  const viewerOid = toObjectId(viewerId);
  if (!viewerOid) return [];
  const since = new Date(now.getTime() - FULL_COOLDOWN_MS);
  const rows = await DiscoveryImpression.find({
    viewerId: viewerOid,
    lastShownAt: { $gte: since },
  })
    .select('candidateId')
    .sort({ lastShownAt: -1 })
    .limit(RECENT_HISTORY_CAP)
    .lean();
  return rows.map((row) => String(row.candidateId));
}

/**
 * Base eligibility, applied inside MongoDB so ineligible users are never
 * pulled into application memory.
 */
function buildEligibilityFilter({ excludeOids, genderFilter, activeWithinMinutes }) {
  const filter = {
    _id: { $nin: excludeOids },
    isVerified: true,
    isDeactivated: { $ne: true },
    // Accounts queued for removal drop out of discovery immediately.
    deletionScheduledAt: null,
    // Onboarding incomplete (no display name) => not discoverable.
    name: { $nin: [null, ''] },
    // Schema default [0, 0] means "never shared location" — not a real place.
    'location.coordinates': { $ne: [0, 0] },
  };

  if (genderFilter && genderFilter !== 'all') {
    filter.gender = new RegExp(`^${genderFilter}$`, 'i');
  }
  if (activeWithinMinutes > 0) {
    const since = new Date(Date.now() - activeWithinMinutes * 60 * 1000);
    filter.$or = [{ isOnline: true }, { lastSeen: { $gte: since } }];
  }
  return filter;
}

/**
 * Build the candidate pool, widening the radius one step at a time.
 *
 * Expansion is driven by how many *unseen* candidates were found, not just how
 * many candidates: a radius packed with people the viewer already saw is what
 * makes Discover feel stale, so it triggers the next ring.
 *
 * Pass 1 is the viewer's configured radius; the wider passes are the same
 * "people from further away" fallback Discover already had, so no distance
 * preference is loosened — only the ordering and the trigger change.
 *
 * Runs at most one geo query and one history query per ring, so the cost is
 * fixed no matter how large the user base gets.
 */
async function fetchCandidatePool({
  viewerId,
  lng,
  lat,
  radiusMetres,
  genderFilter,
  activeWithinMinutes,
  excludeIds,
  poolSize,
  targetCount,
  impressions,
  now = new Date(),
  skipRecentlyShown = true,
}) {
  const [blockedIds, cooldownIds] = await Promise.all([
    getBlockedUserIds(viewerId),
    // Read-only callers get no rotation, so the extra history lookup would be
    // pure cost — and they want whoever is around right now, not fresh faces.
    skipRecentlyShown ? getRecentlyShownIds(viewerId, now) : [],
  ]);
  const excludeSet = new Set([String(viewerId), ...[...excludeIds].map(String), ...blockedIds]);

  const rings = [
    { source: 'nearby', min: 0, max: radiusMetres },
    { source: 'expanded', min: radiusMetres, max: radiusMetres * 4 },
    { source: 'global', min: radiusMetres * 4, max: MAX_RADIUS_METRES },
  ].filter((ring) => ring.max == null || ring.max > ring.min);

  // First sweep skips everyone shown inside the cooldown so the geo scan can
  // reach genuinely unseen profiles. The second sweep lets them back in and
  // only runs when the first could not fill the batch (low supply / a fully
  // explored area), so it costs nothing in a healthy market.
  const passes = rings.map((ring) => ({ ...ring, skipRecent: true }));
  if (cooldownIds.length) {
    passes.push(...rings.map((ring) => ({ ...ring, skipRecent: false })));
  }

  const pool = [];
  const collected = new Set();
  let unseenCount = 0;

  for (const pass of passes) {
    if (pool.length >= MAX_POOL_SIZE) break;
    const fetchLimit = Math.min(poolSize, MAX_POOL_SIZE - pool.length);

    const skip = [...excludeSet, ...collected];
    if (pass.skipRecent) skip.push(...cooldownIds);
    const excludeOids = toObjectIds(skip);

    const near = { $geometry: { type: 'Point', coordinates: [lng, lat] } };
    if (pass.max != null) near.$maxDistance = pass.max;
    if (pass.min > 0) near.$minDistance = pass.min;

    const filter = buildEligibilityFilter({
      excludeOids,
      genderFilter,
      activeWithinMinutes,
    });
    filter.location = { $near: near };

    const docs = await User.find(filter).select(DISCOVERY_SELECT).limit(fetchLimit).lean();

    const freshIds = [];
    for (const doc of docs) {
      const id = String(doc._id);
      if (collected.has(id)) continue;
      collected.add(id);
      freshIds.push(id);
      pool.push({ doc, source: pass.source });
    }
    if (!freshIds.length) continue;

    const history = await getImpressionMap(viewerId, freshIds);
    for (const [id, row] of history) impressions.set(id, row);
    unseenCount += freshIds.filter((id) => !history.has(id)).length;

    if (unseenCount >= targetCount) break;
  }

  return pool;
}

/** Radius rings, best first — mirrors the passes in fetchCandidatePool. */
const RING_BY_SOURCE = { nearby: 0, expanded: 1, global: 2 };

/** Shape a raw user doc into the plain object the pure ranker consumes. */
function toRankableCandidate({ doc, source }, { lat, lng, now }) {
  const [uLng, uLat] = (doc.location?.coordinates || []).map(Number);
  const metres = distanceMetres(lat, lng, uLat, uLng);
  const topSpot = !!(
    doc.discoverTopSpotUntil && new Date(doc.discoverTopSpotUntil).getTime() > now.getTime()
  );

  return {
    id: String(doc._id),
    doc,
    source,
    ring: RING_BY_SOURCE[source] ?? 2,
    distance: Number.isFinite(metres) ? metres : Number.POSITIVE_INFINITY,
    createdAt: doc.createdAt || null,
    isOnline: !!doc.isOnline,
    lastSeen: doc.lastSeen || null,
    name: doc.name,
    photo: doc.photo,
    photos: doc.photos,
    bio: doc.bio,
    interests: doc.interests,
    age: doc.age,
    gender: doc.gender || '',
    plan: getEffectivePlan(doc, now),
    topSpot,
    // Exposure fairness: how many Discover impressions this profile has already
    // received across every viewer.
    exposureCount: Number(doc.discoveryExposureCount) || 0,
    // Mutual relevance: this candidate's own saved Discover filters, so the
    // ranker can ask "would their filters have surfaced me?".
    prefs: normalisePrefs(doc.discoveryPrefs),
  };
}

/**
 * Persist impressions for the profiles actually served in this batch.
 *
 * Only the served slice is recorded — candidates the ranker merely considered
 * are never marked as seen.
 *
 * Concurrency-safe: `$inc` plus an upsert keyed on the unique
 * (viewerId, candidateId) index, so two simultaneous requests cannot create
 * duplicate rows or lose a count.
 */
async function recordImpressions(viewerId, entries, now = new Date()) {
  const viewerOid = toObjectId(viewerId);
  if (!viewerOid || !Array.isArray(entries) || !entries.length) return 0;

  const ops = [];
  const seen = new Set();
  const servedOids = [];
  for (const entry of entries) {
    const candidateOid = toObjectId(entry.candidateId);
    if (!candidateOid) continue;
    const key = String(candidateOid);
    if (key === String(viewerOid) || seen.has(key)) continue;
    seen.add(key);
    servedOids.push(candidateOid);

    ops.push({
      updateOne: {
        filter: { viewerId: viewerOid, candidateId: candidateOid },
        update: {
          $inc: { impressionCount: 1 },
          $set: {
            lastShownAt: now,
            lastBucket: entry.bucket ?? null,
            lastSource: entry.source ?? null,
            lastTier: entry.tier ?? null,
            distanceAtImpression: Number.isFinite(entry.distance)
              ? Math.round(entry.distance)
              : null,
          },
          $setOnInsert: { firstShownAt: now },
        },
        upsert: true,
      },
    });
  }
  if (!ops.length) return 0;

  try {
    await DiscoveryImpression.bulkWrite(ops, { ordered: false });
  } catch (err) {
    // Racing upserts on the unique index can surface as duplicate keys; the
    // retry lands on the existing rows and simply increments them.
    if (err?.code === 11000 || err?.writeErrors?.some((e) => e.code === 11000)) {
      try {
        await DiscoveryImpression.bulkWrite(ops, { ordered: false });
      } catch {
        /* history is best-effort — never fail the feed because of it */
      }
    } else {
      console.error('[discovery] recordImpressions failed:', err.message);
    }
  }

  // Global exposure for fairness — one write for the whole batch, and never a
  // reason to fail the feed.
  try {
    await User.updateMany({ _id: { $in: servedOids } }, { $inc: { discoveryExposureCount: 1 } });
  } catch (err) {
    console.error('[discovery] exposure counter failed:', err.message);
  }

  return ops.length;
}

/**
 * Full Nearby discovery pipeline: eligibility → 7-day rotation ranking →
 * batch selection → relationship hydration → impression tracking.
 *
 * @returns {{ users: Array, hasMore: boolean, diagnostics: object }}
 */
async function buildNearbyBatch({
  viewer,
  radiusMetres,
  genderFilter = '',
  activeWithinMinutes = 0,
  excludeIds = [],
  targetCount = DEFAULT_TARGET_COUNT,
  now = new Date(),
  trackImpressions = true,
}) {
  const coords = viewer.location?.coordinates;
  const [lng, lat] = (coords || []).map(Number);
  const limit = Math.max(0, Math.min(Number(targetCount) || 0, MAX_TARGET_COUNT));

  const dayKey = rotationDayKey(now, ROTATION_TZ_OFFSET_MINUTES);
  const rotationBucket = rotationBucketForDay(dayKey);

  if (!limit) {
    return { users: [], hasMore: false, diagnostics: { rotationDay: dayKey, rotationBucket } };
  }

  // Read-only callers (track=false) get no rotation, so they need no headroom
  // for the ranker to route around history — a much smaller pool serves them.
  const poolSize = trackImpressions
    ? Math.min(MAX_POOL_SIZE, Math.max(MIN_POOL_SIZE, limit * POOL_MULTIPLIER))
    : Math.min(MAX_POOL_SIZE, limit * 2);

  // Populated ring by ring inside fetchCandidatePool so expansion can react to
  // how much of each ring the viewer has already seen.
  const impressions = new Map();
  const pool = await fetchCandidatePool({
    viewerId: viewer._id,
    lng,
    lat,
    radiusMetres,
    genderFilter,
    activeWithinMinutes,
    excludeIds,
    poolSize,
    targetCount: limit,
    impressions,
    now,
    skipRecentlyShown: trackImpressions,
  });

  const candidates = pool.map((item) => toRankableCandidate(item, { lat, lng, now }));

  const { selected, diagnostics } = selectDiscoveryBatch({
    viewerId: String(viewer._id),
    candidates,
    impressions,
    targetCount: limit,
    now,
    rotationBucket,
    excludeIds,
    viewer: { id: String(viewer._id), gender: viewer.gender || '' },
  });

  const friendships = await getFriendshipMap(
    viewer._id,
    selected.map((c) => c.id),
  );

  const users = selected.map((candidate) => {
    const doc = candidate.doc;
    const friendship = friendships.get(candidate.id) || null;
    const areFriends = friendship?.status === 'friends';
    const initiatedBy = friendship ? String(friendship.initiatedBy) : null;
    const iLiked =
      areFriends ||
      friendship?.status === 'mutual_match' ||
      (friendship?.status === 'pending_like' && initiatedBy === String(viewer._id));
    const theyLiked =
      areFriends ||
      friendship?.status === 'mutual_match' ||
      (friendship?.status === 'pending_like' && initiatedBy === candidate.id);

    const metres = Number.isFinite(candidate.distance) ? candidate.distance : NaN;
    const sub = serializeSubscription(candidate.doc, now);

    return {
      id: doc._id,
      publicId: doc.publicId || '',
      name: doc.name,
      age: doc.age,
      bio: doc.bio,
      photo: doc.photo,
      photos: doc.photos || [],
      gender: doc.gender,
      interests: doc.interests,
      height: doc.height,
      relationshipGoal: doc.relationshipGoal || '',
      isOnline: !!doc.isOnline,
      distance: Number.isFinite(metres) ? Math.round(metres) : null,
      distanceKm: Number.isFinite(metres) ? (metres / 1000).toFixed(1) : null,
      friendshipStatus: friendship?.status || 'stranger',
      areFriends: !!areFriends,
      iLiked: !!iLiked,
      theyLiked: !!theyLiked,
      // Frontend only distinguishes in-radius from further-away profiles.
      source: candidate.source === 'nearby' ? 'nearby' : 'random',
      subscriptionBadge: sub.badge,
      subscriptionExpiresAt: sub.expiresAt,
      discoverTopSpot: !!candidate.topSpot,
      _rotation: {
        bucket: candidate.rotationBucket,
        tier: candidate.rotationTier,
        tierName: candidate.rotationTierName,
        source: candidate.source,
        distance: metres,
      },
    };
  });

  if (trackImpressions && users.length) {
    await recordImpressions(
      viewer._id,
      users.map((u) => ({
        candidateId: u.id,
        bucket: u._rotation.bucket,
        tier: u._rotation.tier,
        source: u._rotation.source,
        distance: u._rotation.distance,
      })),
      now,
    );
  }

  for (const u of users) delete u._rotation;

  return {
    users,
    // Only stop paging when the pool itself is exhausted, never because the
    // rotation withheld people.
    hasMore: users.length >= limit && !diagnostics.exhausted,
    diagnostics: { ...diagnostics, rotationDay: dayKey },
  };
}

module.exports = {
  ROTATION_TZ_OFFSET_MINUTES,
  DISCOVERY_SELECT,
  hasRealLocation,
  distanceMetres,
  getBlockedUserIds,
  getFriendshipMap,
  getImpressionMap,
  getRecentlyShownIds,
  normalisePrefs,
  buildEligibilityFilter,
  fetchCandidatePool,
  recordImpressions,
  buildNearbyBatch,
};
