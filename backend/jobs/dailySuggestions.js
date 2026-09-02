/**
 * Daily suggestion digest.
 *
 * Rolls everything a user missed — new likes, new matches, profile visits and
 * new people nearby — into exactly ONE push per day, instead of drip-feeding
 * re-engagement notifications. Users who have nothing waiting get nothing at
 * all: an empty "come back!" nudge is the fastest way to lose a notification
 * permission.
 */

const User = require('../models/User');
const Friendship = require('../models/Friendship');
const { createPersonalNotifications } = require('../services/notifications');
const { countViewersSinceBulk } = require('../services/profileViews');
const { buildEligibilityFilter, hasRealLocation } = require('../services/discovery');
const { resolveShowMe, toGenderFilter } = require('../utils/showMe');

/** Master switch — set DAILY_SUGGESTIONS_ENABLED=false to turn the digest off. */
const ENABLED = process.env.DAILY_SUGGESTIONS_ENABLED !== 'false';

/**
 * Local hour at which the digest goes out, in the timezone described by
 * DAILY_SUGGESTION_TZ_OFFSET_MINUTES (e.g. 330 for IST). Evening by default,
 * when people are most likely to open the app.
 */
const SEND_HOUR = clampInt(process.env.DAILY_SUGGESTION_HOUR, 18, 0, 23);
const TZ_OFFSET_MINUTES = clampInt(process.env.DAILY_SUGGESTION_TZ_OFFSET_MINUTES, 0, -720, 840);

/** Accounts idle for longer than this are left alone. */
const ACTIVE_WITHIN_DAYS = clampInt(process.env.DAILY_SUGGESTION_ACTIVE_DAYS, 30, 1, 365);

/** How far back the digest looks for likes, matches and profile visits. */
const LOOKBACK_HOURS = clampInt(process.env.DAILY_SUGGESTION_LOOKBACK_HOURS, 24, 1, 168);

/** "New people near you" counts joiners from the last week. */
const NEW_JOINER_DAYS = clampInt(process.env.DAILY_SUGGESTION_NEW_JOINER_DAYS, 7, 1, 30);

/**
 * Nearby counts need a geo query per user, so they are only computed for people
 * with no social signal at all — and even then only for a bounded number per
 * run, which keeps the job's cost predictable as the user base grows.
 */
const MAX_NEARBY_LOOKUPS = clampInt(process.env.DAILY_SUGGESTION_MAX_NEARBY, 2000, 0, 100000);

const PAGE_SIZE = 500;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const EARTH_RADIUS_METRES = 6378100;
const DEFAULT_RADIUS_KM = 50;

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Calendar date in the configured timezone — the digest's idempotency key. */
function suggestionDayKey(now = new Date()) {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MINUTES * MINUTE_MS);
  return shifted.toISOString().slice(0, 10);
}

/** Local hour in the configured timezone. */
function localHour(now = new Date()) {
  return new Date(now.getTime() + TZ_OFFSET_MINUTES * MINUTE_MS).getUTCHours();
}

/**
 * The job is scheduled more often than once a day so a restart cannot skip a
 * send; the day key on each notification is what actually enforces "once".
 */
