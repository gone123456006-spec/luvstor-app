const mongoose = require('mongoose');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const DiscoveryImpression = require('../models/DiscoveryImpression');
const {
  getEffectivePlan,
  getPlanEntitlements,
  serializeSubscription,
} = require('./subscriptions');
const {
  DEFAULT_TARGET_COUNT,
  MAX_TARGET_COUNT,
  FULL_COOLDOWN_MS,
  rotationDayKey,
  rotationBucketForDay,
  selectDiscoveryBatch,
} = require('./discoveryRotation');
const { toPersistentMediaUrl, sanitizePhotosArray } = require('../utils/mediaUrl');
const { keepIfUploadPresent } = require('../utils/uploadExists');
const { MAX_PROFILE_PHOTOS } = require('../config/profileLimits');
const timeBasedDiscovery = require('./timeBasedDiscovery');
const { resolveOnlineMap } = require('../utils/onlineStatus');

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

/** Nearby section (positions 1–25) never leaves this radius. */
const NEARBY_HARD_RADIUS_M = 100_000;
const NEARBY_DISTANCE_MIN_KM = 0.1;
const NEARBY_DISTANCE_MAX_KM = 100;
const NEARBY_SECTION_SIZE = 25;
const WIDER_SECTION_SIZE = 25;
const NEARBY_MAX_RESPONSE = 50;
const NEARBY_POOL_SIZE = 150;
const WIDER_POOL_SIZE = 150;

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
  'publicId name age bio photo coverPhoto photos gender interests height relationshipGoal ' +
  'isOnline lastSeen location createdAt subscriptionPlan subscriptionExpiresAt ' +
  'discoverTopSpotUntil discoverTopSpotDate discoveryExposureCount discoveryPrefs photoVerification';

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

/**
 * Real GPS km from the viewer to this person. 0.1–100 only; never "0".
 */
function publicNearbyDistance(metres, _source) {
  if (!Number.isFinite(metres) || metres < 0) {
    return { distanceKm: null, distanceM: null };
  }
  let km = metres / 1000;
  if (km > NEARBY_DISTANCE_MAX_KM) {
    return { distanceKm: null, distanceM: null };
  }
  // 0.1 km (or closer) displays as 1 km; everything else stays real.
  if (km <= 0.1) {
    return { distanceKm: '1', distanceM: Math.round(metres) };
  }
  const distanceKm =
    km < 1
      ? km.toFixed(1)
      : Math.abs(km - Math.round(km)) < 0.05
        ? String(Math.round(km))
        : km.toFixed(1);
  if (distanceKm === '0' || distanceKm === '0.0' || distanceKm === '0.1') {
    return { distanceKm: '1', distanceM: Math.round(metres) };
  }
  return { distanceKm, distanceM: Math.round(metres) };
}

/** Haversine from viewer GPS → profile GPS. Never use the saved preference field. */
function metresFromViewer(lat, lng, doc) {
  const [uLng, uLat] = (doc?.location?.coordinates || []).map(Number);
  return distanceMetres(lat, lng, uLat, uLng);
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
const blockedCache = new Map();
const BLOCKED_TTL_MS = 20_000;

async function getBlockedUserIds(viewerId) {
  const key = String(viewerId);
  const hit = blockedCache.get(key);
  if (hit && Date.now() - hit.at < BLOCKED_TTL_MS) return hit.ids;

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
  const list = [...ids];
  blockedCache.set(key, { at: Date.now(), ids: list });
  if (blockedCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of blockedCache) {
      if (now - v.at > BLOCKED_TTL_MS) blockedCache.delete(k);
    }
  }
  return list;
}

