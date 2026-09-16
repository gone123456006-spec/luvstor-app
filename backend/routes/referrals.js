const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const {
  ensureReferralCode,
  getReferralDashboard,
  applyReferralOnSignup,
  normalizeReferralCode,
  REFERRAL_REWARD_TOKENS,
  MAX_REFERRALS_PER_MONTH,
} = require('../services/referrals');

// GET /api/referrals/me
router.get('/me', auth, async (req, res) => {
  try {
    const dash = await getReferralDashboard(req.userId);
    if (!dash) return res.status(404).json({ error: 'User not found' });
    res.json(dash);
  } catch (err) {
    console.error('referrals/me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/referrals/claim
 * Body: { referralCode, deviceId? }
 * Safe to call after login if auth path missed attribution (e.g. code arrived late).
 * Only works for users not yet referred, typically brand-new accounts.
 */
router.post('/claim', auth, async (req, res) => {
  try {
    const referralCode = normalizeReferralCode(req.body.referralCode);
    const deviceId = String(req.body.deviceId || req.deviceId || '').trim();
    if (!referralCode) {
      return res.status(400).json({ error: 'referralCode is required' });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Only allow claim shortly after account creation (new signup window)
    const ageMs = Date.now() - new Date(user.createdAt || 0).getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({
        error: 'Referral can only be applied for new accounts',
        code: 'NOT_NEW_USER',
      });
    }

    const result = await applyReferralOnSignup({
      refereeUser: user,
      referralCode,
      deviceId,
      io: req.app.get('io'),
    });

    res.json({
      success: !!result.ok,
      ...result,
      rewardTokens: REFERRAL_REWARD_TOKENS,
      maxPerMonth: MAX_REFERRALS_PER_MONTH,
    });
  } catch (err) {
    console.error('referrals/claim error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Ensure code exists (lazy)
router.post('/ensure-code', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const code = await ensureReferralCode(user);
    res.json({ referralCode: code });
  } catch (err) {
    console.error('referrals/ensure-code error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