function isSendWindow(now = new Date()) {
  return localHour(now) === SEND_HOUR;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Turn a user's signals into one notification.
 *
 * The strongest signal becomes the title so the tray line is always the most
 * valuable thing waiting; everything else is folded into the body.
 * Returns null when there is nothing worth interrupting someone for.
 */
function composeDigest(signals) {
  const { matches, likes, views, nearby } = signals;
  const extras = [];
  let title = '';
  let deepLink = '/(tabs)';

  if (matches > 0) {
    title = matches === 1 ? 'You have a new match' : `You have ${matches} new matches`;
    deepLink = '/(tabs)/chat';
  } else if (likes > 0) {
    title = `${plural(likes, 'person', 'people')} liked you`;
    deepLink = '/(tabs)/chat';
  } else if (views > 0) {
    title = `${plural(views, 'person', 'people')} viewed your profile`;
  } else if (nearby > 0) {
    title = `${plural(nearby, 'new person', 'new people')} joined near you`;
  } else {
    return null;
  }

  if (matches > 0 && likes > 0) extras.push(`${plural(likes, 'new like', 'new likes')}`);
  if (views > 0 && !title.includes('viewed')) {
    extras.push(`${plural(views, 'profile visit', 'profile visits')}`);
  }
  if (nearby > 0 && !title.includes('joined near you')) {
    extras.push(`${plural(nearby, 'new person', 'new people')} nearby`);
  }

  const body = extras.length
    ? `Also waiting: ${extras.join(' · ')}.`
    : 'Open Luvstor to see who is waiting for you.';

  return { title, body, deepLink };
}

/** New likes and new mutual matches for a whole page of users, in one query. */
async function collectRelationshipSignals(userIds, since) {
  const likes = new Map();
  const matches = new Map();
  if (!userIds.length) return { likes, matches };

  const rows = await Friendship.find({
    $or: [{ userA: { $in: userIds } }, { userB: { $in: userIds } }],
    $and: [
      {
        $or: [
          { status: 'pending_like', likedAt: { $gte: since } },
          { status: 'mutual_match', matchedAt: { $gte: since } },
        ],
      },
    ],
  })
    .select('userA userB status initiatedBy likedAt matchedAt')
    .lean();

  const inPage = new Set(userIds.map(String));
  const bump = (map, id) => map.set(id, (map.get(id) || 0) + 1);

  for (const row of rows) {
    const a = String(row.userA);
    const b = String(row.userB);
    if (row.status === 'mutual_match') {
      // A match is news for both sides.
      if (inPage.has(a)) bump(matches, a);
      if (inPage.has(b)) bump(matches, b);
      continue;
    }
    // A one-way like is only news for the person who was liked.
    const recipient = String(row.initiatedBy) === a ? b : a;
    if (inPage.has(recipient)) bump(likes, recipient);
  }

  return { likes, matches };
}

/**
 * How many eligible people joined near this user recently.
 *
 * `$geoWithin` rather than `$near` because we only need a count — there is
 * nothing to sort, so the query stays cheap.
 */
async function countNewNearby(user, since) {
  const coords = user.location?.coordinates;
  if (!hasRealLocation(coords)) return 0;
  const [lng, lat] = coords.map(Number);

  const radiusKm = Number(user.discoveryPrefs?.radiusKm) || Number(user.distance) || DEFAULT_RADIUS_KM;
  const genderFilter = toGenderFilter(resolveShowMe(user));

  const filter = buildEligibilityFilter({
    excludeOids: [user._id],
    genderFilter,
    activeWithinMinutes: 0,
  });
  filter.createdAt = { $gte: since };
  filter.location = {
    $geoWithin: { $centerSphere: [[lng, lat], (radiusKm * 1000) / EARTH_RADIUS_METRES] },
  };

  try {
    return await User.countDocuments(filter).limit(100);
  } catch (err) {
    console.warn('[dailySuggestions] nearby count failed:', err?.message || err);
    return 0;
  }
}

/**
 * Compose and send today's digest.
 *
 * @param {import('socket.io').Server|null} io
 * @param {{ now?: Date, force?: boolean }} [options] `force` bypasses the
 *   send-window check (used by the admin trigger and by tests).
 */
async function sendDailySuggestions(io, { now = new Date(), force = false } = {}) {
  const stats = { scanned: 0, created: 0, pushed: 0, skipped: null };
  if (!ENABLED) return { ...stats, skipped: 'disabled' };
  if (!force && !isSendWindow(now)) return { ...stats, skipped: 'outside-send-window' };

  const dayKey = suggestionDayKey(now);
  const socialSince = new Date(now.getTime() - LOOKBACK_HOURS * HOUR_MS);
  const joinerSince = new Date(now.getTime() - NEW_JOINER_DAYS * DAY_MS);
  const activeSince = new Date(now.getTime() - ACTIVE_WITHIN_DAYS * DAY_MS);

  let nearbyLookupsLeft = MAX_NEARBY_LOOKUPS;
  let cursor = null;

  for (;;) {
    const pageFilter = {
      isVerified: true,
      isDeactivated: { $ne: true },
      deletionScheduledAt: null,
      name: { $nin: [null, ''] },
      lastSeen: { $gte: activeSince },
      // Digests share the promotions opt-out; filtering here avoids building
      // copy for people who would never receive it.
      'notificationPrefs.promotions': { $ne: false },
    };
    if (cursor) pageFilter._id = { $gt: cursor };

    const page = await User.find(pageFilter)
      .select('_id location distance gender showMe discoveryPrefs')
      .sort({ _id: 1 })
      .limit(PAGE_SIZE)
      .lean();

    if (!page.length) break;
    cursor = page[page.length - 1]._id;
    stats.scanned += page.length;

    const ids = page.map((u) => u._id);
    const [{ likes, matches }, views] = await Promise.all([
      collectRelationshipSignals(ids, socialSince),
      countViewersSinceBulk(ids, socialSince),
    ]);

    const items = [];
    for (const user of page) {
      const id = String(user._id);
      const signals = {
        matches: matches.get(id) || 0,
        likes: likes.get(id) || 0,
        views: views.get(id) || 0,
        nearby: 0,
      };

      // Quiet accounts are the ones a discovery nudge actually helps.
      if (!signals.matches && !signals.likes && !signals.views && nearbyLookupsLeft > 0) {
        nearbyLookupsLeft -= 1;
        signals.nearby = await countNewNearby(user, joinerSince);
      }

      const digest = composeDigest(signals);
      if (!digest) continue;

      items.push({
        userId: id,
        title: digest.title,
        body: digest.body,
        deepLink: digest.deepLink,
        // One digest per user per day, enforced by the unique
        // (userId, dedupeKey) index rather than by bookkeeping in this job.
        dedupeKey: `suggestion:${dayKey}`,
        data: {
          code: 'DAILY_SUGGESTION',
          day: dayKey,
          matches: String(signals.matches),
          likes: String(signals.likes),
          views: String(signals.views),
          nearby: String(signals.nearby),
        },
      });
    }

    if (items.length) {
      const result = await createPersonalNotifications(io, items, {
        type: 'suggestion',
        groupKey: 'daily-suggestion',
      });
      stats.created += result.created;
      stats.pushed += result.pushed;
    }

    if (page.length < PAGE_SIZE) break;
  }

  console.log(
    `[dailySuggestions] ${dayKey}: scanned ${stats.scanned}, sent ${stats.created}, pushed ${stats.pushed}`,
  );
  return stats;
}

/**
 * Which day this process has already sent. The dedupe key makes a second run
 * harmless, but there is no point re-scanning every account for it.
 */
let lastRunDayKey = null;

/**
 * Scheduler entry point. Safe to call as often as you like: it only does work
 * inside the send window, and only once per day per process.
 */
async function runDailySuggestionsIfDue(io, now = new Date()) {
  if (!ENABLED) return { skipped: 'disabled' };
  if (!isSendWindow(now)) return { skipped: 'outside-send-window' };

  const dayKey = suggestionDayKey(now);
  if (lastRunDayKey === dayKey) return { skipped: 'already-ran-today' };
  lastRunDayKey = dayKey;

  try {
    return await sendDailySuggestions(io, { now, force: true });
  } catch (err) {
    // Let the next tick retry rather than losing the whole day.
    lastRunDayKey = null;
    console.error('[dailySuggestions] run failed:', err?.message || err);
    return { skipped: 'error', error: err?.message || String(err) };
  }
}

module.exports = {
  sendDailySuggestions,
  runDailySuggestionsIfDue,
  composeDigest,
  suggestionDayKey,
  isSendWindow,
  localHour,
  SEND_HOUR,
  TZ_OFFSET_MINUTES,
  ENABLED,
};
