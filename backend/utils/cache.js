/**
 * Small shared cache: Redis when REDIS_URL is reachable, otherwise a bounded
 * in-process map (fine for one Node process / local dev).
 *
 * - getOrSet(key, ttlSec, loader)  — read-through, concurrent misses share one load
 * - version(scope, id) / bump(scope, ids) — per-user version counters; put the
 *   version in a key so a bump makes every older entry unreachable
 *
 * Every Redis failure falls back to running the loader — the cache can never
 * break a request, only slow it down to the uncached speed.
 */
const { getRedis } = require('./redis');

const PREFIX = 'c:';
const MEM_MAX = Math.max(100, Number(process.env.CACHE_MEM_MAX_ITEMS) || 5000);
const VERSION_TTL_SEC = 7 * 24 * 60 * 60;

const mem = new Map();
const memVersions = new Map();
const inflight = new Map();

function memGet(key) {
  const hit = mem.get(key);
  if (!hit) return undefined;
  if (hit.exp < Date.now()) {
    mem.delete(key);
    return undefined;
  }
  return JSON.parse(hit.raw);
}

/** Stored as JSON so callers get a fresh copy and the same shape as from Redis */
function memSet(key, value, ttlSec) {
  if (mem.size >= MEM_MAX) {
    const oldest = mem.keys().next().value;
    mem.delete(oldest);
  }
  mem.set(key, { raw: JSON.stringify(value), exp: Date.now() + ttlSec * 1000 });
}

async function redisOrNull() {
  try {
    return await getRedis();
  } catch {
    return null;
  }
}

async function get(key) {
  const r = await redisOrNull();
  if (r) {
    try {
      const raw = await r.get(PREFIX + key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      /* fall through to memory */
    }
  }
  return memGet(key);
}

async function set(key, value, ttlSec) {
  if (value === undefined) return;
  const ttl = Math.max(1, Math.round(ttlSec));
  const r = await redisOrNull();
  if (r) {
    try {
      await r.set(PREFIX + key, JSON.stringify(value), 'EX', ttl);
      return;
    } catch {
      /* fall through to memory */
    }
  }
  memSet(key, value, ttl);
}

async function del(...keys) {
  const flat = keys.flat().filter(Boolean);
  if (!flat.length) return;
  flat.forEach((k) => mem.delete(k));
  const r = await redisOrNull();
  if (r) {
    try {
      await r.del(...flat.map((k) => PREFIX + k));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Always resolves to a JSON round-trip of the value (ObjectId/Date → string),
 * hit or miss, so code behaves the same with and without a warm cache.
 */
async function getOrSet(key, ttlSec, loader) {
  const cached = await get(key);
  if (cached !== undefined) return cached;

  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      try {
        const value = await loader();
        if (value === undefined) return undefined;
        const raw = JSON.stringify(value);
        await set(key, JSON.parse(raw), ttlSec);
        return raw;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }
  const raw = await p;
  return raw === undefined ? undefined : JSON.parse(raw);
}

function versionKey(scope, id) {
  return `v:${scope}:${id}`;
}

async function version(scope, id) {
  const k = versionKey(scope, id);
  const r = await redisOrNull();
  if (r) {
    try {
      return Number(await r.get(PREFIX + k)) || 0;
    } catch {
      /* fall through */
    }
  }
  return memVersions.get(k) || 0;
}

/** Invalidate everything keyed on `version(scope, id)` for each id */
async function bump(scope, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String))];
  if (!list.length) return;
  // Versions and values are dropped together so a reset counter can't revive old entries
  if (memVersions.size > 200_000) {
    memVersions.clear();
    mem.clear();
  }
  list.forEach((id) => {
    const k = versionKey(scope, id);
    memVersions.set(k, (memVersions.get(k) || 0) + 1);
  });
  const r = await redisOrNull();
  if (!r) return;
  try {
    const multi = r.multi();
    list.forEach((id) => {
      const k = PREFIX + versionKey(scope, id);
      multi.incr(k);
      multi.expire(k, VERSION_TTL_SEC);
    });
    await multi.exec();
  } catch {
    /* entries still expire by TTL */
  }
}

/** Test helper */
function _resetMemory() {
  mem.clear();
  memVersions.clear();
  inflight.clear();
}

module.exports = { get, set, del, getOrSet, version, bump, _resetMemory };
