/**
 * For You feed — production recommendation layer for Discover.
 *
 * Scale design:
 * - One geo query (capped pool), score in memory, cache ranked IDs in Redis
 * - Pages read from cache (no re-query / no excludeIds+page conflict)
 * - Blocks excluded; Nearby rotation untouched
 */

const mongoose = require("mongoose");
const User = require("../models/User");
const {
  buildEligibilityFilter,
  hasRealLocation,
  getFriendshipMap,
  getBlockedUserIds,
} = require("./discovery");
const { serializeSubscription, todayKey } = require("./subscriptions");
const {
  resolveShowMe,
  toGenderFilter,
  canonicalShowMe,
} = require("../utils/showMe");
const { getRedis } = require("../utils/redis");

const FOR_YOU_SELECT =
  "publicId name age bio photo photos gender interests height relationshipGoal " +
  "isOnline lastSeen location createdAt subscriptionPlan subscriptionExpiresAt " +
  "photoVerification discoveryPrefs showMe";

const EARTH_RADIUS_METRES = 6378100;
const DEFAULT_RADIUS_KM = 80;
/** Cap geo pool so scoring stays O(pool) even at millions of users */
const MAX_POOL = 300;
const MAX_RANKED = 200;
const MAX_PAGE = 40;
const CACHE_TTL_SEC = 600;
const MAX_EXCLUDE = 100;

function toObjectId(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function haversineMetres(lng1, lat1, lng2, lat2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a)));
}

function interestOverlap(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length)
    return 0;
  const setB = new Set(b.map((x) => String(x).toLowerCase()));
  let hits = 0;
  for (const item of a) {
    if (setB.has(String(item).toLowerCase())) hits += 1;
  }
  return hits;
}

function scoreCandidate(viewer, candidate, metres) {
  const reasons = [];
  let score = 0;

  const overlap = interestOverlap(viewer.interests, candidate.interests);
  if (overlap > 0) {
    score += Math.min(40, overlap * 12);
    reasons.push(`${overlap} shared interest${overlap === 1 ? "" : "s"}`);
  }

  if (candidate.photoVerification?.status === "approved") {
    score += 18;
    reasons.push("Photo verified");
  }

  if (candidate.isOnline) {
    score += 12;
    reasons.push("Online now");
  }

  if (Number.isFinite(metres)) {
    if (metres <= 5_000) {
      score += 20;
      reasons.push("Very close");
    } else if (metres <= 20_000) {
      score += 12;
      reasons.push("Nearby");
    } else if (metres <= 50_000) {
      score += 6;
    }
  }

  const theirFilter = toGenderFilter(resolveShowMe(candidate));
  const myGender = (canonicalShowMe(viewer.gender) || "").toLowerCase();
  if (
    !theirFilter ||
    theirFilter === "all" ||
    (myGender && theirFilter === myGender)
  ) {
    score += 10;
  }

  if (candidate.photo || (candidate.photos && candidate.photos.length)) {
    score += 5;
  }

  if (candidate.createdAt) {
    const ageDays =
      (Date.now() - new Date(candidate.createdAt).getTime()) /
      (24 * 60 * 60 * 1000);
    if (ageDays <= 14) {
      score += 8;
      reasons.push("New on Luvstor");
    }
  }

  return { score, reasons: reasons.slice(0, 3) };
}

function cacheKey(viewerId, dayKey) {
  return `foryou:v1:${viewerId}:${dayKey}`;
}

async function readRankedCache(viewerId) {
  try {
    const r = await getRedis();
    if (!r) return null;
    const raw = await r.get(cacheKey(viewerId, todayKey()));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeRankedCache(viewerId, ranked) {
  try {
    const r = await getRedis();
    if (!r) return;
    await r.set(
      cacheKey(viewerId, todayKey()),
      JSON.stringify(ranked),
      "EX",
      CACHE_TTL_SEC,
    );
  } catch {
    /* cache is optional */
  }
}

async function buildRankedList(viewer, excludeSet) {
  const [lng, lat] = viewer.location.coordinates.map(Number);
  const radiusKm =
    Number(viewer.distance) > 0 ? Number(viewer.distance) : DEFAULT_RADIUS_KM;
  const radiusMetres = Math.min(Math.max(radiusKm, 5), 200) * 1000;

  const genderFilter = toGenderFilter(resolveShowMe(viewer));
  const baseExclude = [...excludeSet].map(toObjectId).filter(Boolean);

  const eligibility = buildEligibilityFilter({
    excludeOids: baseExclude,
    genderFilter: genderFilter || "",
    activeWithinMinutes: 0,
  });

  const query = {
    ...eligibility,
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
        $maxDistance: radiusMetres,
      },
    },
  };

  const pool = await User.find(query)
    .select(FOR_YOU_SELECT)
    .limit(MAX_POOL)
    .lean();

  const scored = [];
  for (const doc of pool) {
    const id = String(doc._id);
    if (excludeSet.has(id)) continue;
    const [clng, clat] = (doc.location?.coordinates || []).map(Number);
    const metres =
      Number.isFinite(clng) && Number.isFinite(clat)
        ? haversineMetres(lng, lat, clng, clat)
        : NaN;
    const { score, reasons } = scoreCandidate(viewer, doc, metres);
    scored.push({
      id,
      score: Math.round(score),
      metres: Number.isFinite(metres) ? Math.round(metres) : null,
      reasons,
    });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.metres ?? Number.MAX_SAFE_INTEGER) -
        (b.metres ?? Number.MAX_SAFE_INTEGER),
  );

  return scored.slice(0, MAX_RANKED);
}

