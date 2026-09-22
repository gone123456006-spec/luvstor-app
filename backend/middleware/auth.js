const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  getCachedActiveDevice,
  setCachedActiveDevice,
} = require('../utils/deviceSessionCache');

module.exports = async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    const deviceId = decoded.deviceId ? String(decoded.deviceId).trim() : '';

    if (!userId) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    let activeDeviceId = getCachedActiveDevice(userId);
    if (activeDeviceId === undefined) {
      const user = await User.findById(userId).select('activeDeviceId').lean();
      if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      activeDeviceId = user.activeDeviceId ? String(user.activeDeviceId).trim() : null;
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

    req.userId = String(userId);
    req.deviceId = deviceId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
