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

/**
 * Decline from notification shade / killed app (HTTP — works without live socket).
 * POST /api/calls/:callId/decline
 */
router.post('/:callId/decline', auth, async (req, res) => {
  try {
    const callId = String(req.params.callId || '');
    if (!callId) return res.status(400).json({ error: 'callId required' });
    const session = calls.getSession(callId);
    if (!session || !calls.isParticipant(session, req.userId)) {
      // Already gone / timed out — treat as success so the tray can clear
      return res.json({ ok: true, alreadyEnded: true });
    }
    await calls.destroySession(callId, {
      status: 'rejected',
      endReason: 'decline',
      endedBy: req.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[calls/decline]', err.message);
    res.status(500).json({ error: 'Failed to decline call' });
  }
});

/**
 * Accept from notification Answer button when socket is still connecting.
 * POST /api/calls/:callId/accept
 */
router.post('/:callId/accept', auth, async (req, res) => {
  try {
    const callId = String(req.params.callId || '');
    if (!callId) return res.status(400).json({ error: 'callId required' });
    const result = await calls.acceptCall(callId, req.userId);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error,
        code: result.code,
      });
    }
    const session = result.session;
    const otherId = calls.otherParty(session, req.userId);
    const io = req.app.get('io');
    if (io && otherId) {
      const { notifyUser } = require('../utils/realtime');
      notifyUser(io, otherId, 'call:accepted', {
        callId,
        from: req.userId,
        iceServers: result.iceServers,
        session: calls.publicSession(session),
      });
    }
    res.json({
      ok: true,
      iceServers: result.iceServers,
      session: calls.publicSession(session),
    });
  } catch (err) {
    console.error('[calls/accept]', err.message);
    res.status(500).json({ error: 'Failed to accept call' });
  }
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
