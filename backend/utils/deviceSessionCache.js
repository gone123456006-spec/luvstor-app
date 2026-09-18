/**
 * Short-lived cache of activeDeviceId so auth middleware skips a Mongo round-trip
 * on every authenticated request (WhatsApp-like snappy API feel).
 */
const TTL_MS = 60_000;
const cache = new Map(); // userId -> { deviceId, expiresAt }

function getCachedActiveDevice(userId) {
  const key = String(userId);
  const row = cache.get(key);
  if (!row) return undefined;
  if (Date.now() > row.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return row.deviceId; // string | null
}

function setCachedActiveDevice(userId, deviceId) {
  cache.set(String(userId), {
    deviceId: deviceId == null ? null : String(deviceId),
    expiresAt: Date.now() + TTL_MS,
  });
}

function invalidateActiveDevice(userId) {
  if (userId == null) return;
  cache.delete(String(userId));
}

module.exports = {
  getCachedActiveDevice,
  setCachedActiveDevice,
  invalidateActiveDevice,
};
