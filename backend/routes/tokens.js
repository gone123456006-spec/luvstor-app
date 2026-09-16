const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const {
  getChatAccessStatus,
  ensureChatSession,
  serializeAccess,
} = require('../services/chatTokens');
const {
  todayKey,
  getSpinStatus,
  getEffectivePlan,
  getPlanConfig,
  serializeSubscription,
  syncExpiredSubscription,
  getPlanEntitlements,
  applyTokenBonus,
  SPIN_WINDOW_MS,
  resolveSpinWindowStart,
  isSpinWindowActive,
} = require('../services/subscriptions');
const { createNotification } = require('../services/notifications');

/**
 * Lucky-spin reward cycle.
 * Same 7-step wheel for every user (includes the 50-token jackpot).
 * Extra spins still come from the subscription plan within each 24h window.
 */
const FREE_SPIN_CYCLE = [10, 10, 20, 10, 20, 10, 50];

function getSpinCycle() {
  return FREE_SPIN_CYCLE;
}

function resolveSpinCycleDay(user, now = new Date()) {
  const cycle = getSpinCycle();
  const len = cycle.length;
  const prev = Number(user.spinCycleDay) || 0;
  const windowStart = resolveSpinWindowStart(user);
  if (isSpinWindowActive(windowStart, now) && prev >= 1) {
    return Math.min(prev, len);
  }
  if (prev >= 1) {
    return prev >= len ? 1 : prev + 1;
  }
  return 1;
}

function endOfUtcDay(d = new Date()) {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}

function spinPayload(user, now = new Date()) {
  const spin = getSpinStatus(user, now);
  const cycle = getSpinCycle();
  const spinCycleDay = resolveSpinCycleDay(user, now);
  return {
    canSpinToday: spin.canSpin,
    spinsPerDay: spin.spinsPerDay,
    spinsRemaining: spin.spinsRemaining,
    spinsUsedToday: spin.spinsUsedToday,
    nextSpinAt: spin.nextSpinAt,
    spinCooldownMs: spin.spinCooldownMs,
    spinWindowStartedAt: spin.spinWindowStartedAt,
    spinCycleDay,
    spinCycleTokens: cycle[spinCycleDay - 1],
    spinCycle: cycle,
    spinCycleLength: cycle.length,
    /** Retention: consecutive open days + spin cycle day as spin streak */
    openStreakDays: Number(user.openStreakDays) || 0,
    spinStreakDays: spinCycleDay,
    subscription: serializeSubscription(user, now),
  };
}

