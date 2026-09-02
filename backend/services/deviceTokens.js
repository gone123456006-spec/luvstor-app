const DeviceToken = require('../models/DeviceToken');

/** Retire a token after this many consecutive transient failures. */
const MAX_FAILURES = 5;

/**
 * Register (or re-assign) an FCM token for a user.
 * Safe to call on every app start — it is an idempotent upsert.
 */
async function registerToken({
  userId,
  token,
  deviceId = null,
  platform = 'android',
  deviceName = '',
  appVersion = '',
}) {
  if (!userId || !token) {
    throw Object.assign(new Error('userId and token are required'), {
      status: 400,
    });
  }

  // Same physical device, new token → drop the stale row first
  if (deviceId) {
    await DeviceToken.deleteMany({
      deviceId,
      token: { $ne: token },
    });
  }

  const doc = await DeviceToken.findOneAndUpdate(
    { token },
    {
      $set: {
        userId,
        token,
        deviceId,
        platform,
        deviceName,
        appVersion,
        active: true,
        invalidReason: null,
        failureCount: 0,
        lastUsedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  return doc;
}

/** Called on logout / device transfer. */
async function removeToken(token) {
  if (!token) return 0;
  const res = await DeviceToken.deleteOne({ token });
  return res.deletedCount || 0;
}

async function removeTokensForDevice(deviceId) {
  if (!deviceId) return 0;
  const res = await DeviceToken.deleteMany({ deviceId });
  return res.deletedCount || 0;
}

async function removeTokensForUser(userId) {
  if (!userId) return 0;
  const res = await DeviceToken.deleteMany({ userId });
  return res.deletedCount || 0;
}

/** Active tokens for one or many users. */
async function getActiveTokens(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (!ids.length) return [];
  const rows = await DeviceToken.find({
    userId: { $in: ids },
    active: true,
  })
    .select('token userId')
    .lean();
  return rows.map((r) => r.token);
}

/** Map of userId → tokens, for per-user personalised sends. */
async function getTokensByUser(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (!ids.length) return new Map();
  const rows = await DeviceToken.find({
    userId: { $in: ids },
    active: true,
  })
    .select('token userId')
    .lean();

  const map = new Map();
  for (const row of rows) {
    const key = String(row.userId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row.token);
  }
  return map;
}

/** Hard-delete tokens FCM told us are permanently dead. */
async function invalidateTokens(tokens, reason = 'unregistered') {
  if (!tokens?.length) return 0;
  const res = await DeviceToken.deleteMany({ token: { $in: tokens } });
  if (res.deletedCount) {
    console.log(`[FCM] Removed ${res.deletedCount} invalid token(s) — ${reason}`);
  }
  return res.deletedCount || 0;
}

/** Track transient failures; retire the token once it keeps failing. */
async function recordFailures(tokens) {
  if (!tokens?.length) return;
  await DeviceToken.updateMany(
    { token: { $in: tokens } },
    { $inc: { failureCount: 1 } },
  );
  await DeviceToken.updateMany(
    { token: { $in: tokens }, failureCount: { $gte: MAX_FAILURES } },
    { $set: { active: false, invalidReason: 'too_many_failures' } },
  );
}

async function recordSuccess(tokens) {
  if (!tokens?.length) return;
  await DeviceToken.updateMany(
    { token: { $in: tokens } },
    { $set: { failureCount: 0, lastUsedAt: new Date() } },
  );
}

module.exports = {
  registerToken,
  removeToken,
  removeTokensForDevice,
  removeTokensForUser,
  getActiveTokens,
  getTokensByUser,
  invalidateTokens,
  recordFailures,
  recordSuccess,
  MAX_FAILURES,
};
