/**
 * Cross-instance online presence.
 *
 * Online = the app is open in the foreground and pinging.
 * Login alone / a backgrounded socket must NOT keep someone "Online now".
 *
 * With Redis: socket refcounts + short-lived "alive" keys (refreshed only by
 * client presence:ping, never by a server auto-timer).
 * Without Redis: in-memory last-foreground map (same TTL semantics).
 */
const { getRedis, isReady } = require('./redis');

const COUNT_KEY = 'presence:count';
const ONLINE_SET = 'presence:online';
/** Must be > client ping interval (≈35s) and match onlineStatus STALE_MS. */
const ALIVE_TTL_SEC = Number(process.env.PRESENCE_ALIVE_TTL_SEC || 90);
const ALIVE_TTL_MS = ALIVE_TTL_SEC * 1000;

/** uid → last foreground ping epoch (local / no-Redis fallback) */
const lastForegroundAt = new Map();

function aliveKey(uid) {
  return `presence:alive:${uid}`;
}

function markForeground(userId) {
  lastForegroundAt.set(String(userId), Date.now());
}

function clearForeground(userId) {
  lastForegroundAt.delete(String(userId));
}

function isForegroundFresh(userId) {
  const t = lastForegroundAt.get(String(userId));
  if (!t) return false;
  return Date.now() - t <= ALIVE_TTL_MS;
}

async function touchAlive(redis, uid) {
  await redis.set(aliveKey(uid), '1', 'EX', ALIVE_TTL_SEC);
}

async function clearAlive(redis, uid) {
  await redis.del(aliveKey(uid));
}

async function socketConnected(userId) {
  const uid = String(userId);
  markForeground(uid);

  const redis = isReady() ? await getRedis() : null;
  if (!redis) return { becameOnline: true, count: 1 };

  const count = await redis.hincrby(COUNT_KEY, uid, 1);
  if (count === 1) {
    await redis.sadd(ONLINE_SET, uid);
  }
  await touchAlive(redis, uid);
  return { becameOnline: count === 1, count };
}

async function socketDisconnected(userId, opts = {}) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;
  if (!redis) {
    // Caller passes stillConnected when another local socket remains
    const still = !!opts.stillConnected;
    if (!still) clearForeground(uid);
    return { becameOffline: !still, count: still ? 1 : 0 };
  }

  let count = await redis.hincrby(COUNT_KEY, uid, -1);
  if (count <= 0) {
    await redis.hdel(COUNT_KEY, uid);
    await redis.srem(ONLINE_SET, uid);
    await clearAlive(redis, uid);
    clearForeground(uid);
    count = 0;
  }
  // Do NOT refresh alive on remaining sockets — only client presence:ping
  // (foreground) keeps Online true. Background sockets must go stale.
  return { becameOffline: count === 0, count };
}

/**
 * Refresh TTL while the app is in the foreground (client heartbeat only).
 * Server must NOT call this on a timer — that made logged-in/background
 * users look permanently online.
 */
async function heartbeat(userId) {
  const uid = String(userId);
  markForeground(uid);

  const redis = isReady() ? await getRedis() : null;
  if (!redis) return { ok: true, live: true };

  const count = Number((await redis.hget(COUNT_KEY, uid)) || 0);
  if (count <= 0) {
    await clearAlive(redis, uid);
    await redis.srem(ONLINE_SET, uid);
    clearForeground(uid);
    return { ok: false, live: false };
  }
  await touchAlive(redis, uid);
  return { ok: true, live: true };
}

async function isUserOnline(userId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;
  if (!redis) return isForegroundFresh(uid);

  const alive = await redis.exists(aliveKey(uid));
  if (!alive) {
    await redis.hdel(COUNT_KEY, uid);
    await redis.srem(ONLINE_SET, uid);
    clearForeground(uid);
    return false;
  }
  return true;
}

/**
 * Batch online check. Always returns a Map (never null).
 * Prefers Redis alive keys; falls back to in-memory foreground pings.
 */
async function areUsersOnline(userIds) {
  const ids = [
    ...new Set((userIds || []).map((id) => String(id)).filter(Boolean)),
  ];
  const map = new Map();
  if (!ids.length) return map;

  const redis = isReady() ? await getRedis() : null;
  if (!redis) {
    for (const id of ids) map.set(id, isForegroundFresh(id));
    return map;
  }

  const pipe = redis.pipeline();
  for (const id of ids) pipe.exists(aliveKey(id));
  const rows = await pipe.exec();

  const stale = [];
  ids.forEach((id, i) => {
    const alive = Number(rows?.[i]?.[1] || 0) === 1;
    map.set(id, alive);
    if (!alive) {
      stale.push(id);
      clearForeground(id);
    }
  });

  if (stale.length) {
    const fix = redis.pipeline();
    for (const id of stale) {
      fix.hdel(COUNT_KEY, id);
      fix.srem(ONLINE_SET, id);
    }
    await fix.exec().catch(() => {});
  }

  return map;
}

async function onlineCount() {
  const redis = isReady() ? await getRedis() : null;
  if (!redis) {
    let n = 0;
    const now = Date.now();
    for (const [, t] of lastForegroundAt) {
      if (now - t <= ALIVE_TTL_MS) n += 1;
    }
    return n;
  }
  return redis.scard(ONLINE_SET);
}

module.exports = {
  socketConnected,
  socketDisconnected,
  heartbeat,
  isUserOnline,
  areUsersOnline,
  onlineCount,
  markForeground,
  clearForeground,
  ALIVE_TTL_SEC,
};
