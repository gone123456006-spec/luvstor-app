/** Tiny TTL cache so dashboards don't re-run heavy aggregations on every refresh. */
const store = new Map();

async function cached(key, ttlMs, loader) {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (hit?.pending) return hit.pending;
  const pending = loader()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((err) => {
      store.delete(key);
      throw err;
    });
  store.set(key, { ...(hit || {}), pending, expiresAt: 0 });
  return pending;
}

function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

module.exports = { cached, invalidate };
