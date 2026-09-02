/**
 * Device (FCM token) registration.
 * Every endpoint requires a valid session — tokens are always bound to a user.
 */
const express = require('express');

const router = express.Router();
const auth = require('../middleware/auth');
const { writeLimiter, readLimiter } = require('../middleware/rateLimit');
const deviceTokens = require('../services/deviceTokens');
const DeviceToken = require('../models/DeviceToken');

const PLATFORMS = ['android', 'ios', 'web'];

// POST /api/devices/register  { token, deviceId?, platform?, deviceName?, appVersion? }
router.post('/register', auth, writeLimiter, async (req, res) => {
  try {
    const { token, platform, deviceName, appVersion } = req.body || {};
    const deviceId = req.body?.deviceId || req.deviceId || null;

    if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
      return res.status(400).json({ error: 'A valid FCM token is required' });
    }
    if (platform && !PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    const doc = await deviceTokens.registerToken({
      userId: req.userId,
      token: token.trim(),
      deviceId,
      platform: platform || 'android',
      deviceName: String(deviceName || '').slice(0, 120),
      appVersion: String(appVersion || '').slice(0, 40),
    });

    res.json({
      ok: true,
      deviceToken: {
        id: String(doc._id),
        platform: doc.platform,
        active: doc.active,
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    console.error('devices/register error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

// POST /api/devices/unregister  { token? }  — defaults to this device
router.post('/unregister', auth, writeLimiter, async (req, res) => {
  try {
    const { token } = req.body || {};
    let removed = 0;

    if (token) {
      // Only allow removing a token that belongs to the caller
      const owned = await DeviceToken.findOne({ token, userId: req.userId }).select('_id');
      if (owned) removed = await deviceTokens.removeToken(token);
    } else if (req.deviceId) {
      removed = await DeviceToken.deleteMany({
        deviceId: req.deviceId,
        userId: req.userId,
      }).then((r) => r.deletedCount || 0);
    }

    res.json({ ok: true, removed });
  } catch (err) {
    console.error('devices/unregister error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/devices — the caller's registered devices
router.get('/', auth, readLimiter, async (req, res) => {
  try {
    const rows = await DeviceToken.find({ userId: req.userId })
      .select('platform deviceName appVersion active lastUsedAt createdAt')
      .sort({ lastUsedAt: -1 })
      .lean();

    res.json({
      devices: rows.map((d) => ({
        id: String(d._id),
        platform: d.platform,
        deviceName: d.deviceName,
        appVersion: d.appVersion,
        active: d.active,
        lastUsedAt: d.lastUsedAt,
        createdAt: d.createdAt,
      })),
    });
  } catch (err) {
    console.error('devices/list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
