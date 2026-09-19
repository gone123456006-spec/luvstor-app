/**
 * Effective online status for API responses.
 *
 * Mongo `User.isOnline` can stick true after crashes / missed disconnects.
 * Truth = live socket presence (Redis heartbeat) when available, otherwise
 * Mongo flag only if lastSeen was refreshed recently (client heartbeat).
 */
const presence = require('./presence');

/** Without a fresh ping, treat "online" as stale (must match client ping ≤45s). */
const STALE_MS = Number(process.env.PRESENCE_STALE_MS || 90_000);

function mongoLooksOnline(doc) {
  if (!doc || !doc.isOnline) return false;
  if (!doc.lastSeen) return false;
  const t = new Date(doc.lastSeen).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= STALE_MS;
}

/**
 * Resolve isOnline for many users. Prefers Redis alive heartbeats.
 * @param {Array<{_id?: any, id?: any, isOnline?: boolean, lastSeen?: any}>} docs
 * @returns {Promise<Map<string, boolean>>}
 */
async function resolveOnlineMap(docs) {
  const list = Array.isArray(docs) ? docs : [];
  const ids = [];
  const seen = new Set();
  for (const d of list) {
    const id = String(d?._id || d?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  const live = await presence.areUsersOnline(ids);
  const map = new Map();
  for (const d of list) {
    const id = String(d?._id || d?.id || '');
    if (!id) continue;
    if (live && typeof live.get(id) === 'boolean') {
      map.set(id, live.get(id));
    } else {
      map.set(id, mongoLooksOnline(d));
    }
  }
  return map;
}

function applyOnlineMap(doc, onlineMap) {
  if (!doc) return doc;
  const id = String(doc._id || doc.id || '');
  const isOnline = onlineMap.has(id) ? !!onlineMap.get(id) : mongoLooksOnline(doc);
  return { ...doc, isOnline };
}

module.exports = {
  STALE_MS,
  mongoLooksOnline,
  resolveOnlineMap,
  applyOnlineMap,
};
