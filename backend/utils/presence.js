/**
 * Cross-instance online presence (WhatsApp-style).
 *
 * Online = live socket to this server + recent client heartbeat.
 * App close/kill does NOT instantly Offline — alive TTL / grace does.
 * Logout uses markAway (immediate). Network blips reconnect within grace
 * so peers do not flicker Offline.
 *
 * With Redis: socket refcounts + short-lived "alive" keys (refreshed only by
 * client presence:ping, never by a server auto-timer).
 * Without Redis: in-memory last-heartbeat map (same TTL semantics).
 */
const { getRedis, isReady } = require('./redis');

const COUNT_KEY = 'presence:count';
const ONLINE_SET = 'presence:online';
/** Must be > client ping interval (≈35s) and match onlineStatus STALE_MS. */
const ALIVE_TTL_SEC = Number(process.env.PRESENCE_ALIVE_TTL_SEC || 90);
const ALIVE_TTL_MS = ALIVE_TTL_SEC * 1000;

/** uid → last successful heartbeat epoch (local / no-Redis fallback) */
const lastHeartbeatAt = new Map();

function aliveKey(uid) {
  return `presence:alive:${uid}`;
}

function markHeartbeat(userId) {
  lastHeartbeatAt.set(String(userId), Date.now());
}

function clearHeartbeat(userId) {
  lastHeartbeatAt.delete(String(userId));
}

function isHeartbeatFresh(userId) {
  const t = lastHeartbeatAt.get(String(userId));
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
  markHeartbeat(uid);

  const redis = isReady() ? await getRedis() : null;
  if (!redis) return { becameOnline: true, count: 1 };

  const count = await redis.hincrby(COUNT_KEY, uid, 1);
  if (count === 1) {
    await redis.sadd(ONLINE_SET, uid);
  }
  await touchAlive(redis, uid);
  return { becameOnline: count === 1, count };
}

/**
 * Drop a socket refcount.
 *
 * @param {{ stillConnected?: boolean, immediate?: boolean }} opts
 *   immediate=true → clear alive now (network loss / logout / explicit away).
 *   immediate=false (default) → leave alive TTL so kill/close is not instant Offline.
 */
async function socketDisconnected(userId, opts = {}) {
  const uid = String(userId);
  const immediate = !!opts.immediate;
  const redis = isReady() ? await getRedis() : null;

  if (!redis) {
    const still = !!opts.stillConnected;
    if (!still && immediate) clearHeartbeat(uid);
    // Grace: keep lastHeartbeatAt until TTL / forceOffline
    return {
      becameOffline: !still && immediate,
      count: still ? 1 : 0,
      grace: !still && !immediate && isHeartbeatFresh(uid),
    };
  }

  const raw = await redis.hget(COUNT_KEY, uid);
  const current = Number(raw || 0);
  if (!raw || current <= 0) {
    // Already cleared (e.g. presence:away) — never drive the counter negative
    if (immediate) {
      await redis.hdel(COUNT_KEY, uid);
      await redis.srem(ONLINE_SET, uid);
      await clearAlive(redis, uid);
      clearHeartbeat(uid);
    }
    return { becameOffline: false, count: 0, grace: false };
  }

  let count = await redis.hincrby(COUNT_KEY, uid, -1);
  if (count <= 0) {
    await redis.hdel(COUNT_KEY, uid);
    count = 0;
    if (immediate) {
      await redis.srem(ONLINE_SET, uid);
      await clearAlive(redis, uid);
      clearHeartbeat(uid);
      return { becameOffline: true, count: 0, grace: false };
    }
    // Leave ONLINE_SET + alive key; TTL / forceOffline will finalize Offline.
    return { becameOffline: false, count: 0, grace: true };
  }

  return { becameOffline: false, count, grace: false };
}

/**
 * Explicit offline (logout / session end). Clears presence immediately.
 * Do not use for brief network loss — that is handled by disconnect grace + TTL.
 */
