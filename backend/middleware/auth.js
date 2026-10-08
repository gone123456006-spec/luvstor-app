const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  getCachedActiveDevice,
  setCachedActiveDevice,
} = require('../utils/deviceSessionCache');
const { renewedTokenFor } = require('../utils/authToken');
const { recordAppVersion } = require('../utils/appVersionTracker');

function invalidToken(res) {
  return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
}

module.exports = async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided', code: 'INVALID_TOKEN' });
  }
  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return invalidToken(res);
  }
  const userId = decoded.userId;
  const deviceId = decoded.deviceId ? String(decoded.deviceId).trim() : '';
  if (!userId) return invalidToken(res);

  let activeDeviceId = getCachedActiveDevice(userId);
  if (activeDeviceId === undefined) {
    let user;
    try {
      user = await User.findById(userId).select('activeDeviceId isBanned').lean();
    } catch (err) {
      // A DB hiccup is not a bad session — a 401 here made the app treat
      // signed-in users as new and send them back to Create profile.
      console.warn('auth: user lookup failed:', err?.message || err);
      return res.status(503).json({ error: 'Server busy, please retry', code: 'SERVER_BUSY' });
    }
    if (!user) return invalidToken(res);
    activeDeviceId =
      user.activeDeviceId && user.isBanned !== true ? String(user.activeDeviceId).trim() : null;
    setCachedActiveDevice(userId, activeDeviceId);
  } else if (activeDeviceId) {
    activeDeviceId = String(activeDeviceId).trim();
  }

  // Single-device enforcement: JWT device must match the account's active device
  if (!deviceId || !activeDeviceId || activeDeviceId !== deviceId) {
    return res.status(401).json({
      error: 'Session invalidated. Please log in again.',
      code: 'DEVICE_MISMATCH',
    });
  }

  // Tokens expire after 30 days; active users would silently lose every
  // request at day 30. Hand back a fresh one — the app stores it.
  const renewed = renewedTokenFor(decoded);
  if (renewed) res.setHeader('X-Auth-Token', renewed);

  req.userId = String(userId);
  req.deviceId = deviceId;
  recordAppVersion(req.userId, req);
  next();
};
