/**
 * Effective online status for API responses.
 *
 * Online means the client recently heartbeated successfully (Redis alive /
 * network path to server). Mongo `User.isOnline` alone is never enough — it
 * sticks after crashes and after login without an active session.
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
 * Resolve isOnline for many users. Live presence first; Mongo only as last resort.
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

  let live = null;
  try {
    live = await presence.areUsersOnline(ids);
  } catch {
    live = null;
  }

  const map = new Map();
  for (const d of list) {
    const id = String(d?._id || d?.id || '');
    if (!id) continue;
    if (live && live.has(id)) {
      map.set(id, live.get(id) === true);
    } else {
      // Last resort only when presence layer failed entirely
      map.set(id, mongoLooksOnline(d));
    }
  }
  return map;
}

function applyOnlineMap(doc, onlineMap) {
  if (!doc) return doc;
  const id = String(doc._id || doc.id || '');
  const isOnline = onlineMap.has(id)
    ? !!onlineMap.get(id)
    : mongoLooksOnline(doc);
  return { ...doc, isOnline };
}

module.exports = {
  STALE_MS,
  mongoLooksOnline,
  resolveOnlineMap,
  applyOnlineMap,
};