async function hydrateUsers(viewer, rankedSlice, now) {
  if (!rankedSlice.length) return [];

  const ids = rankedSlice.map((r) => r.id);
  const oids = ids.map(toObjectId).filter(Boolean);
  const docs = await User.find({ _id: { $in: oids } })
    .select(FOR_YOU_SELECT)
    .lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const friendships = await getFriendshipMap(viewer._id, ids);
  const metaById = new Map(rankedSlice.map((r) => [r.id, r]));

  return ids
    .map((id) => {
      const doc = byId.get(id);
      const meta = metaById.get(id);
      if (!doc || !meta) return null;

      const friendship = friendships.get(id) || null;
      const areFriends = friendship?.status === "friends";
      const initiatedBy = friendship ? String(friendship.initiatedBy) : null;
      const iLiked =
        areFriends ||
        friendship?.status === "mutual_match" ||
        (friendship?.status === "pending_like" &&
          initiatedBy === String(viewer._id));
      const theyLiked =
        areFriends ||
        friendship?.status === "mutual_match" ||
        (friendship?.status === "pending_like" && initiatedBy === id);
      const sub = serializeSubscription(doc, now);
      const metres = meta.metres;

      return {
        id: doc._id,
        publicId: doc.publicId || "",
        name: doc.name,
        age: doc.age,
        bio: doc.bio,
        photo: doc.photo,
        photos: doc.photos || [],
        gender: doc.gender,
        interests: doc.interests,
        height: doc.height,
        relationshipGoal: doc.relationshipGoal || "",
        isOnline: !!doc.isOnline,
        distance: metres,
        distanceKm: metres != null ? (metres / 1000).toFixed(1) : null,
        friendshipStatus: friendship?.status || "stranger",
        areFriends: !!areFriends,
        iLiked: !!iLiked,
        theyLiked: !!theyLiked,
        source: "for_you",
        subscriptionBadge: sub.badge,
        subscriptionExpiresAt: sub.expiresAt,
        photoVerified: doc.photoVerification?.status === "approved",
        matchScore: meta.score,
        matchReasons: meta.reasons || [],
      };
    })
    .filter(Boolean);
}

async function buildForYouBatch({
  viewer,
  page = 1,
  count = 25,
  excludeIds = [],
  now = new Date(),
  forceRefresh = false,
}) {
  const limit = Math.max(1, Math.min(Number(count) || 25, MAX_PAGE));
  const pageNum = Math.max(1, Number(page) || 1);

  if (!hasRealLocation(viewer.location?.coordinates)) {
    return {
      users: [],
      hasMore: false,
      pagination: { page: pageNum, count: limit, hasMore: false },
      reason: "LOCATION_REQUIRED",
      cacheHit: false,
    };
  }

  const blocked = await getBlockedUserIds(viewer._id);
  const excludeSet = new Set([
    String(viewer._id),
    ...blocked,
    ...excludeIds.map(String).slice(0, MAX_EXCLUDE),
  ]);

  let ranked = forceRefresh ? null : await readRankedCache(String(viewer._id));
  let cacheHit = Array.isArray(ranked);

  if (!ranked) {
    ranked = await buildRankedList(viewer, excludeSet);
    await writeRankedCache(String(viewer._id), ranked);
    cacheHit = false;
  } else if (excludeSet.size > 1) {
    // Drop blocked / explicit excludes from cached list without rebuilding
    ranked = ranked.filter((r) => !excludeSet.has(r.id));
  }

  const start = (pageNum - 1) * limit;
  const slice = ranked.slice(start, start + limit);
  const hasMore = start + limit < ranked.length;
  const users = await hydrateUsers(viewer, slice, now);

  return {
    users,
    hasMore,
    pagination: {
      page: pageNum,
      count: limit,
      hasMore,
      totalCached: ranked.length,
    },
    cacheHit,
  };
}

module.exports = {
  buildForYouBatch,
  scoreCandidate,
  interestOverlap,
  MAX_POOL,
  MAX_RANKED,
  CACHE_TTL_SEC,
};
