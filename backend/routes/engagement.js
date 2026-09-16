const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { trackProfileView, sendViewEngagementNudge, getEngagementStats } = require('../services/viewEngagement');
const { getChatStarters, getQuickIcebreaker } = require('../services/chatStarters');

/**
 * POST /api/engagement/view
 * Track profile view and get nudge schedule info
 */
router.post('/view', auth, async (req, res) => {
  try {
    const { targetId, context } = req.body;
    
    if (!targetId) {
      return res.status(400).json({ error: 'targetId is required' });
    }
    
    const result = await trackProfileView(
      req.userId,
      targetId,
      context || {},
      req.app.get('io'),
    );
    
    res.json(result || { shouldScheduleNudge: false });
  } catch (err) {
    console.error('/api/engagement/view error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/engagement/nudge
 * Send view engagement nudge (called after delay by client)
 */
router.post('/nudge', auth, async (req, res) => {
  try {
    const { targetId } = req.body;
    
    if (!targetId) {
      return res.status(400).json({ error: 'targetId is required' });
    }
    
    const io = req.app.get('io');
    const result = await sendViewEngagementNudge(io, req.userId, targetId);
    
    res.json(result || { sent: false });
  } catch (err) {
    console.error('/api/engagement/nudge error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/engagement/stats
 * Get engagement stats for monitoring
 */
router.get('/stats', auth, async (req, res) => {
  try {
    const stats = await getEngagementStats(req.userId);
    res.json(stats || { today: 0, thisWeek: 0, total: 0 });
  } catch (err) {
    console.error('/api/engagement/stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/engagement/chat-starters/:matchedUserId
 * Get chat starter suggestions for a match
 */
router.get('/chat-starters/:matchedUserId', auth, async (req, res) => {
  try {
    const { matchedUserId } = req.params;
    
    if (!matchedUserId) {
      return res.status(400).json({ error: 'matchedUserId is required' });
    }
    
    const starters = await getChatStarters(req.userId, matchedUserId);
    res.json({ starters });
  } catch (err) {
    console.error('/api/engagement/chat-starters error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/engagement/icebreaker/:matchedUserId
 * Get quick icebreaker for a match
 */
router.get('/icebreaker/:matchedUserId', auth, async (req, res) => {
  try {
    const { matchedUserId } = req.params;
    
    if (!matchedUserId) {
      return res.status(400).json({ error: 'matchedUserId is required' });
    }
    
    const icebreaker = await getQuickIcebreaker(req.userId, matchedUserId);
    res.json({ icebreaker });
  } catch (err) {
    console.error('/api/engagement/icebreaker error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
