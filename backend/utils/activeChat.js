/**
 * Who is currently looking at which chat (WhatsApp-style push suppress).
 *
 * Redis mode (REDIS_URL set): shared across all API / socket nodes.
 * Memory mode: single-process Map (local / Expo tunnel).
 *
 * TTL is a crash-safety net only — clients refresh via chat:join / chat:heartbeat
 * while the thread stays open (same idea as WhatsApp keeping a session alive).
 */
const { getRedis, isReady } = require('./redis');

const viewing = new Map(); // fallback: uid -> { otherIds: Set, expiresAt: number }
const KEY_PREFIX = 'chatview:';
/** Crash safety — refreshed by heartbeat while chat is open (was 30m; too long if leave is lost) */
const TTL_SEC = 5 * 60;
const MEMORY_TTL_MS = TTL_SEC * 1000;

function key(userId) {
  return `${KEY_PREFIX}${String(userId)}`;
}

function pruneMemory(uid) {
  const entry = viewing.get(uid);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    viewing.delete(uid);
    return null;
  }
  return entry;
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

  let entry = pruneMemory(uid);
  if (!entry) {
    entry = { otherIds: new Set(), expiresAt: Date.now() + MEMORY_TTL_MS };
    viewing.set(uid, entry);
  }
  entry.otherIds.add(other);
  entry.expiresAt = Date.now() + MEMORY_TTL_MS;
}

/** Refresh TTL if still viewing (heartbeat) — no-op if not in set */
async function touchViewing(userId, otherUserId) {
  const uid = String(userId);
  const other = String(otherUserId);
  if (!uid || !other) return false;

  const redis = isReady() ? await getRedis() : null;
  if (redis) {
    const isMember = (await redis.sismember(key(uid), other)) === 1;
    if (!isMember) return false;
    await redis.expire(key(uid), TTL_SEC);
    return true;
  }

  const entry = pruneMemory(uid);
  if (!entry?.otherIds?.has(other)) return false;
  entry.expiresAt = Date.now() + MEMORY_TTL_MS;
  return true;
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

  const entry = pruneMemory(uid);
  if (!entry) return;
  if (otherUserId) {
    entry.otherIds.delete(String(otherUserId));
    if (entry.otherIds.size === 0) viewing.delete(uid);
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

  const entry = pruneMemory(uid);
  return !!entry?.otherIds?.has(other);
}

async function getViewingSet(userId) {
  const uid = String(userId);
  const redis = isReady() ? await getRedis() : null;

  if (redis) {
    const members = await redis.smembers(key(uid));
    return new Set(members);
  }

  const entry = pruneMemory(uid);
  return entry?.otherIds || new Set();
}

module.exports = {
  markViewing,
  touchViewing,
  clearViewing,
  isViewingChat,
  getViewingSet,
  TTL_SEC,
};
