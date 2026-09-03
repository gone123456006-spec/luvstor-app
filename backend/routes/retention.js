const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { applyOpenStreak } = require('../services/retention');
const { todayKey, getSpinStatus } = require('../services/subscriptions');
const { atomicOpenStreak, redisRateLimit } = require('../utils/scaleHelpers');

const pingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) =>
    req.userId ? String(req.userId) : ipKeyGenerator(req, res),
  handler: (req, res) =>
    res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' }),
});

const redisPingGuard = redisRateLimit({
  prefix: 'retention-open',
  windowMs: 60 * 1000,
  max: 12,
});

/**
 * POST /api/retention/open
 * Idempotent per UTC day. Atomic under concurrent / multi-instance load.
 */
router.post('/open', auth, redisPingGuard, pingLimiter, async (req, res) => {
  try {
    const today = todayKey();
    const yesterday = todayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));

    let streak;
    try {
      streak = await atomicOpenStreak(User, req.userId, today, yesterday);
    } catch (err) {
      // Fallback to in-memory helper + save if aggregation path fails
      const user = await User.findById(req.userId).select(
        'openStreakDays lastOpenDate spinCycleDay subscriptionSpinsUsedToday subscriptionSpinsDate subscriptionPlan subscriptionExpiresAt lastSpinDate',
      );
      if (!user) return res.status(404).json({ error: 'User not found' });
      const applied = applyOpenStreak(user);
      if (!applied.alreadyCountedToday) await user.save();
      streak = { ...applied, user, spinCycleDay: Number(user.spinCycleDay) || 0 };
    }

    if (!streak || !streak.user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const spin = getSpinStatus(streak.user);

    res.json({
      openStreakDays: streak.openStreakDays,
      lastOpenDate: streak.lastOpenDate,
      streakContinued: streak.streakContinued,
      alreadyCountedToday: streak.alreadyCountedToday,
      spinStreakDays: streak.spinCycleDay || Number(streak.user.spinCycleDay) || 0,
      canSpinToday: spin.canSpin,
      spinsRemaining: spin.spinsRemaining,
      today,
    });
  } catch (err) {
    console.error('retention/open error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/retention/streak
 */
router.get('/streak', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select(
      'openStreakDays lastOpenDate spinCycleDay lastSpinDate subscriptionSpinsUsedToday subscriptionSpinsDate subscriptionPlan subscriptionExpiresAt',
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    const spin = getSpinStatus(user);
    res.json({
      openStreakDays: Number(user.openStreakDays) || 0,
      lastOpenDate: user.lastOpenDate || null,
      spinStreakDays: Number(user.spinCycleDay) || 0,
      canSpinToday: spin.canSpin,
      spinsRemaining: spin.spinsRemaining,
      today: todayKey(),
    });
  } catch (err) {
    console.error('retention/streak error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