async function markAway(userId) {
  const uid = String(userId);

  const redis = isReady() ? await getRedis() : null;
  if (!redis) {
    const was = isHeartbeatFresh(uid);
    clearHeartbeat(uid);
    return { becameOffline: was, wasOnline: was };
  }

  const wasAlive = (await redis.exists(aliveKey(uid))) === 1;
  await redis.hdel(COUNT_KEY, uid);
  await redis.srem(ONLINE_SET, uid);
  await clearAlive(redis, uid);
  return { becameOffline: wasAlive, wasOnline: wasAlive };
}

/**
 * Finalize Offline after disconnect grace when alive TTL is gone / forced.
 */
async function forceOffline(userId) {
  const uid = String(userId);
  const wasOnline = await isUserOnline(uid);
  clearHeartbeat(uid);

  const redis = isReady() ? await getRedis() : null;
  if (!redis) {
    return { becameOffline: wasOnline };
  }

  await redis.hdel(COUNT_KEY, uid);
  await redis.srem(ONLINE_SET, uid);
  await clearAlive(redis, uid);
  return { becameOffline: wasOnline };
}

/**
 * Refresh TTL while the client can reach the server (client heartbeat only).
 * Server must NOT call this on a timer.
 */
async function heartbeat(userId) {
  const uid = String(userId);
  markHeartbeat(uid);

  const redis = isReady() ? await getRedis() : null;
  if (!redis) return { ok: true, live: true };

  const count = Number((await redis.hget(COUNT_KEY, uid)) || 0);
  if (count <= 0) {
    // Socket not registered — do not invent Online from a stray ping
    await clearAlive(redis, uid);
    await redis.srem(ONLINE_SET, uid);
    clearHeartbeat(uid);
    return { ok: false, live: false };
  }
  await touchAlive(redis, uid);
  return { ok: true, live: true };
}

async function isUserOnline(userId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;
  if (!redis) return isHeartbeatFresh(uid);

  const alive = await redis.exists(aliveKey(uid));
  if (!alive) {
    await redis.hdel(COUNT_KEY, uid);
    await redis.srem(ONLINE_SET, uid);
    clearHeartbeat(uid);
    return false;
  }
  return true;
}

/**
 * Batch online check. Always returns a Map (never null).
 * Prefers Redis alive keys; falls back to in-memory heartbeats.
 */
async function areUsersOnline(userIds) {
  const ids = [
    ...new Set((userIds || []).map((id) => String(id)).filter(Boolean)),
  ];
  const map = new Map();
  if (!ids.length) return map;

  const redis = isReady() ? await getRedis() : null;
  if (!redis) {
    for (const id of ids) map.set(id, isHeartbeatFresh(id));
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
      clearHeartbeat(id);
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
    for (const [, t] of lastHeartbeatAt) {
      if (now - t <= ALIVE_TTL_MS) n += 1;
    }
    return n;
  }
  return redis.scard(ONLINE_SET);
}

/** Ids currently tracked as online (for TTL sweep). */
async function listOnlineIds() {
  const redis = isReady() ? await getRedis() : null;
  if (!redis) {
    const now = Date.now();
    const ids = [];
    for (const [id, t] of lastHeartbeatAt) {
      if (now - t <= ALIVE_TTL_MS) ids.push(id);
    }
    return ids;
  }
  return redis.smembers(ONLINE_SET);
}

/**
 * Ids in the online set whose alive key has expired (stale Online).
 * Callers should finalize Offline + broadcast for each.
 */
async function sweepExpiredOnline() {
  const ids = await listOnlineIds();
  if (!ids.length) return [];
  const live = await areUsersOnline(ids);
  const expired = [];
  for (const id of ids) {
    if (live.get(id) !== true) expired.push(id);
  }
  return expired;
}

// Back-compat aliases used by older call sites
const markForeground = markHeartbeat;
const clearForeground = clearHeartbeat;

module.exports = {
  socketConnected,
  socketDisconnected,
  markAway,
  forceOffline,
  heartbeat,
  isUserOnline,
  areUsersOnline,
  onlineCount,
  listOnlineIds,
  sweepExpiredOnline,
  markForeground,
  clearForeground,
  markHeartbeat,
  clearHeartbeat,
  ALIVE_TTL_SEC,
  ALIVE_TTL_MS,
};
