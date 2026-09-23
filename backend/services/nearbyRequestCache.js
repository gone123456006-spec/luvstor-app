/**
 * Short-lived Nearby response cache + in-flight coalescing.
 *
 * Duplicate / overlapping GET /nearby calls (app foreground, tab focus, GPS
 * retry) must not re-run the geo + rotation pipeline. Load-more (exclude list)
 * is not cached — those pages are unique.
 */
const TTL_MS = 10_000;
const MAX_ENTRIES = 400;

const fresh = new Map();
const inflight = new Map();

function cacheKey({
  userId,
  radiusMetres,
  gender,
  activeWithinMinutes,
  limit,
  track,
  excludeCount,
}) {
  return [
    String(userId),
    Number(radiusMetres) || 0,
    String(gender || ''),
    Number(activeWithinMinutes) || 0,
    Number(limit) || 0,
    track ? 1 : 0,
    Number(excludeCount) || 0,
  ].join('|');
}

function getFresh(key) {
  const hit = fresh.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    fresh.delete(key);
    return null;
  }
  return { users: hit.users, hasMore: hit.hasMore };
}

function setFresh(key, result) {
  fresh.set(key, {
    at: Date.now(),
    users: result.users,
    hasMore: result.hasMore,
  });
  if (fresh.size <= MAX_ENTRIES) return;
  const oldest = fresh.keys().next().value;
  if (oldest) fresh.delete(oldest);
}

async function coalesce(key, fn) {
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = Promise.resolve()
    .then(fn)
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

module.exports = {
  TTL_MS,
  cacheKey,
  getFresh,
  setFresh,
  coalesce,
};
