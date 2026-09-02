/**
 * Who is currently looking at which chat (WhatsApp-style push suppress).
 *
 * Redis mode (REDIS_URL set): shared across all API / socket nodes.
 * Memory mode: single-process Map (local / Expo tunnel).
 */
const { getRedis, isReady } = require('./redis');

const viewing = new Map(); // fallback
const KEY_PREFIX = 'chatview:';
const TTL_SEC = 60 * 60 * 6; // safety expiry if leave is missed

function key(userId) {
  return `${KEY_PREFIX}${String(userId)}`;
}

async function markViewing(userId, otherUserId) {
  const uid = String(userId);
  const other = String(otherUserId);
  if (!uid || !other || uid === other) return;

  const redis = isReady() ? await getRedis() : null;
  if (redis) {
    await redis.sadd(key(uid), other);
    await redis.expire(key(uid), TTL_SEC);
    return;
  }

  if (!viewing.has(uid)) viewing.set(uid, new Set());
  viewing.get(uid).add(other);
}

async function clearViewing(userId, otherUserId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;

  if (redis) {
    if (otherUserId) {
      await redis.srem(key(uid), String(otherUserId));
    } else {
      await redis.del(key(uid));
    }
    return;
  }

  const set = viewing.get(uid);
  if (!set) return;
  if (otherUserId) {
    set.delete(String(otherUserId));
    if (set.size === 0) viewing.delete(uid);
  } else {
    viewing.delete(uid);
  }
}

async function isViewingChat(userId, otherUserId) {
  const uid = String(userId);
  const other = String(otherUserId);
  const redis = isReady() ? await getRedis() : null;

  if (redis) {
    return (await redis.sismember(key(uid), other)) === 1;
  }

  return !!viewing.get(uid)?.has(other);
}

async function getViewingSet(userId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;

  if (redis) {
    const members = await redis.smembers(key(uid));
    return new Set(members);
  }

  return viewing.get(uid) || new Set();
}

module.exports = {
  markViewing,
  clearViewing,
  isViewingChat,
  getViewingSet,
};