/** Nearby lanes: incoming, friends, fresh, passed, waiting. */
function nearbyLaneRank(friendship, viewerId, candidateId) {
  if (!friendship) return 2;
  const initiatedBy = friendship.initiatedBy
    ? String(friendship.initiatedBy)
    : '';
  if (friendship.status === 'friends' || friendship.status === 'mutual_match') {
    return 1;
  }
  if (friendship.status === 'pending_like') {
    if (initiatedBy === String(candidateId)) return 0;
    if (initiatedBy === String(viewerId)) return 4;
  }
  if (friendship.status === 'declined' && initiatedBy === String(viewerId)) {
    return 3;
  }
  return 2;
}

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
  })
    .select('userA userB status initiatedBy')
    .lean();

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
    .select('candidateId lastShownAt firstShownAt impressionCount lastBucket lastSource nearbyCycle')
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

/** Eligible 100 km users already served in this viewer's current Nearby cycle. */
async function getShownThisNearbyCycleIds(viewerId, cycle) {
  const viewerOid = toObjectId(viewerId);
  const n = Number(cycle);
  if (!viewerOid || !Number.isFinite(n) || n < 1) return [];
  const rows = await DiscoveryImpression.find({
    viewerId: viewerOid,
    lastSource: 'nearby',
    nearbyCycle: n,
  })
    .select('candidateId')
    .limit(RECENT_HISTORY_CAP)
    .lean();
  return rows.map((row) => String(row.candidateId));
}

/**
 * Base eligibility, applied inside MongoDB so ineligible users are never
 * pulled into application memory.
 */
