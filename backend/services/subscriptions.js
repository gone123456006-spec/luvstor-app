/**
 * Luvstor subscription tiers — server-side source of truth.
 * Free / Gold / Platinum / Black
 */

const PLAN_IDS = ['free', 'gold', 'platinum', 'black'];

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    chatSessionHours: 2,
    unlimitedChat: false,
    tokenBonusPercent: 0,
    monthlyTokenGrant: 0,
    spinsPerDay: 1,
    discoverBoost: false,
    topSpotDaily: false,
    topSpotMinutes: 0,
    badge: null,
    accent: '#8696A0',
  },
  gold: {
    id: 'gold',
    name: 'Gold',
    chatSessionHours: 6,
    unlimitedChat: false,
    tokenBonusPercent: 10,
    monthlyTokenGrant: 100,
    spinsPerDay: 2,
    discoverBoost: false,
    topSpotDaily: false,
    topSpotMinutes: 0,
    badge: 'gold',
    accent: '#FFD700',
  },
  platinum: {
    id: 'platinum',
    name: 'Platinum',
    chatSessionHours: 12,
    unlimitedChat: false,
    tokenBonusPercent: 25,
    monthlyTokenGrant: 350,
    spinsPerDay: 4,
    discoverBoost: true,
    topSpotDaily: false,
    topSpotMinutes: 0,
    badge: 'platinum',
    accent: '#E5E4E2',
  },
  black: {
    id: 'black',
    name: 'Black',
    chatSessionHours: 24,
    unlimitedChat: false,
    tokenBonusPercent: 40,
    monthlyTokenGrant: 1200,
    spinsPerDay: 999,
    discoverBoost: true,
    topSpotDaily: true,
    topSpotMinutes: 40,
    badge: 'black',
    accent: '#1C1B1F',
    spinTokensDailyCap: 500,
  },
};

const PLAN_RANK = { black: 4, platinum: 3, gold: 2, free: 1 };

/** Billing periods — prices in INR per plan */
const BILLING_PERIODS = [
  { id: 'monthly', label: 'Monthly', days: 30 },
  { id: 'quarterly', label: 'Quarterly', days: 90 },
  { id: '6months', label: '6 Months', days: 180 },
  { id: 'annual', label: 'Annual', days: 365 },
];

const PLAN_PRICING = {
  gold: { monthly: 349, quarterly: 899, '6months': 1499, annual: 1999 },
  platinum: { monthly: 699, quarterly: 1799, '6months': 2999, annual: 4199 },
  black: { monthly: 1499, quarterly: 3499, '6months': 5249, annual: 8999 },
};

function getBillingPeriod(periodId) {
  return BILLING_PERIODS.find((p) => p.id === periodId) || null;
}

function getPlanPrice(planId, periodId = 'monthly') {
  if (!['gold', 'platinum', 'black'].includes(planId)) return null;
  const period = getBillingPeriod(periodId);
  if (!period) return null;
  const priceInr = PLAN_PRICING[planId]?.[period.id];
  if (priceInr == null) return null;
  return {
    priceInr,
    pricePaise: priceInr * 100,
    durationDays: period.days,
    periodId: period.id,
    periodLabel: period.label,
  };
}

function listBillingPeriods() {
  return BILLING_PERIODS.map(({ id, label, days }) => ({ id, label, days }));
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function getPlanConfig(planId) {
  return PLANS[planId] || PLANS.free;
}

function getEffectivePlan(user, now = new Date()) {
  if (!user) return 'free';
  const plan = user.subscriptionPlan || 'free';
  if (!PLAN_IDS.includes(plan) || plan === 'free') return 'free';
  const exp = user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt)
    : null;
  if (!exp || exp.getTime() <= now.getTime()) return 'free';
  return plan;
}

function getSessionDurationMs(user, now = new Date()) {
  if (hasUnlimitedChat(user, now)) return 0;
  const plan = getEffectivePlan(user, now);
  const hours = getPlanConfig(plan).chatSessionHours;
  return hours * 60 * 60 * 1000;
}

function hasUnlimitedChat(user, now = new Date()) {
  const plan = getEffectivePlan(user, now);
  return Boolean(getPlanConfig(plan).unlimitedChat);
}

