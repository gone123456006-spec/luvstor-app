/**
 * Small per-process LRU of hot media bytes (avatars, recent chat photos).
 * Bounded by total bytes; large files are never cached.
 *
 * MEDIA_MEM_CACHE_MB   total budget (default 64, 0 disables)
 * MEDIA_MEM_ITEM_MAX_KB largest single file kept (default 1536)
 */
const BUDGET = Math.max(0, Number(process.env.MEDIA_MEM_CACHE_MB ?? 64)) * 1024 * 1024;
const ITEM_MAX = Math.max(0, Number(process.env.MEDIA_MEM_ITEM_MAX_KB ?? 1536)) * 1024;

const map = new Map();
let total = 0;

function get(id) {
  const hit = map.get(id);
  if (!hit) return null;
  map.delete(id);
  map.set(id, hit);
  return hit;
}

function set(id, entry) {
  if (!BUDGET || !entry?.data || entry.data.length > ITEM_MAX) return;
  const prev = map.get(id);
  if (prev) {
    total -= prev.data.length;
    map.delete(id);
  }
  map.set(id, entry);
  total += entry.data.length;
  while (total > BUDGET && map.size) {
    const [oldId, old] = map.entries().next().value;
    map.delete(oldId);
    total -= old.data.length;
  }
}

function del(id) {
  const prev = map.get(id);
  if (!prev) return;
  total -= prev.data.length;
  map.delete(id);
}

function stats() {
  return { items: map.size, bytes: total, budget: BUDGET };
}

module.exports = { get, set, del, stats };
