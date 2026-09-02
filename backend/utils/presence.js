/**
 * Cross-instance online presence.
 *
 * With Redis: socket refcounts so multi-tab / multi-server disconnects are safe.
 * Without Redis: callers keep using the in-process Maps on `io`.
 */
const { getRedis, isReady } = require('./redis');

const COUNT_KEY = 'presence:count';
const ONLINE_SET = 'presence:online';

async function socketConnected(userId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;
  if (!redis) return { becameOnline: true, count: 1 };

  const count = await redis.hincrby(COUNT_KEY, uid, 1);
  if (count === 1) {
    await redis.sadd(ONLINE_SET, uid);
  }
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
    count = 0;
  }
  return { becameOffline: count === 0, count };
}

async function isUserOnline(userId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;
  if (!redis) return null; // caller should use local Maps

  const count = Number(await redis.hget(COUNT_KEY, uid) || 0);
  return count > 0;
}

async function onlineCount() {
  const redis = isReady() ? await getRedis() : null;
  if (!redis) return null;
  return redis.scard(ONLINE_SET);
}

module.exports = {
  socketConnected,
  socketDisconnected,
  isUserOnline,
  onlineCount,
};