function getTokenBonusPercent(user, now = new Date()) {
  const plan = getEffectivePlan(user, now);
  return getPlanConfig(plan).tokenBonusPercent;
}

function applyTokenBonus(baseTokens, user, now = new Date()) {
  const pct = getTokenBonusPercent(user, now);
  const bonus = Math.floor((baseTokens * pct) / 100);
  return { baseTokens, bonusTokens: bonus, totalTokens: baseTokens + bonus };
}

function resetSpinCountersIfNeeded(user, today = todayKey()) {
  if (user.subscriptionSpinsDate !== today) {
    user.subscriptionSpinsUsedToday = 0;
    user.subscriptionSpinsDate = today;
    user.spinTokensWonToday = 0;
  }
}

function getSpinStatus(user, now = new Date()) {
  const plan = getEffectivePlan(user, now);
  const config = getPlanConfig(plan);
  const today = todayKey(now);

  let used = user.subscriptionSpinsUsedToday ?? 0;
  if (user.subscriptionSpinsDate !== today) used = 0;

  const limit = config.spinsPerDay;
  const remaining = Math.max(0, limit - used);
  const canSpin = remaining > 0;

  return {
    plan,
    spinsPerDay: limit,
    spinsUsedToday: used,
    spinsRemaining: remaining,
    canSpin,
    spinTokensDailyCap: config.spinTokensDailyCap || null,
    spinTokensWonToday: user.subscriptionSpinsDate === today
      ? user.spinTokensWonToday ?? 0
      : 0,
  };
}

function getPlanEntitlements(user, now = new Date()) {
  const effectivePlan = getEffectivePlan(user, now);
  const config = getPlanConfig(effectivePlan);
  const spin = getSpinStatus(user, now);
  const expiresAt = user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt)
    : null;
  const isActive =
    effectivePlan !== 'free' &&
    expiresAt &&
    expiresAt.getTime() > now.getTime();

  return {
    plan: effectivePlan,
    planName: config.name,
    badge: isActive ? config.badge : null,
    isActive,
    expiresAt: isActive ? expiresAt.toISOString() : null,
    chatSessionHours: config.unlimitedChat ? null : config.chatSessionHours,
    unlimitedChat: Boolean(config.unlimitedChat && isActive),
    chatTokenCost: config.unlimitedChat && isActive ? 0 : 10,
    tokenBonusPercent: isActive ? config.tokenBonusPercent : 0,
    monthlyTokenGrant: isActive ? config.monthlyTokenGrant : 0,
    spinsPerDay: spin.spinsPerDay,
    spinsRemaining: spin.spinsRemaining,
    spinsUsedToday: spin.spinsUsedToday,
    canSpin: spin.canSpin,
    spinTokensDailyCap: spin.spinTokensDailyCap,
    discoverBoost: Boolean(config.discoverBoost && isActive),
    topSpotDaily: Boolean(config.topSpotDaily && isActive),
    topSpotMinutes: config.topSpotDaily && isActive ? (config.topSpotMinutes || 0) : 0,
    callsFriendsOnly: true,
  };
}

function compareDiscoverUsers(a, b, now = new Date()) {
  const topUntil = (u) =>
    u.discoverTopSpotUntil &&
    new Date(u.discoverTopSpotUntil).getTime() > now.getTime();
  const aTop = topUntil(a) ? 1 : 0;
  const bTop = topUntil(b) ? 1 : 0;
  if (aTop !== bTop) return bTop - aTop;
  return compareDiscoverPriority(getEffectivePlan(a, now), getEffectivePlan(b, now));
}

async function ensureDiscoverTopSpot(userId) {
  const User = require('../models/User');
  const user = await User.findById(userId).select(
    'subscriptionPlan subscriptionExpiresAt discoverTopSpotUntil discoverTopSpotDate',
  );
  if (!user) return null;

  const ent = getPlanEntitlements(user);
  if (!ent.topSpotDaily) return user;

  const today = todayKey();
  const now = new Date();
  if (
    user.discoverTopSpotDate === today &&
    user.discoverTopSpotUntil &&
    new Date(user.discoverTopSpotUntil).getTime() > now.getTime()
  ) {
    return user;
  }
  if (user.discoverTopSpotDate === today) return user;

  const minutes = Number(ent.topSpotMinutes) > 0 ? Number(ent.topSpotMinutes) : 40;
  const until = new Date(now.getTime() + minutes * 60 * 1000);
  return User.findByIdAndUpdate(
    userId,
    { $set: { discoverTopSpotUntil: until, discoverTopSpotDate: today } },
    { new: true },
  );
}