// ─────────────────────────────────────────────
// GET /api/tokens/chat-access
// ─────────────────────────────────────────────
router.get('/chat-access', auth, async (req, res) => {
  try {
    await syncExpiredSubscription(req.userId);
    const otherUserId = req.query.otherUserId
      ? String(req.query.otherUserId)
      : null;
    const status = await getChatAccessStatus(req.userId, otherUserId);
    const user = await User.findById(req.userId).select(
      'subscriptionPlan subscriptionExpiresAt subscriptionSpinsUsedToday subscriptionSpinsDate spinTokensWonToday lastSpinDate spinCycleDay spinCycleDate spinWindowStartedAt',
    );
    res.json({
      ...status,
      ...spinPayload(user),
      lastSpinDate: user?.lastSpinDate || null,
    });
  } catch (err) {
    console.error('tokens/chat-access error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/tokens/balance
// ─────────────────────────────────────────────
router.get('/balance', auth, async (req, res) => {
  try {
    await syncExpiredSubscription(req.userId);
    const user = await User.findById(req.userId).select(
      'tokenBalance lastSpinDate spinCycleDay spinCycleDate spinWindowStartedAt chatSessionExpiresAt chatSessionStartedAt subscriptionPlan subscriptionExpiresAt subscriptionSpinsUsedToday subscriptionSpinsDate spinTokensWonToday openStreakDays lastOpenDate',
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    const access = serializeAccess(user);
    const spin = getSpinStatus(user);

    if (spin.canSpin) {
      const Notification = require('../models/Notification');
      const since = new Date(Date.now() - SPIN_WINDOW_MS);
      const existing = await Notification.findOne({
        userId: req.userId,
        type: 'spin',
        'data.code': 'SPIN_AVAILABLE',
        createdAt: { $gte: since },
      }).select('_id');
      if (!existing) {
        await createNotification(req.app.get('io'), {
          userId: req.userId,
          type: 'spin',
          title: 'Daily Lucky Spin',
          body: 'Your free spin is ready. Open Tokens to claim your reward!',
          data: { screen: 'token', code: 'SPIN_AVAILABLE' },
        });
      }
    }

    res.json({
      tokenBalance: access.tokenBalance,
      lastSpinDate: user.lastSpinDate || null,
      ...spinPayload(user),
      hasActiveSession: access.hasActiveSession,
      remainingMs: access.remainingMs,
      sessionExpiresAt: access.sessionExpiresAt,
      sessionDurationMs: access.sessionDurationMs,
      serverNow: access.serverNow,
    });
  } catch (err) {
    console.error('tokens/balance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/tokens/ensure-session
// ─────────────────────────────────────────────
router.post('/ensure-session', auth, async (req, res) => {
  try {
    await syncExpiredSubscription(req.userId);
    const otherUserId = req.body?.otherUserId
      ? String(req.body.otherUserId)
      : null;
    const result = await ensureChatSession(req.userId, otherUserId);
    if (!result.ok) {
      if (result.code === 'INSUFFICIENT_TOKENS') {
        const Notification = require('../models/Notification');
        const recent = await Notification.findOne({
          userId: req.userId,
          type: 'token_low',
          createdAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
        }).select('_id');
        if (!recent) {
          const io = req.app.get('io');
          await createNotification(io, {
            userId: req.userId,
            type: 'token_low',
            title: 'Tokens not available',
            body:
              result.message ||
              "You don't have enough tokens to chat. Buy tokens or try Daily Lucky Spin.",
            data: { screen: 'token', code: 'INSUFFICIENT_TOKENS' },
          });
        }
      }
      return res.status(402).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('tokens/ensure-session error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/tokens/spin
// ─────────────────────────────────────────────
router.post('/spin', auth, async (req, res) => {
  try {
    const now = new Date();
    const today = todayKey(now);

    const current = await User.findById(req.userId).select(
      'tokenBalance subscriptionPlan subscriptionExpiresAt subscriptionSpinsUsedToday subscriptionSpinsDate spinTokensWonToday lastSpinDate spinCycleDay spinCycleDate spinWindowStartedAt chatSessionStartedAt chatSessionExpiresAt',
    );
    if (!current) return res.status(404).json({ error: 'User not found' });

    const spinStatus = getSpinStatus(current, now);
    if (!spinStatus.canSpin) {
      return res.status(429).json({
        error: 'No spins remaining. Come back after 24 hours from your first spin.',
        code: 'SPIN_LIMIT_REACHED',
        tokenBalance: current.tokenBalance ?? 0,
        ...spinPayload(current, now),
        ...serializeAccess(current, now),
      });
    }

    const cycle = getSpinCycle();
    const cycleDay = resolveSpinCycleDay(current, now);
    const winIdx = Math.max(0, Math.min(cycle.length - 1, cycleDay - 1));
    let won = { label: String(cycle[winIdx]), tokens: cycle[winIdx] };
    const plan = getEffectivePlan(current, now);
    const planConfig = getPlanConfig(plan);

    const existingWindowStart = resolveSpinWindowStart(current);
    const windowActive = isSpinWindowActive(existingWindowStart, now);
    const windowStart = windowActive && existingWindowStart ? existingWindowStart : now;

    let tokensToCredit = won.tokens > 0 ? won.tokens : 0;
    if (planConfig.spinTokensDailyCap) {
      const wonSoFar = windowActive ? current.spinTokensWonToday ?? 0 : 0;
      const room = planConfig.spinTokensDailyCap - wonSoFar;
      if (tokensToCredit > 0 && room <= 0) {
        tokensToCredit = 0;
        won = { label: '10', tokens: 0 };
      } else if (tokensToCredit > room) {
        tokensToCredit = room;
        won = { label: String(tokensToCredit), tokens: tokensToCredit };
      }
    }

    const usedInWindow = windowActive ? current.subscriptionSpinsUsedToday ?? 0 : 0;
    const windowCutoff = new Date(now.getTime() - SPIN_WINDOW_MS);

    const update = {
      $set: {
        subscriptionSpinsDate: today,
        lastSpinDate: today,
        spinWindowStartedAt: windowStart,
        spinCycleDay: cycleDay,
        spinCycleDate: today,
        subscriptionSpinsUsedToday: usedInWindow + 1,
      },
    };

    if (!windowActive) {
      update.$set.spinTokensWonToday = tokensToCredit;
    } else if (tokensToCredit > 0) {
      update.$inc = { spinTokensWonToday: tokensToCredit };
    }

    if (tokensToCredit > 0) {
      update.$inc = { ...(update.$inc || {}), tokenBalance: tokensToCredit };
    } else if (won.tokens === -1) {
      update.$set.chatSessionStartedAt = now;
      update.$set.chatSessionExpiresAt = endOfUtcDay(now);
    }

    const updateFilter = windowActive
      ? {
          _id: req.userId,
          $or: [
            {
              spinWindowStartedAt: { $gt: windowCutoff },
              subscriptionSpinsUsedToday: { $lt: spinStatus.spinsPerDay },
            },
            // Legacy calendar window (no Date field yet)
            {
              spinWindowStartedAt: null,
              subscriptionSpinsDate: today,
              subscriptionSpinsUsedToday: { $lt: spinStatus.spinsPerDay },
            },
            {
              spinWindowStartedAt: { $exists: false },
              subscriptionSpinsDate: today,
              subscriptionSpinsUsedToday: { $lt: spinStatus.spinsPerDay },
            },
          ],
        }
      : {
          _id: req.userId,
          $or: [
            { spinWindowStartedAt: { $lte: windowCutoff } },
            { spinWindowStartedAt: null },
            { spinWindowStartedAt: { $exists: false } },
          ],
        };

    const user = await User.findOneAndUpdate(updateFilter, update, {
      new: true,
      select:
        'tokenBalance lastSpinDate spinCycleDay spinCycleDate spinWindowStartedAt chatSessionStartedAt chatSessionExpiresAt subscriptionPlan subscriptionExpiresAt subscriptionSpinsUsedToday subscriptionSpinsDate spinTokensWonToday',
    });

    if (!user) {
      return res.status(429).json({
        error: 'No spins remaining. Come back after 24 hours from your first spin.',
        code: 'SPIN_LIMIT_REACHED',
        ...spinPayload(current, now),
        ...serializeAccess(current, now),
      });
    }

    const io = req.app.get('io');
    const rewardText =
      tokensToCredit > 0
        ? `You won ${tokensToCredit} tokens from Daily Lucky Spin (Day ${cycleDay} of ${cycle.length})!`
        : 'Spin complete — token cap reached for this 24h window.';
    createNotification(io, {
      userId: req.userId,
      type: 'spin',
      title: 'Daily Lucky Spin',
      body: rewardText,
      data: {
        screen: 'token',
        reward: won.label,
        tokens: won.tokens,
        spinCycleDay: cycleDay,
      },
    }).catch(() => {});

    res.json({
      success: true,
      winIndex: winIdx,
      reward: {
        label: won.label,
        tokens: won.tokens,
        credited: tokensToCredit,
        spinCycleDay: cycleDay,
      },
      tokenBalance: user.tokenBalance ?? 0,
      lastSpinDate: user.lastSpinDate,
      ...spinPayload(user, now),
      ...serializeAccess(user, now),
    });
  } catch (err) {
    console.error('tokens/spin error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/tokens/purchase
// Disabled: previously credited packs with no payment (fraud vector).
// Real purchases must go through /api/payment/create-order + /verify.
// ─────────────────────────────────────────────
router.post('/purchase', auth, async (_req, res) => {
  return res.status(403).json({
    error: 'Direct token purchase is disabled. Complete payment via /api/payment/create-order.',
    code: 'PAYMENT_REQUIRED',
  });
});

module.exports = router;
