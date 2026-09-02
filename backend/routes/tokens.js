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
} = require('../services/subscriptions');
const { createNotification } = require('../services/notifications');

/**
 * Lucky-spin reward cycle.
 * Same 7-day wheel for every user (includes the 50-token jackpot).
 * Extra daily spins still come from the subscription plan.
 */
const FREE_SPIN_CYCLE = [10, 10, 20, 10, 20, 10, 50];

function getSpinCycle() {
  return FREE_SPIN_CYCLE;
}

function resolveSpinCycleDay(user, today) {
  const cycle = getSpinCycle();
  const len = cycle.length;
  const last = user.spinCycleDate || null;
  const prev = Number(user.spinCycleDay) || 0;
  if (last === today && prev >= 1) {
    return Math.min(prev, len);
  }
  if (last && last !== today && prev >= 1) {
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
  const today = todayKey(now);
  const cycle = getSpinCycle();
  const spinCycleDay = resolveSpinCycleDay(user, today);
  return {
    canSpinToday: spin.canSpin,
    spinsPerDay: spin.spinsPerDay,
    spinsRemaining: spin.spinsRemaining,
    spinsUsedToday: spin.spinsUsedToday,
    spinCycleDay,
    spinCycleTokens: cycle[spinCycleDay - 1],
    spinCycle: cycle,
    spinCycleLength: cycle.length,
    subscription: serializeSubscription(user, now),
  };
}

// ─────────────────────────────────────────────
// GET /api/tokens/chat-access
// ─────────────────────────────────────────────
router.get('/chat-access', auth, async (req, res) => {
  try {
    await syncExpiredSubscription(req.userId);
    const status = await getChatAccessStatus(req.userId);
    const user = await User.findById(req.userId).select(
      'subscriptionPlan subscriptionExpiresAt subscriptionSpinsUsedToday subscriptionSpinsDate spinTokensWonToday lastSpinDate spinCycleDay spinCycleDate',
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
      'tokenBalance lastSpinDate spinCycleDay spinCycleDate chatSessionExpiresAt chatSessionStartedAt subscriptionPlan subscriptionExpiresAt subscriptionSpinsUsedToday subscriptionSpinsDate spinTokensWonToday',
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    const access = serializeAccess(user);
    const spin = getSpinStatus(user);

    if (spin.canSpin) {
      const Notification = require('../models/Notification');
      const today = todayKey();
      const startOfDay = new Date(`${today}T00:00:00.000Z`);
      const existing = await Notification.findOne({
        userId: req.userId,
        type: 'spin',
        'data.code': 'SPIN_AVAILABLE',
        createdAt: { $gte: startOfDay },
      }).select('_id');
      if (!existing) {
        await createNotification(req.app.get('io'), {
          userId: req.userId,
          type: 'spin',
          title: 'Daily Lucky Spin',
          body: 'Your free spin is ready. Open Tokens to claim today’s reward!',
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
    const result = await ensureChatSession(req.userId);
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
    const today = todayKey();
    const now = new Date();

    const current = await User.findById(req.userId).select(
      'tokenBalance subscriptionPlan subscriptionExpiresAt subscriptionSpinsUsedToday subscriptionSpinsDate spinTokensWonToday lastSpinDate spinCycleDay spinCycleDate chatSessionStartedAt chatSessionExpiresAt',
    );
    if (!current) return res.status(404).json({ error: 'User not found' });

    const spinStatus = getSpinStatus(current, now);
    if (!spinStatus.canSpin) {
      return res.status(429).json({
        error: 'No spins remaining today',
        code: 'SPIN_LIMIT_REACHED',
        tokenBalance: current.tokenBalance ?? 0,
        ...spinPayload(current, now),
        ...serializeAccess(current, now),
      });
    }

    const cycle = getSpinCycle();
    const cycleDay = resolveSpinCycleDay(current, today);
    const winIdx = Math.max(0, Math.min(cycle.length - 1, cycleDay - 1));
    let won = { label: String(cycle[winIdx]), tokens: cycle[winIdx] };
    const plan = getEffectivePlan(current, now);
    const planConfig = getPlanConfig(plan);

    let tokensToCredit = won.tokens > 0 ? won.tokens : 0;
    if (planConfig.spinTokensDailyCap) {
      const wonSoFar =
        current.subscriptionSpinsDate === today
          ? current.spinTokensWonToday ?? 0
          : 0;
      const room = planConfig.spinTokensDailyCap - wonSoFar;
      if (tokensToCredit > 0 && room <= 0) {
        tokensToCredit = 0;
        won = { label: '10', tokens: 0 };
      } else if (tokensToCredit > room) {
        tokensToCredit = room;
        won = { label: String(tokensToCredit), tokens: tokensToCredit };
      }
    }

    const usedToday =
      current.subscriptionSpinsDate === today
        ? current.subscriptionSpinsUsedToday ?? 0
        : 0;

    const update = {
      $set: {
        subscriptionSpinsDate: today,
        lastSpinDate: today,
        spinCycleDay: cycleDay,
        spinCycleDate: today,
        subscriptionSpinsUsedToday: usedToday + 1,
      },
    };

    if (current.subscriptionSpinsDate !== today) {
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

    const user = await User.findOneAndUpdate(
      {
        _id: req.userId,
        $or: [
          { subscriptionSpinsDate: { $ne: today } },
          {
            subscriptionSpinsDate: today,
            subscriptionSpinsUsedToday: { $lt: spinStatus.spinsPerDay },
          },
          {
            subscriptionSpinsDate: today,
            subscriptionSpinsUsedToday: null,
          },
        ],
      },
      update,
      {
        new: true,
        select:
          'tokenBalance lastSpinDate spinCycleDay spinCycleDate chatSessionStartedAt chatSessionExpiresAt subscriptionPlan subscriptionExpiresAt subscriptionSpinsUsedToday subscriptionSpinsDate spinTokensWonToday',
      },
    );

    if (!user) {
      return res.status(429).json({
        error: 'No spins remaining today',
        code: 'SPIN_LIMIT_REACHED',
        ...spinPayload(current, now),
        ...serializeAccess(current, now),
      });
    }

    const io = req.app.get('io');
    const rewardText =
      tokensToCredit > 0
        ? `You won ${tokensToCredit} tokens from Daily Lucky Spin (Day ${cycleDay} of ${cycle.length})!`
        : 'Spin complete — daily token cap reached.';
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
// ─────────────────────────────────────────────
router.post('/purchase', auth, async (req, res) => {
  try {
    const PACKS = {
      '10': 10,
      '100': 100,
      '500': 500,
      '1000': 1000,
      '5000': 5000,
      '10000': 10000,
      '50000': 50000,
      '100000': 100000,
    };
    const name = String(req.body.packageName || '');
    const baseAmount = PACKS[name];
    if (!baseAmount) {
      return res.status(400).json({ error: 'Invalid package' });
    }

    const existing = await User.findById(req.userId).select(
      'subscriptionPlan subscriptionExpiresAt',
    );
    const { totalTokens } = applyTokenBonus(baseAmount, existing);

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $inc: { tokenBalance: totalTokens } },
      {
        new: true,
        select:
          'tokenBalance lastSpinDate chatSessionStartedAt chatSessionExpiresAt subscriptionPlan subscriptionExpiresAt',
      },
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const io = req.app.get('io');
    await createNotification(io, {
      userId: req.userId,
      type: 'token_purchase',
      title: 'Tokens added',
      body: `${totalTokens} tokens were credited to your balance.`,
      data: { screen: 'token', credited: totalTokens, packageName: name },
    });

    res.json({
      success: true,
      packageName: name,
      credited: totalTokens,
      tokenBalance: user.tokenBalance ?? 0,
      ...serializeAccess(user),
    });
  } catch (err) {
    console.error('tokens/purchase error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
