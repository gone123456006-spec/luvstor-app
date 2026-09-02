/**
 * Discovery rotation — pure, dependency-free ranking logic.
 *
 * Kept free of database/network access so the whole 7-day rotation can be
 * unit tested deterministically (see backend/tests/discoveryRotation.test.js).
 *
 * Core idea: every viewer gets their own deterministic 7-bucket rotation of the
 * candidate pool, so "who is fresh today" differs per viewer and per day.
 */

/** Number of daily rotation buckets. */
const ROTATION_BUCKETS = 7;

/** Default profiles per discovery batch. */
const DEFAULT_TARGET_COUNT = 25;

/** Hard cap so a client cannot request an unbounded batch. */
const MAX_TARGET_COUNT = 50;

/**
 * Cap on the per-session exclude list. Keeps the request URL well under the
 * default 16 KB header limit and bounds the `$nin` handed to MongoDB. Far more
 * than any realistic scroll depth, and the most recent ids are the ones kept.
 */
const MAX_SESSION_EXCLUDE = 300;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A profile registered within this window gets an unseen freshness boost. */
const NEW_USER_WINDOW_MS = 3 * DAY_MS;

/** Cooldown ladder used when fresh supply runs out (STEP 5–8 of the pipeline). */
const FULL_COOLDOWN_MS = 7 * DAY_MS;
const RELAXED_COOLDOWN_MS = 3 * DAY_MS;
const SHORT_COOLDOWN_MS = 1 * DAY_MS;

/**
 * "Second chance" window. A profile the viewer scrolled past becomes eligible
 * again after the full cooldown, and is treated as fully forgotten once it has
 * been out of the feed for the upper bound — that is also the horizon used to
 * normalise the recency term of the freshness score.
 */
const SECOND_CHANCE_MIN_MS = FULL_COOLDOWN_MS; // 7 days
const SECOND_CHANCE_MAX_MS = 30 * DAY_MS;

/** Someone seen/online inside this window counts as "recently active". */
const RECENT_ACTIVE_WINDOW_MS = 60 * MINUTE_MS;

/**
 * Global impression count at which exposure fairness bottoms out. Beyond this a
 * profile is considered saturated and stops earning any fairness credit.
 */
const EXPOSURE_SATURATION = 250;

/** Below this lifetime exposure a profile qualifies for the exploration slots. */
const EXPLORATION_MAX_EXPOSURE = 25;

/**
 * Distance bands in metres. Everyone inside a band scores identically, so the
 * ranking never degenerates into a strict "nearest first" list — profiles a few
 * km apart are separated by activity/freshness/fairness instead of raw metres.
 */
const DISTANCE_BANDS = [1000, 5000, 25000, 100000];
const DISTANCE_BAND_SCORES = [1, 0.85, 0.7, 0.5, 0.3];

/**
 * Weights of the dynamic freshness score. They sum to 1 so the score is always
 * 0–1 and stays comparable across pools of different sizes.
 */
const SCORE_WEIGHTS = {
  recency: 0.3, // days since last seen (unseen = full marks)
  activity: 0.2, // recently active / online
  mutual: 0.18, // both sides match each other's discovery filters
  exposure: 0.16, // fairness — under-shown profiles get a lift
  distance: 0.1, // banded, not linear
  quality: 0.04,
  plan: 0.02,
};

/**
 * Reserved slots per batch, tuned for the default 25-profile feed and scaled
 * proportionally for any other target. Categories are filled most-specific
 * first and any category that cannot fill its share hands the slots back to the
 * next-best fresh candidates, so the feed is never short.
 */
const SLOT_PLAN = [
  { key: 'newUser', share: 2 },
  { key: 'exploration', share: 3 },
  { key: 'recentlyActive', share: 5 },
  { key: 'fresh', share: 15 },
];

const SLOT_PLAN_BASE = SLOT_PLAN.reduce((sum, slot) => sum + slot.share, 0);

/**
 * Selection tiers, best first. Freshness dominates every other signal:
 * a never-seen profile always outranks a previously shown one.
 */
