/**
 * Cross-instance online presence.
 *
 * With Redis: socket refcounts + short-lived "alive" keys so crashed / slept
 * instances cannot leave users stuck as online forever.
 * Without Redis: callers keep using the in-process Maps on `io`.
 */
const { getRedis, isReady } = require('./redis');

const COUNT_KEY = 'presence:count';
const ONLINE_SET = 'presence:online';
/** Must be > client ping interval (≈35s) and < STALE_MS used in onlineStatus. */
const ALIVE_TTL_SEC = Number(process.env.PRESENCE_ALIVE_TTL_SEC || 90);

function aliveKey(uid) {
  return `presence:alive:${uid}`;
}

async function touchAlive(redis, uid) {
  await redis.set(aliveKey(uid), '1', 'EX', ALIVE_TTL_SEC);
}

async function clearAlive(redis, uid) {
  await redis.del(aliveKey(uid));
}

async function socketConnected(userId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;
  if (!redis) return { becameOnline: true, count: 1 };

  const count = await redis.hincrby(COUNT_KEY, uid, 1);
  if (count === 1) {
    await redis.sadd(ONLINE_SET, uid);
  }
  await touchAlive(redis, uid);
  return { becameOnline: count === 1, count };
}

async function socketDisconnected(userId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;
  if (!redis) return { becameOffline: true, count: 0 };

  let count = await redis.hincrby(COUNT_KEY, uid, -1);
  if (count <= 0) {
    await redis.hdel(COUNT_KEY, uid);
    await redis.srem(ONLINE_SET, uid);
    await clearAlive(redis, uid);
    count = 0;
  } else {
    // Another socket still open — keep alive fresh
    await touchAlive(redis, uid);
  }
  return { becameOffline: count === 0, count };
}

/** Refresh TTL while the app is in the foreground (client heartbeat). */
async function heartbeat(userId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;
  if (!redis) return { ok: true, live: null };
  const count = Number((await redis.hget(COUNT_KEY, uid)) || 0);
  if (count <= 0) {
    await clearAlive(redis, uid);
    await redis.srem(ONLINE_SET, uid);
    return { ok: false, live: false };
  }
  await touchAlive(redis, uid);
  return { ok: true, live: true };
}

async function isUserOnline(userId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;
  if (!redis) return null; // caller should use local Maps

  const alive = await redis.exists(aliveKey(uid));
  if (!alive) {
    // Self-heal stale refcounts left after process death
    await redis.hdel(COUNT_KEY, uid);
    await redis.srem(ONLINE_SET, uid);
    return false;
  }
  return true;
}

/**
 * Batch online check. Returns Map id→boolean, or null if Redis unavailable.
 */
async function areUsersOnline(userIds) {
  const redis = isReady() ? await getRedis() : null;
  if (!redis) return null;

  const ids = [...new Set((userIds || []).map((id) => String(id)).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const pipe = redis.pipeline();
  for (const id of ids) pipe.exists(aliveKey(id));
  const rows = await pipe.exec();

  const stale = [];
  ids.forEach((id, i) => {
    const alive = Number(rows?.[i]?.[1] || 0) === 1;
    map.set(id, alive);
    if (!alive) stale.push(id);
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
  if (!redis) return null;
  // Prefer counting alive keys via set cardinality (approx) — members without
  // alive are cleaned lazily on read.
  return redis.scard(ONLINE_SET);
}

module.exports = {
  socketConnected,
  socketDisconnected,
  heartbeat,
  isUserOnline,
  areUsersOnline,
  onlineCount,
  ALIVE_TTL_SEC,
};
