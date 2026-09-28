const { User, DeviceToken } = require('../models/app');

/**
 * Sign a user out of the app. The app's auth middleware rejects requests once
 * activeDeviceId no longer matches the JWT (its per-instance cache expires
 * within 60s). The app re-registers its push token (active: true) on next sign-in.
 */
async function revokeAppSessions(userId) {
  await User.updateOne({ _id: userId }, { $set: { activeDeviceId: null, activeDeviceBoundAt: null } });
  await DeviceToken.updateMany(
    { userId, active: true },
    { $set: { active: false, invalidReason: 'admin_force_logout' } },
  );
}

module.exports = { revokeAppSessions };