const TIER = {
  TOP_SPOT: 0, // paid Black "discover top spot" — preserved from existing logic
  UNSEEN_TODAY_BUCKET: 1,
  UNSEEN_NEW_USER: 2,
  UNSEEN_OTHER_BUCKET: 3,
  COOLDOWN_EXPIRED: 4, // seen, but longer ago than the full cooldown
  COOLDOWN_RELAXED: 5,
  COOLDOWN_SHORT: 6,
  RECENT_REPEAT: 7, // shown within the last day — absolute last resort
};

const TIER_NAMES = Object.keys(TIER).reduce((acc, key) => {
  acc[TIER[key]] = key;
  return acc;
}, {});

/** Highest tier that still means "this viewer has never seen this profile". */
const LAST_UNSEEN_TIER = TIER.UNSEEN_OTHER_BUCKET;

function isUnseenTier(tier) {
  return tier <= LAST_UNSEEN_TIER;
}

/** Subscription weighting, mirrored from services/subscriptions.js. */
const PLAN_RANK = { black: 4, platinum: 3, gold: 2, free: 1 };

/**
 * FNV-1a 32-bit. Deterministic across processes and restarts (unlike
 * Math.random or Object key order), which is what makes buckets stable.
 */
function fnv1a(input) {
  let hash = 0x811c9dc5;
  const str = String(input);
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Viewer-specific bucket for a candidate.
 *
 * The viewer id is part of the hash so the same candidate lands in different
 * buckets for different viewers — nobody sees the same daily rotation.
 */
function bucketForPair(viewerId, candidateId) {
  return fnv1a(`${viewerId}:${candidateId}`) % ROTATION_BUCKETS;
}

/**
 * Server-side day number. Never derived from client input so device clock
 * changes cannot shift a viewer's rotation.
 */
function rotationDayKey(now = new Date(), tzOffsetMinutes = 0) {
  const ms = (now instanceof Date ? now.getTime() : Number(now)) + tzOffsetMinutes * MINUTE_MS;
  return Math.floor(ms / DAY_MS);
}

/** Today's primary bucket (0–6). */
function rotationBucketForDay(dayKey) {
  return ((dayKey % ROTATION_BUCKETS) + ROTATION_BUCKETS) % ROTATION_BUCKETS;
}

function planRankOf(plan) {
  return PLAN_RANK[String(plan || 'free').toLowerCase()] || PLAN_RANK.free;
}

function toTime(value) {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * 0–6 completeness score. Used only as a late tiebreaker so a richer profile
 * wins over a sparse one when everything else is equal.
 */
function profileQualityScore(candidate) {
  let score = 0;
  if (candidate.name && String(candidate.name).trim()) score += 1;
  if (candidate.photo) score += 1;
  if (Array.isArray(candidate.photos) && candidate.photos.length > 0) score += 1;
  if (candidate.bio && String(candidate.bio).trim()) score += 1;
  if (Array.isArray(candidate.interests) && candidate.interests.length > 0) score += 1;
  if (candidate.age) score += 1;
  return score;
}

/** Banded distance score — see DISTANCE_BANDS for why this is not linear. */
function distanceScore(metres) {
  if (!Number.isFinite(metres)) return DISTANCE_BAND_SCORES[DISTANCE_BAND_SCORES.length - 1];
  for (let i = 0; i < DISTANCE_BANDS.length; i += 1) {
    if (metres <= DISTANCE_BANDS[i]) return DISTANCE_BAND_SCORES[i];
  }
  return DISTANCE_BAND_SCORES[DISTANCE_BAND_SCORES.length - 1];
}

/** Which band a distance falls in, exposed for the smart-distance-mix checks. */
function distanceBand(metres) {
  if (!Number.isFinite(metres)) return DISTANCE_BANDS.length;
  for (let i = 0; i < DISTANCE_BANDS.length; i += 1) {
    if (metres <= DISTANCE_BANDS[i]) return i;
  }
  return DISTANCE_BANDS.length;
}

/** 1 for online, decaying to 0 over a week of silence. */
function activityScore(candidate, nowMs) {
  if (candidate.isOnline) return 1;
  const lastSeen = toTime(candidate.lastSeen);
  if (lastSeen == null) return 0;
  const idle = nowMs - lastSeen;
  if (idle <= 15 * MINUTE_MS) return 0.9;
  if (idle <= RECENT_ACTIVE_WINDOW_MS) return 0.8;
  if (idle <= DAY_MS) return 0.6;
  if (idle <= 3 * DAY_MS) return 0.4;
  if (idle <= 7 * DAY_MS) return 0.2;
  return 0;
}

/** Unseen scores full marks; otherwise ramps back up over the second-chance window. */
function recencyScore(lastShownAt, nowMs) {
  if (lastShownAt == null) return 1;
  const since = Math.max(0, nowMs - lastShownAt);
  return Math.min(1, since / SECOND_CHANCE_MAX_MS);
}

/**
 * Fairness credit: profiles that have already been served to lots of viewers
 * earn less, so a handful of popular accounts cannot absorb every impression.
 * The per-viewer impression count is folded in as a secondary penalty.
 */
function exposureScore(globalExposure, viewerImpressions) {
  const global = Math.max(0, Number(globalExposure) || 0);
  const mine = Math.max(0, Number(viewerImpressions) || 0);
  const globalPart = 1 - Math.min(1, global / EXPOSURE_SATURATION);
  const viewerPart = 1 / (1 + mine);
  return globalPart * 0.6 + viewerPart * 0.4;
}

/**
 * How well the viewer fits the candidate's own saved discovery filters.
 *
 * The forward direction (does the candidate fit the viewer's filters?) is
 * already guaranteed by the database query, so only the reverse is scored here.
 * A candidate who has never saved filters scores neutral rather than zero — an
 * unknown preference must never be treated as a rejection.
 */
function mutualRelevanceScore(candidate, viewer) {
  const prefs = candidate.prefs;
  if (!prefs) return 0.5;

  let score = 0;

  const wantedGender = String(prefs.gender || '').trim().toLowerCase();
  const viewerGender = String(viewer?.gender || '').trim().toLowerCase();
  if (!wantedGender || wantedGender === 'all') score += 0.6;
  else if (viewerGender && wantedGender === viewerGender) score += 0.6;

  const radiusKm = Number(prefs.radiusKm);
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) score += 0.4;
  else if (Number.isFinite(candidate.distance) && candidate.distance <= radiusKm * 1000) {
    score += 0.4;
  }

  return score;
}

/**
 * Dynamic freshness score (0–1):
 * unseen/daysSinceLastSeen + recentActivity + mutualRelevance + distance +
 * exposureFairness, plus small profile-quality and plan terms.
 *
 * Used to order the *unseen* pool and to pick which candidates claim the
 * reserved slots. Repeats keep the stricter lexicographic fallback order
 * (longest-unseen first) so the recycling behaviour stays predictable.
 */
function freshnessScore(entry, viewer, nowMs) {
  const w = SCORE_WEIGHTS;
  return (
    w.recency * recencyScore(entry.lastShownAt === Number.NEGATIVE_INFINITY ? null : entry.lastShownAt, nowMs) +
    w.activity * activityScore(entry.candidate, nowMs) +
    w.mutual * mutualRelevanceScore({ ...entry.candidate, distance: entry.distance }, viewer) +
    w.exposure * exposureScore(entry.candidate.exposureCount, entry.impressionCount) +
    w.distance * distanceScore(entry.distance) +
    w.quality * (entry.quality / 6) +
    w.plan * (entry.planRank / 4)
  );
}

/**
 * Turn the abstract slot plan into concrete counts for this batch size.
 * Rounding drift is absorbed by the last (largest) category.
 */
function resolveSlotQuotas(limit) {
  const quotas = {};
  let assigned = 0;
  SLOT_PLAN.forEach((slot, index) => {
    if (index === SLOT_PLAN.length - 1) {
      quotas[slot.key] = Math.max(0, limit - assigned);
      return;
    }
    const share = Math.min(
      Math.max(0, limit - assigned),
      Math.round((slot.share * limit) / SLOT_PLAN_BASE),
    );
    quotas[slot.key] = share;
    assigned += share;
  });
  return quotas;
}

/**
 * Assign a candidate to a selection tier.
 *
 * @param {object} candidate
 * @param {object|null} impression previous viewer→candidate history, if any
 * @param {object} ctx { now, rotationBucket, viewerId }
 */
function classifyCandidate(candidate, impression, ctx) {
  const bucket = bucketForPair(ctx.viewerId, candidate.id);

  // Paid top spot keeps its guaranteed placement (existing Black-tier perk).
  if (candidate.topSpot) {
    return { tier: TIER.TOP_SPOT, bucket };
  }

  const lastShownAt = toTime(impression?.lastShownAt);

  if (!lastShownAt) {
    if (bucket === ctx.rotationBucket) {
      return { tier: TIER.UNSEEN_TODAY_BUCKET, bucket };
    }
    const createdAt = toTime(candidate.createdAt);
    if (createdAt != null && ctx.now - createdAt <= NEW_USER_WINDOW_MS) {
      // New joiners should not wait days for their bucket to come around.
      return { tier: TIER.UNSEEN_NEW_USER, bucket };
    }
    return { tier: TIER.UNSEEN_OTHER_BUCKET, bucket };
  }

  const sinceShown = ctx.now - lastShownAt;
  if (sinceShown >= FULL_COOLDOWN_MS) return { tier: TIER.COOLDOWN_EXPIRED, bucket };
  if (sinceShown >= RELAXED_COOLDOWN_MS) return { tier: TIER.COOLDOWN_RELAXED, bucket };
  if (sinceShown >= SHORT_COOLDOWN_MS) return { tier: TIER.COOLDOWN_SHORT, bucket };
  return { tier: TIER.RECENT_REPEAT, bucket };
}

/** Last-resort deterministic tiebreak, so every comparator is a total order. */
function compareStable(a, b) {
  if (a.shuffle !== b.shuffle) return a.shuffle - b.shuffle;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Ordering inside a tier.
 *
 * Unseen profiles are ordered by the dynamic freshness score, which is where
 * activity, mutual relevance, banded distance and exposure fairness all get to
 * influence the feed.
 *
 * Repeats keep the stricter lexicographic fallback — longest-unseen first, then
 * least-shown — because "recycle the oldest first" has to be predictable rather
 * than a blend that lets a nearby profile jump the recycling queue.
 */
function compareWithinTier(a, b) {
  if (a.unseen && b.unseen) {
    if (a.score !== b.score) return b.score - a.score;
    return compareStable(a, b);
  }
  if (a.lastShownAt !== b.lastShownAt) return a.lastShownAt - b.lastShownAt;
  if (a.impressionCount !== b.impressionCount) return a.impressionCount - b.impressionCount;
  if (a.exposureCount !== b.exposureCount) return a.exposureCount - b.exposureCount;
  if (a.planRank !== b.planRank) return b.planRank - a.planRank;
  if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
  if (a.lastSeen !== b.lastSeen) return b.lastSeen - a.lastSeen;
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.quality !== b.quality) return b.quality - a.quality;
  return compareStable(a, b);
}

/** The full presentation order applied to the final batch. */
function compareRanked(a, b) {
  // Paid top spot is pinned regardless of ring or freshness.
  if (a.topSpot !== b.topSpot) return a.topSpot ? -1 : 1;
  // Freshness is the outermost signal: a profile this viewer has never seen
  // always beats a repeat, however close the repeat is. Without this, a
  // viewer whose immediate radius is fully seen would get 25 repeats while
  // unseen people sat one ring further out.
  if (a.unseen !== b.unseen) return a.unseen ? -1 : 1;
  // Inside one freshness class the viewer's radius preference decides, so the
  // rotation never promotes someone 80 km away over an equally fresh neighbour.
  if (a.ring !== b.ring) return a.ring - b.ring;
  if (a.tier !== b.tier) return a.tier - b.tier;
  return compareWithinTier(a, b);
}

/**
 * Rank an eligible candidate pool and pick one discovery batch.
 *
 * Implements the fallback pipeline: unseen (today's bucket → new users → other
 * buckets) first, then progressively relaxed cooldowns, and only finally very
 * recent repeats — so the feed stays full without repeating yesterday's people
 * while unseen ones are still available.
 *
 * @param {object} params
 * @param {string} params.viewerId
 * @param {Array}  params.candidates eligible candidates (already filtered)
 * @param {Map|object} params.impressions candidateId → { lastShownAt, impressionCount }
 * @param {number} [params.targetCount]
 * @param {Date|number} [params.now]
 * @param {number} [params.rotationBucket]
 * @param {Iterable<string>} [params.excludeIds] ids already served this session
 * @param {object} [params.viewer] { gender } — used for mutual relevance
 * @returns {{ selected: Array, diagnostics: object }}
 */
function selectDiscoveryBatch({
  viewerId,
  candidates = [],
  impressions = new Map(),
  targetCount = DEFAULT_TARGET_COUNT,
  now = new Date(),
  rotationBucket,
  excludeIds = [],
  viewer = null,
}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const bucketToday =
    rotationBucket == null ? rotationBucketForDay(rotationDayKey(new Date(nowMs))) : rotationBucket;

  const getImpression = (id) =>
    impressions instanceof Map ? impressions.get(id) : impressions?.[id];

  const excluded = new Set([...excludeIds].map(String));
  if (viewerId != null) excluded.add(String(viewerId));

  const ctx = { now: nowMs, rotationBucket: bucketToday, viewerId: String(viewerId) };

  const seenIds = new Set();
  const ranked = [];

  for (const candidate of candidates) {
    if (!candidate || candidate.id == null) continue;
    const id = String(candidate.id);
    // Guarantees no duplicate profile inside a single batch, even if the
    // radius-expansion passes returned the same person twice.
    if (excluded.has(id) || seenIds.has(id)) continue;
    seenIds.add(id);

    const impression = getImpression(id) || null;
    const { tier, bucket } = classifyCandidate({ ...candidate, id }, impression, ctx);
    const lastShownAt = toTime(impression?.lastShownAt);
    const distance = Number.isFinite(Number(candidate.distance))
      ? Number(candidate.distance)
      : Number.POSITIVE_INFINITY;

    const createdAt = toTime(candidate.createdAt);
    const lastSeen = toTime(candidate.lastSeen) ?? 0;
    const unseen = isUnseenTier(tier);

    const entry = {
      id,
      candidate,
      tier,
      bucket,
      unseen,
      topSpot: !!candidate.topSpot,
      // Unseen sorts before everything previously shown.
      lastShownAt: lastShownAt == null ? Number.NEGATIVE_INFINITY : lastShownAt,
      impressionCount: Number(impression?.impressionCount) || 0,
      exposureCount: Math.max(0, Number(candidate.exposureCount) || 0),
      planRank: planRankOf(candidate.plan),
      isOnline: !!candidate.isOnline,
      lastSeen,
      distance,
      band: distanceBand(distance),
      // 0 = inside the viewer's radius, 1 = first expansion, 2 = anywhere.
      ring: Number(candidate.ring) || 0,
      quality: profileQualityScore(candidate),
      shuffle: fnv1a(`${ctx.viewerId}:${id}:${bucketToday}`),
      isNewUser: createdAt != null && nowMs - createdAt <= NEW_USER_WINDOW_MS,
      isRecentlyActive: !!candidate.isOnline || nowMs - lastSeen <= RECENT_ACTIVE_WINDOW_MS,
    };
    entry.score = freshnessScore(entry, viewer, nowMs);
    ranked.push(entry);
  }

  ranked.sort(compareRanked);

  const limit = Math.max(0, Math.min(Number(targetCount) || 0, MAX_TARGET_COUNT));
  const quotas = resolveSlotQuotas(limit);

  // Whoever would have made the cut on rank alone. The exploration slots
  // deliberately look *outside* this set — that is what makes them exploration.
  const naturalTop = new Set(ranked.slice(0, limit).map((e) => e.id));

  const pickedIds = new Set();
  const picked = [];
  const slotCounts = {};

  const claim = (key, pool) => {
    const quota = quotas[key] || 0;
    let taken = 0;
    for (const entry of pool) {
      if (taken >= quota || picked.length >= limit) break;
      if (pickedIds.has(entry.id)) continue;
      pickedIds.add(entry.id);
      picked.push(entry);
      taken += 1;
    }
    slotCounts[key] = taken;
  };

  // Every reserved slot draws from the unseen pool only: a reservation must
  // never be a back door for repeats while fresh people are still available.
  const unseenPool = ranked.filter((e) => e.unseen);

  claim(
    'newUser',
    unseenPool.filter((e) => e.isNewUser),
  );
  claim(
    'exploration',
    unseenPool
      .filter((e) => !naturalTop.has(e.id) && e.exposureCount < EXPLORATION_MAX_EXPOSURE)
      .sort((a, b) => {
        if (a.exposureCount !== b.exposureCount) return a.exposureCount - b.exposureCount;
        if (a.score !== b.score) return b.score - a.score;
        return compareStable(a, b);
      }),
  );
  claim(
    'recentlyActive',
    unseenPool.filter((e) => e.isRecentlyActive),
  );
  claim('fresh', unseenPool);

  // Low supply: reserved categories could not fill the batch, so recycle the
  // best remaining candidates (oldest / least-shown first) rather than return
  // a short feed.
  let backfilled = 0;
  for (const entry of ranked) {
    if (picked.length >= limit) break;
    if (pickedIds.has(entry.id)) continue;
    pickedIds.add(entry.id);
    picked.push(entry);
    backfilled += 1;
  }
  slotCounts.backfill = backfilled;

  // Reserved slots decide *who* is in the batch; rank decides the order they
  // are presented in, so the feed still reads freshest-first.
  picked.sort(compareRanked);

  const tierCounts = {};
  const bandCounts = {};
  for (const entry of picked) {
    const name = TIER_NAMES[entry.tier];
    tierCounts[name] = (tierCounts[name] || 0) + 1;
    bandCounts[entry.band] = (bandCounts[entry.band] || 0) + 1;
  }

  const unseenSelected = picked.filter((e) => e.unseen).length;

  return {
    selected: picked.map((entry) => ({
      ...entry.candidate,
      id: entry.id,
      rotationBucket: entry.bucket,
      rotationTier: entry.tier,
      rotationTierName: TIER_NAMES[entry.tier],
      rotationRing: entry.ring,
      rotationScore: Number(entry.score.toFixed(4)),
    })),
    diagnostics: {
      rotationBucket: bucketToday,
      eligibleCount: ranked.length,
      selectedCount: picked.length,
      targetCount: limit,
      // True when the pool genuinely ran dry, not when the 7-day rule kicked in.
      exhausted: ranked.length <= limit,
      // True when there were not enough unseen profiles to fill the batch.
      lowSupply: unseenSelected < limit,
      unseenSelected,
      quotas,
      slotCounts,
      tierCounts,
      bandCounts,
    },
  };
}

module.exports = {
  ROTATION_BUCKETS,
  DEFAULT_TARGET_COUNT,
  MAX_TARGET_COUNT,
  MAX_SESSION_EXCLUDE,
  NEW_USER_WINDOW_MS,
  FULL_COOLDOWN_MS,
  RELAXED_COOLDOWN_MS,
  SHORT_COOLDOWN_MS,
  SECOND_CHANCE_MIN_MS,
  SECOND_CHANCE_MAX_MS,
  RECENT_ACTIVE_WINDOW_MS,
  EXPOSURE_SATURATION,
  EXPLORATION_MAX_EXPOSURE,
  DISTANCE_BANDS,
  SCORE_WEIGHTS,
  SLOT_PLAN,
  TIER,
  TIER_NAMES,
  LAST_UNSEEN_TIER,
  isUnseenTier,
  fnv1a,
  bucketForPair,
  rotationDayKey,
  rotationBucketForDay,
  profileQualityScore,
  distanceBand,
  distanceScore,
  activityScore,
  recencyScore,
  exposureScore,
  mutualRelevanceScore,
  resolveSlotQuotas,
  classifyCandidate,
  selectDiscoveryBatch,
};
