const express = require('express');
const auth = require('../middleware/auth');
const calls = require('../services/calls');

const router = express.Router();

/** ICE servers for WebRTC (STUN + optional TURN) */
router.get('/ice-servers', auth, (req, res) => {
  res.json({
    iceServers: calls.getIceServers(),
    ringTimeoutMs: calls.RING_TIMEOUT_MS,
  });
});

/** Active call for current user (restore UI after app reopen) */
router.get('/active', auth, (req, res) => {
  const session = calls.getActiveCallForUser(req.userId);
  if (!session) return res.json({ active: null });
  res.json({ active: calls.publicSession(session) });
});

/** Call history */
router.get('/history', auth, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 40;
    const before = req.query.before || undefined;
    const items = await calls.listHistory(req.userId, { limit, before });
    res.json({ items });
  } catch (err) {
    console.error('[calls/history]', err.message);
    res.status(500).json({ error: 'Failed to load call history' });
  }
});

module.exports = router;