function buildEligibilityFilter({
  excludeOids,
  genderFilter,
  activeWithinMinutes,
  requireVerified = true,
}) {
  const filter = {
    _id: { $nin: excludeOids },
    isDeactivated: { $ne: true },
    // Accounts queued for removal drop out of discovery immediately.
    deletionScheduledAt: null,
    // Onboarding incomplete (no display name) => not discoverable.
    name: { $nin: [null, ''] },
    // Schema default [0, 0] means "never shared location" — not a real place.
    'location.coordinates': { $ne: [0, 0] },
  };
  if (requireVerified) filter.isVerified = true;

  if (genderFilter && genderFilter !== 'all') {
    const raw = String(genderFilter).trim();
    const lower = raw.toLowerCase();
    const titled = lower.charAt(0).toUpperCase() + lower.slice(1);
    filter.gender = { $in: [...new Set([raw, lower, titled])] };
  }
  if (activeWithinMinutes > 0) {
    const { STALE_MS } = require('../utils/onlineStatus');
    const onlineFresh = new Date(Date.now() - STALE_MS);
    // Online-only discovery: require live isOnline + fresh lastSeen.
    // Do not treat "logged in recently" as online.
    filter.isOnline = true;
    filter.lastSeen = { $gte: onlineFresh };
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

function pickRandom(items, n) {
  const copy = Array.isArray(items) ? items.slice() : [];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, Math.max(0, n));
}

function candidateId(item) {
  return String(item.id || item.doc?._id || '');
}

/**
 * Split a 100 km geo pool into "core nearby" (viewer radius, already closest-first)
 * and leftover 100 km people used only to fill 1–25.
 */
function splitWithinHardRadius(docs, { lat, lng, coreMaxM, hardMaxM = NEARBY_HARD_RADIUS_M }) {
  const core = [];
  const rest = [];
  for (const doc of docs || []) {
    const [uLng, uLat] = (doc.location?.coordinates || []).map(Number);
    const metres = distanceMetres(lat, lng, uLat, uLng);
    if (!Number.isFinite(metres) || metres > hardMaxM) continue;
    const item = { doc, source: 'nearby', distance: metres };
    if (metres <= coreMaxM) core.push(item);
    else rest.push(item);
  }
  return { core, rest };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Jitter only among people shown around the same time so oldest still win. */
const SIMILAR_SHOWN_MS = 6 * 60 * 60 * 1000;

function impressionTime(row) {
  if (!row?.lastShownAt) return 0;
  const t = new Date(row.lastShownAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Nearby rotation ignores 26–50 / random impressions. */
function nearbyLastShownAt(impression) {
  if (!impression) return 0;
  if (impression.lastSource && impression.lastSource !== 'nearby') return 0;
  return impressionTime(impression);
}

/** 0 = never shown, 1 = 7+ days ago, 2 = 1–7 days ago, 3 = shown today. */
function discoveryRecencyTier(lastShownAt, nowMs) {
  if (!lastShownAt) return 0;
  const ago = nowMs - lastShownAt;
  if (ago >= FULL_COOLDOWN_MS) return 1;
  if (ago >= DAY_MS) return 2;
  return 3;
}

function discoveryJitter(viewerId, candidateId, cycle) {
  const n = Number(cycle) || 1;
  const s = `${viewerId}:${candidateId}:${n}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= Math.imul(n, 2246822519);
  h = Math.imul(h ^ (h >>> 15), 3266489917);
  return h >>> 0;
}

/** 0 = never shown, 1 = shown in a previous cycle, 2 = shown in this cycle. */
function rotationGroup(impression, cycle) {
  const shownAt = nearbyLastShownAt(impression);
  if (!shownAt) return 0;
  const stamped = Number(impression?.nearbyCycle);
  if (!Number.isFinite(stamped) || stamped !== Number(cycle)) return 1;
  return 2;
}

function readNearbyCycle(viewer) {
  const n = Number(viewer?.discoveryPrefs?.nearbyCycle);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function poolCompletedCycle(items, impressions, cycle) {
  if (!items || !items.length) return false;
  const getImp = (id) =>
    impressions instanceof Map ? impressions.get(String(id)) : impressions?.[id];
  return items.every((item) => rotationGroup(getImp(candidateId(item)), cycle) === 2);
}

async function startNextNearbyCycle(viewerId, fromCycle) {
  const next = Number(fromCycle) + 1;
  await User.updateOne(
    {
      _id: viewerId,
      $or: [
        { 'discoveryPrefs.nearbyCycle': fromCycle },
        { 'discoveryPrefs.nearbyCycle': { $exists: false } },
        { 'discoveryPrefs.nearbyCycle': null },
      ],
    },
    {
      $set: {
        'discoveryPrefs.nearbyCycle': next,
        'discoveryPrefs.nearbyCycleAt': new Date(),
      },
    },
  );
  return next;
}

function rankByDiscovery(items, impressions, { viewerId, now = new Date(), cycle = 1, reshuffle = false } = {}) {
  const getImp = (id) =>
    impressions instanceof Map ? impressions.get(String(id)) : impressions?.[id];

  return (items || [])
    .map((item, index) => {
      const id = candidateId(item);
      const impression = getImp(id);
      const shownAt = nearbyLastShownAt(impression);
      const group = rotationGroup(impression, cycle);
      return {
        item,
        id,
        index,
        shownAt,
        group,
        jitter: discoveryJitter(viewerId || '', id, cycle),
      };
    })
    .sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      const da = Number(a.item?.distance);
      const db = Number(b.item?.distance);
      const aDist = Number.isFinite(da) && da >= 0 ? da : Number.POSITIVE_INFINITY;
      const bDist = Number.isFinite(db) && db >= 0 ? db : Number.POSITIVE_INFINITY;
      // Fresh faces: closest km first, then the rest of the 100 km pool.
      if (a.group === 0 && aDist !== bDist) return aDist - bDist;
      if (!reshuffle && a.group !== 0 && a.shownAt !== b.shownAt) {
        const gap = Math.abs(a.shownAt - b.shownAt);
        if (gap > SIMILAR_SHOWN_MS) return a.shownAt - b.shownAt;
      }
      if (!reshuffle && aDist !== bDist) return aDist - bDist;
      if (a.jitter !== b.jitter) return a.jitter - b.jitter;
      if (a.shownAt !== b.shownAt) return a.shownAt - b.shownAt;
      return a.index - b.index;
    })
    .map((row) => row.item);
}

function takeDiscoverySection(
  items,
  impressions,
  { viewerId, now, cycle = 1, reshuffle = false, size = NEARBY_SECTION_SIZE } = {},
) {
  const ranked = rankByDiscovery(items, impressions, { viewerId, now, cycle, reshuffle });
  const unique = [];
  const seen = new Set();
  for (const item of ranked) {
    const id = candidateId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
    if (unique.length >= size) break;
  }
  return unique;
}

function takeNearbySection(core, rest, size = NEARBY_SECTION_SIZE) {
  const first = (core || []).slice(0, size);
  if (first.length >= size) return first;
  const used = new Set(first.map(candidateId));
  const fillPool = (rest || []).filter((item) => !used.has(candidateId(item)));
  return [...first, ...pickRandom(fillPool, size - first.length)];
}

/**
 * 1–25 stay 100 km Nearby only. 26–50 are wider/random, no duplicates.
 * Never pad 1–25 with people outside 100 km.
 */
function assembleMixedFeed(
  nearbyItems,
  widerItems,
  {
    widerSize = WIDER_SECTION_SIZE,
    max = NEARBY_MAX_RESPONSE,
  } = {},
) {
  const nearby = (nearbyItems || []).filter((item) => item && item.source === 'nearby');
  const used = new Set(nearby.map(candidateId).filter(Boolean));
  const more = (widerItems || [])
    .filter((item) => {
      const id = candidateId(item);
      return id && !used.has(id);
    })
    .map((item) => ({ ...item, source: 'random' }))
    .slice(0, widerSize);
  const unique = [];
  const seen = new Set();
  for (const item of [...nearby, ...more]) {
    const id = candidateId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
    if (unique.length >= max) break;
  }
  return unique;
}

function takeWiderSection(docs, selectedIds, { lat, lng, hardMaxM = NEARBY_HARD_RADIUS_M, size = WIDER_SECTION_SIZE }) {
  const pool = [];
  const skip = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  for (const doc of docs || []) {
    const id = String(doc._id);
    if (!id || skip.has(id)) continue;
    const [uLng, uLat] = (doc.location?.coordinates || []).map(Number);
    const metres = distanceMetres(lat, lng, uLat, uLng);
    if (Number.isFinite(metres) && metres <= hardMaxM) continue;
    pool.push({
      doc,
      source: 'random',
      distance: Number.isFinite(metres) ? metres : Number.POSITIVE_INFINITY,
    });
  }
  return pickRandom(pool, size);
}

async function fetchGeoEligible({
  lng,
  lat,
  minDistance = 0,
  maxDistance = null,
  excludeOids,
  genderFilter,
  activeWithinMinutes,
  requireVerified = true,
  limit,
}) {
  const filter = buildEligibilityFilter({
    excludeOids,
    genderFilter,
    activeWithinMinutes,
    requireVerified,
  });
  const near = { $geometry: { type: 'Point', coordinates: [lng, lat] } };
  if (maxDistance != null) near.$maxDistance = maxDistance;
  if (minDistance > 0) near.$minDistance = minDistance;
  filter.location = { $near: near };
  return User.find(filter).select(DISCOVERY_SELECT).limit(Math.max(0, limit)).lean();
}

/** Last-resort fill when geo rings are short — still real accounts, no padding. */
async function fetchEligibleAnywhere({
  excludeOids,
  genderFilter,
  activeWithinMinutes,
  requireVerified = true,
  limit,
}) {
  if (limit <= 0) return [];
  const filter = buildEligibilityFilter({
    excludeOids,
    genderFilter,
    activeWithinMinutes,
    requireVerified,
  });
  return User.find(filter)
    .select(DISCOVERY_SELECT)
    .sort({ lastSeen: -1, _id: 1 })
    .limit(Math.max(0, limit))
    .lean();
}

function docsToRandomItems(docs, { lat, lng, skip }) {
  const used = skip instanceof Set ? skip : new Set(skip || []);
  const items = [];
  for (const doc of docs || []) {
    const id = String(doc._id);
    if (!id || used.has(id)) continue;
    used.add(id);
    const [uLng, uLat] = (doc.location?.coordinates || []).map(Number);
    const metres = distanceMetres(lat, lng, uLat, uLng);
    items.push({
      doc,
      source: 'random',
      distance: Number.isFinite(metres) ? metres : Number.POSITIVE_INFINITY,
    });
  }
  return items;
}

/** Keep the Nearby page full: add real people as random when 100 km is short. */
async function fillRemainingRandom({
  lat,
  lng,
  skip,
  genderFilter,
  activeWithinMinutes,
  need,
}) {
  if (need <= 0) return [];
  const used = skip instanceof Set ? skip : new Set(skip || []);
  const collected = [];

  const take = (docs) => {
    const items = docsToRandomItems(docs, { lat, lng, skip: used });
    collected.push(...items);
  };

  const passes = [
    { genderFilter, activeWithinMinutes, requireVerified: true, geo: true },
    { genderFilter, activeWithinMinutes, requireVerified: true, geo: false },
    { genderFilter: '', activeWithinMinutes: 0, requireVerified: true, geo: false },
    { genderFilter: '', activeWithinMinutes: 0, requireVerified: false, geo: false },
  ];

  for (const pass of passes) {
    const remaining = need - collected.length;
    if (remaining <= 0) break;
    const excludeOids = toObjectIds([...used]);
    const docs = pass.geo
      ? await fetchGeoEligible({
          lng,
          lat,
          maxDistance: 2_000_000,
          excludeOids,
          genderFilter: pass.genderFilter,
          activeWithinMinutes: pass.activeWithinMinutes,
          requireVerified: pass.requireVerified,
          limit: remaining + 10,
        })
      : await fetchEligibleAnywhere({
          excludeOids,
          genderFilter: pass.genderFilter,
          activeWithinMinutes: pass.activeWithinMinutes,
          requireVerified: pass.requireVerified,
          limit: remaining + 10,
        });
    take(docs);
  }
  return collected.slice(0, need);
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
    coverPhoto: doc.coverPhoto || '',
    bio: doc.bio,
    interests: doc.interests,
    age: doc.age,
    gender: doc.gender || '',
    plan: getEffectivePlan(doc, now),
    // Platinum / Black only — Gold and expired plans stay unboosted.
    discoverBoost: !!getPlanEntitlements(doc, now).discoverBoost,
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
            ...(entry.nearbyCycle != null ? { nearbyCycle: entry.nearbyCycle } : {}),
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

  const customWeights = timeBasedDiscovery.isTimeBasedModeEnabled()
    ? timeBasedDiscovery.getTimeAdjustedWeights(now)
    : undefined;
  const customSlotPlan = timeBasedDiscovery.isTimeBasedModeEnabled()
    ? timeBasedDiscovery.getTimeAdjustedSlotPlan(now)
    : undefined;

  const { selected, diagnostics } = selectDiscoveryBatch({
    viewerId: String(viewer._id),
    candidates,
    impressions,
    targetCount: limit,
    now,
    rotationBucket,
    excludeIds,
    viewer: { id: String(viewer._id), gender: viewer.gender || '' },
    customWeights,
    customSlotPlan,
  });

  const friendships = await getFriendshipMap(
    viewer._id,
    selected.map((c) => c.id),
  );

  selected.sort((a, b) => {
    const ra = nearbyLaneRank(friendships.get(a.id), viewer._id, a.id);
    const rb = nearbyLaneRank(friendships.get(b.id), viewer._id, b.id);
    return ra - rb;
  });

  const onlineMap = await resolveOnlineMap(
    selected.map((c) => c.doc).filter(Boolean),
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

    const metres = metresFromViewer(lat, lng, doc);
    const sub = serializeSubscription(candidate.doc, now);
    const isNearby = candidate.source === 'nearby';
    const { distanceKm, distanceM } = publicNearbyDistance(
      metres,
      isNearby ? 'nearby' : candidate.source,
    );

    return {
      id: doc._id,
      publicId: doc.publicId || '',
      name: doc.name,
      age: doc.age,
      bio: doc.bio,
      photo: keepIfUploadPresent(toPersistentMediaUrl(doc.photo)) || '',
      coverPhoto: keepIfUploadPresent(toPersistentMediaUrl(doc.coverPhoto)) || '',
      photos: sanitizePhotosArray(doc.photos || [], MAX_PROFILE_PHOTOS)
        .map((p) => keepIfUploadPresent(p))
        .filter(Boolean),
      gender: doc.gender,
      interests: doc.interests,
      height: doc.height,
      relationshipGoal: doc.relationshipGoal || '',
      isOnline: onlineMap.get(String(doc._id)) === true,
      distance: distanceM,
      distanceKm,
      friendshipStatus:
        friendship?.status === 'declined' ? 'declined' : friendship?.status || 'stranger',
      areFriends: !!areFriends,
      iLiked: !!iLiked,
      theyLiked: !!theyLiked,
      nearbyLowPriority:
        friendship?.status === 'declined' && initiatedBy === String(viewer._id),
      nearbyLane: ['incoming', 'friends', 'fresh', 'passed', 'waiting'][
        nearbyLaneRank(friendship, viewer._id, candidate.id)
      ],
      // Frontend only distinguishes in-radius from further-away profiles.
      source: isNearby ? 'nearby' : 'random',
      subscriptionBadge: sub.badge,
      subscriptionExpiresAt: sub.expiresAt,
      photoVerified: doc.photoVerification?.status === 'approved',
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

function toPublicNearbyUser(candidate, { friendships, onlineMap, viewerId, now, lat, lng }) {
  const doc = candidate.doc;
  const id = String(candidate.id || doc._id);
  const friendship = friendships.get(id) || null;
  const areFriends = friendship?.status === 'friends';
  const initiatedBy = friendship ? String(friendship.initiatedBy) : null;
  const iLiked =
    areFriends ||
    friendship?.status === 'mutual_match' ||
    (friendship?.status === 'pending_like' && initiatedBy === String(viewerId));
  const theyLiked =
    areFriends ||
    friendship?.status === 'mutual_match' ||
    (friendship?.status === 'pending_like' && initiatedBy === id);

  const metres = metresFromViewer(lat, lng, doc);
  const sub = serializeSubscription(doc, now);
  const isNearby = candidate.source === 'nearby';
  const { distanceKm, distanceM } = publicNearbyDistance(
    metres,
    isNearby ? 'nearby' : candidate.source,
  );

  return {
    id: doc._id,
    publicId: doc.publicId || '',
    name: doc.name,
    age: doc.age,
    bio: doc.bio,
    photo: keepIfUploadPresent(toPersistentMediaUrl(doc.photo)) || '',
    coverPhoto: keepIfUploadPresent(toPersistentMediaUrl(doc.coverPhoto)) || '',
    photos: sanitizePhotosArray(doc.photos || [], MAX_PROFILE_PHOTOS)
      .map((p) => keepIfUploadPresent(p))
      .filter(Boolean),
    gender: doc.gender,
    interests: doc.interests,
    height: doc.height,
    relationshipGoal: doc.relationshipGoal || '',
    isOnline: onlineMap.get(id) === true,
    distance: distanceM,
    distanceKm,
    friendshipStatus:
      friendship?.status === 'declined' ? 'declined' : friendship?.status || 'stranger',
    areFriends: !!areFriends,
    iLiked: !!iLiked,
    theyLiked: !!theyLiked,
    nearbyLowPriority:
      friendship?.status === 'declined' && initiatedBy === String(viewerId),
    nearbyLane: ['incoming', 'friends', 'fresh', 'passed', 'waiting'][
      nearbyLaneRank(friendship, viewerId, id)
    ],
    source: isNearby ? 'nearby' : 'random',
    subscriptionBadge: sub.badge,
    subscriptionExpiresAt: sub.expiresAt,
    photoVerified: doc.photoVerification?.status === 'approved',
  };
}

/**
 * Discover Nearby feed:
 *  1–25 = eligible people within 100 km, rotated by a persistent per-viewer cycle
 * 26–50 = wider/random people, no distance, no Nearby impressions
 */
async function buildNearbyFeed({
  viewer,
  radiusMetres,
  genderFilter = '',
  activeWithinMinutes = 0,
  excludeIds = [],
  now = new Date(),
  trackImpressions = true,
}) {
  const coords = viewer.location?.coordinates;
  if (!hasRealLocation(coords)) {
    return { users: [], hasMore: false, diagnostics: { reason: 'no_location' } };
  }
  const [lng, lat] = coords.map(Number);

  const blockedIds = await getBlockedUserIds(viewer._id);
  const excludeSet = new Set([
    String(viewer._id),
    ...[...excludeIds].map(String),
    ...blockedIds,
  ]);
  const requestedRadius = Number(radiusMetres);
  const coreMaxM = Math.min(
    Number.isFinite(requestedRadius) && requestedRadius > 0
      ? requestedRadius
      : NEARBY_HARD_RADIUS_M,
    NEARBY_HARD_RADIUS_M,
  );

  const already = [...excludeIds].map(String).filter(Boolean).length;
  const wantNearby = already === 0 ? NEARBY_SECTION_SIZE : 0;
  const wantWider = Math.min(
    WIDER_SECTION_SIZE,
    Math.max(0, NEARBY_MAX_RESPONSE - already),
  );

  let cycle = readNearbyCycle(viewer);
  let reshuffle = false;
  let pool100 = [];
  if (wantNearby) {
    const shownThisCycle = await getShownThisNearbyCycleIds(viewer._id, cycle);
    const fetch100 = (skipIds) =>
      fetchGeoEligible({
        lng,
        lat,
        maxDistance: NEARBY_HARD_RADIUS_M,
        excludeOids: toObjectIds([...excludeSet, ...skipIds]),
        genderFilter,
        activeWithinMinutes,
        limit: NEARBY_POOL_SIZE,
      });

    let within100 = await fetch100(shownThisCycle);
    if (!within100.length && shownThisCycle.length) {
      cycle = await startNextNearbyCycle(viewer._id, cycle);
      reshuffle = true;
      within100 = await fetch100([]);
    }

    const splitPool = (docs) => {
      const { core, rest } = splitWithinHardRadius(docs, { lat, lng, coreMaxM });
      return [...core, ...rest];
    };
    pool100 = splitPool(within100);

    if (pool100.length < NEARBY_SECTION_SIZE) {
      const extra = splitPool(await fetch100(pool100.map(candidateId)));
      pool100 = [...pool100, ...extra];
    }
  }

  let widerPool = [];
  if (wantWider) {
    const widerMax =
      MAX_RADIUS_METRES == null
        ? 2_000_000
        : Math.max(MAX_RADIUS_METRES, NEARBY_HARD_RADIUS_M + 1);
    if (widerMax > NEARBY_HARD_RADIUS_M) {
      const skip = new Set([...excludeSet, ...pool100.map(candidateId)]);
      const widerDocs = await fetchGeoEligible({
        lng,
        lat,
        minDistance: NEARBY_HARD_RADIUS_M + 1,
        maxDistance: widerMax,
        excludeOids: toObjectIds([...skip]),
        genderFilter,
        activeWithinMinutes,
        limit: WIDER_POOL_SIZE,
      });
      widerPool = takeWiderSection(widerDocs, skip, {
        lat,
        lng,
        size: WIDER_POOL_SIZE,
      });
    }
  }

  const impressions = await getImpressionMap(
    viewer._id,
    pool100.map(candidateId),
  );
  if (wantNearby && !reshuffle && poolCompletedCycle(pool100, impressions, cycle)) {
    cycle = await startNextNearbyCycle(viewer._id, cycle);
    reshuffle = true;
  }
  const nearbyItems = takeDiscoverySection(pool100, impressions, {
    viewerId: String(viewer._id),
    now,
    cycle,
    reshuffle,
    size: wantNearby,
  });
  const fillSlots = Math.max(
    wantWider,
    already === 0 ? NEARBY_MAX_RESPONSE - nearbyItems.length : wantWider,
  );
  let widerItems = pickRandom(widerPool, fillSlots);
  if (widerItems.length < fillSlots) {
    const skip = new Set([
      ...excludeSet,
      ...nearbyItems.map(candidateId),
      ...widerItems.map(candidateId),
    ]);
    const extra = await fillRemainingRandom({
      lat,
      lng,
      skip,
      genderFilter,
      activeWithinMinutes,
      need: fillSlots - widerItems.length,
    });
    widerItems = [...widerItems, ...extra];
  }

  const mixed = already === 0
    ? assembleMixedFeed(nearbyItems, widerItems, {
        widerSize: fillSlots,
        max: NEARBY_MAX_RESPONSE,
      })
    : widerItems;

  const unique = [];
  const seen = new Set();
  for (const item of mixed) {
    const id = candidateId(item);
    if (!id || seen.has(id) || excludeSet.has(id)) continue;
    seen.add(id);
    unique.push({ ...item, id });
    if (unique.length >= NEARBY_MAX_RESPONSE) break;
  }

  const friendships = await getFriendshipMap(
    viewer._id,
    unique.map((item) => item.id),
  );
  const onlineMap = await resolveOnlineMap(unique.map((item) => item.doc).filter(Boolean));
  const users = unique.map((item) =>
    toPublicNearbyUser(item, {
      friendships,
      onlineMap,
      viewerId: viewer._id,
      now,
      lat,
      lng,
    }),
  );

  if (trackImpressions && unique.length) {
    const nearbyShown = unique.filter((item) => item.source === 'nearby');
    if (nearbyShown.length) {
      await recordImpressions(
        viewer._id,
        nearbyShown.map((item) => ({
          candidateId: item.id,
          bucket: null,
          tier: null,
          source: 'nearby',
          nearbyCycle: cycle,
          distance: item.distance,
        })),
        now,
      );
    }
  }

  return {
    users,
    hasMore: false,
    diagnostics: {
      nearbyCount: users.filter((u) => u.source === 'nearby').length,
      widerCount: users.filter((u) => u.source === 'random').length,
      hardRadiusM: NEARBY_HARD_RADIUS_M,
      discovery: true,
      nearbyCycle: cycle,
    },
  };
}

module.exports = {
  ROTATION_TZ_OFFSET_MINUTES,
  DISCOVERY_SELECT,
  NEARBY_HARD_RADIUS_M,
  NEARBY_DISTANCE_MIN_KM,
  NEARBY_DISTANCE_MAX_KM,
  publicNearbyDistance,
  NEARBY_SECTION_SIZE,
  WIDER_SECTION_SIZE,
  NEARBY_MAX_RESPONSE,
  hasRealLocation,
  distanceMetres,
  getBlockedUserIds,
  getFriendshipMap,
  getImpressionMap,
  getRecentlyShownIds,
  getShownThisNearbyCycleIds,
  normalisePrefs,
  buildEligibilityFilter,
  fetchCandidatePool,
  recordImpressions,
  buildNearbyBatch,
  buildNearbyFeed,
  splitWithinHardRadius,
  takeNearbySection,
  takeWiderSection,
  assembleMixedFeed,
  discoveryRecencyTier,
  rankByDiscovery,
  takeDiscoverySection,
  discoveryJitter,
  rotationGroup,
  poolCompletedCycle,
  readNearbyCycle,
  startNextNearbyCycle,
};