async function syncExpiredSubscription(userId) {
  const User = require('../models/User');
  const user = await User.findById(userId).select(
    'subscriptionPlan subscriptionExpiresAt chatSessionExpiresAt chatSessionStartedAt',
  );
  if (!user) return;

  const now = new Date();
  const stored = user.subscriptionPlan || 'free';
  if (stored === 'free') return;

  const exp = user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt)
    : null;
  if (exp && exp.getTime() > now.getTime()) return;

  // Plan expired — revert to free and end any leftover premium chat session
  await User.findByIdAndUpdate(userId, {
    $set: {
      subscriptionPlan: 'free',
      subscriptionExpiresAt: null,
      chatSessionExpiresAt:
        user.chatSessionExpiresAt &&
        new Date(user.chatSessionExpiresAt).getTime() > now.getTime()
          ? now
          : user.chatSessionExpiresAt,
      chatSessionStartedAt:
        user.chatSessionExpiresAt &&
        new Date(user.chatSessionExpiresAt).getTime() > now.getTime()
          ? null
          : user.chatSessionStartedAt,
    },
  });
}

/** Drop expired paid plans so badges/ticks disappear without waiting for login. */
async function expireDueSubscriptions(now = new Date()) {
  const User = require('../models/User');
  const result = await User.updateMany(
    {
      subscriptionPlan: { $in: ['gold', 'platinum', 'black'] },
      $or: [
        { subscriptionExpiresAt: { $lte: now } },
        { subscriptionExpiresAt: null },
      ],
    },
    { $set: { subscriptionPlan: 'free', subscriptionExpiresAt: null } },
  );
  return result.modifiedCount || result.nModified || 0;
}

/**
 * Activate a paid plan after verified payment.
 * Applies plan-specific entitlements: duration, tokens, spins reset, chat session rules.
 */
async function activateSubscription(userId, planId, durationDays = 30, options = {}) {
  if (!['gold', 'platinum', 'black'].includes(planId)) {
    const err = new Error('Invalid subscription plan');
    err.status = 400;
    throw err;
  }

  const User = require('../models/User');
  const config = getPlanConfig(planId);
  const now = new Date();
  const paymentId = options.paymentId ? String(options.paymentId) : null;

  const existing = await User.findById(userId).select(
    'subscriptionPlan subscriptionExpiresAt lastSubscriptionPaymentId tokenBalance',
  );
  if (!existing) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  // Idempotent: same payment already applied
  if (paymentId && existing.lastSubscriptionPaymentId === paymentId) {
    const result = serializeSubscription(existing, now);
    result.tokensCredited = 0;
    result.tokenBalance = existing.tokenBalance ?? 0;
    result.alreadyActivated = true;
    return result;
  }

  // Renewing the same active plan stacks remaining days
  let expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const prevPlan = existing.subscriptionPlan || 'free';
  const prevExp = existing.subscriptionExpiresAt
    ? new Date(existing.subscriptionExpiresAt)
    : null;
  if (
    prevPlan === planId &&
    prevExp &&
    prevExp.getTime() > now.getTime()
  ) {
    expiresAt = new Date(
      prevExp.getTime() + durationDays * 24 * 60 * 60 * 1000,
    );
  }

  const $set = {
    subscriptionPlan: planId,
    subscriptionExpiresAt: expiresAt,
    subscriptionSpinsUsedToday: 0,
    subscriptionSpinsDate: todayKey(now),
    spinTokensWonToday: 0,
  };
  const wasActivePaid =
    ['gold', 'platinum', 'black'].includes(prevPlan) &&
    prevExp &&
    prevExp.getTime() > now.getTime();
  if (!wasActivePaid) {
    $set.spinCycleDay = 0;
    $set.spinCycleDate = null;
  }
  if (paymentId) {
    $set.lastSubscriptionPaymentId = paymentId;
  }

  // Chat session rules per plan
  if (config.unlimitedChat) {
    $set.chatSessionStartedAt = now;
    $set.chatSessionExpiresAt = expiresAt;
  } else {
    // Paid and free tiers: start a fresh token session at this plan's length
    const sessionMs = config.chatSessionHours * 60 * 60 * 1000;
    $set.chatSessionStartedAt = now;
    $set.chatSessionExpiresAt = new Date(now.getTime() + sessionMs);
  }

  const update = { $set };
  if (config.monthlyTokenGrant > 0) {
    update.$inc = { tokenBalance: config.monthlyTokenGrant };
  }

  const user = await User.findByIdAndUpdate(userId, update, { new: true });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const result = serializeSubscription(user, now);
  result.tokensCredited = config.monthlyTokenGrant;
  result.tokenBalance = user.tokenBalance ?? 0;
  result.alreadyActivated = false;
  return result;
}

function serializeSubscription(user, now = new Date()) {
  const ent = getPlanEntitlements(user, now);
  const config = getPlanConfig(ent.plan);
  return {
    ...ent,
    storedPlan: user.subscriptionPlan || 'free',
    accent: config.accent,
    discoverTopSpotUntil: user.discoverTopSpotUntil
      ? new Date(user.discoverTopSpotUntil).toISOString()
      : null,
  };
}

function listPlansForClient() {
  return ['free', 'gold', 'platinum', 'black'].map((id) => {
    const p = PLANS[id];
    const pricing = {};
    for (const period of BILLING_PERIODS) {
      pricing[period.id] =
        id === 'free' ? 0 : PLAN_PRICING[id][period.id];
    }
    return {
      id: p.id,
      name: p.name,
      accent: p.accent,
      badge: p.badge,
      pricing,
      features: {
        chatSession: p.unlimitedChat
          ? 'Unlimited chat (no tokens)'
          : `${p.chatSessionHours}h token session`,
        monthlyTokens:
          p.monthlyTokenGrant > 0
            ? `${p.monthlyTokenGrant.toLocaleString()} tokens included`
            : 'No monthly tokens',
        tokenBonus: p.tokenBonusPercent
          ? `+${p.tokenBonusPercent}% bonus`
          : 'Standard pack prices',
        dailySpin:
          p.spinsPerDay >= 999
            ? 'Unlimited daily spins*'
            : `${p.spinsPerDay} daily spin${p.spinsPerDay > 1 ? 's' : ''}`,
        discoverBoost: p.discoverBoost ? 'Priority in Discover' : null,
        topSpotDaily: p.topSpotDaily
          ? `Daily ${p.topSpotMinutes || 40}-min top spot`
          : null,
        calls: 'Voice & video (friends only)',
        badge: p.badge ? `${p.name} badge` : null,
      },
    };
  });
}

function getDiscoverPriority(planId) {
  return PLAN_RANK[getEffectivePlan({ subscriptionPlan: planId, subscriptionExpiresAt: new Date(Date.now() + 86400000) })] || 1;
}

function compareDiscoverPriority(aPlan, bPlan) {
  const a = PLAN_RANK[aPlan] || 1;
  const b = PLAN_RANK[bPlan] || 1;
  return b - a;
}

module.exports = {
  PLANS,
  PLAN_IDS,
  BILLING_PERIODS,
  PLAN_PRICING,
  todayKey,
  getPlanConfig,
  getBillingPeriod,
  getPlanPrice,
  listBillingPeriods,
  getEffectivePlan,
  getSessionDurationMs,
  hasUnlimitedChat,
  getTokenBonusPercent,
  applyTokenBonus,
  resetSpinCountersIfNeeded,
  getSpinStatus,
  serializeSubscription,
  listPlansForClient,
  getDiscoverPriority,
  compareDiscoverPriority,
  compareDiscoverUsers,
  getPlanEntitlements,
  ensureDiscoverTopSpot,
  syncExpiredSubscription,
  expireDueSubscriptions,
  activateSubscription,
};
