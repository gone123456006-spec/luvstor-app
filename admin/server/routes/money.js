const express = require('express');
const { User, Referral } = require('../models/app');
const { asyncHandler, oneOf, daysAgo, startOfUtcDay, fillDaySeries } = require('../lib/http');
const { cached } = require('../lib/cache');
const razorpay = require('../lib/razorpay');
const { loadUserRefs } = require('../lib/users');
const { summarizeOrders } = require('../lib/revenue');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requirePermission('money.view'));
const MAX_MS = 20_000;

// Keep in sync with backend/services/chatTokens.js (display only)
const WELCOME_PROFILE_TOKENS = 50;
const PHOTO_VERIFICATION_TOKENS = 30;
const GALLERY_POST_TOKENS_PER_IMAGE = 5;

async function loadSummary() {
  const now = new Date();
  const [subsByPlan, expiringSoon, economy, referralTokens] = await Promise.all([
    User.aggregate([
      { $match: { subscriptionPlan: { $nin: [null, 'free'] }, subscriptionExpiresAt: { $gt: now } } },
      { $group: { _id: '$subscriptionPlan', n: { $sum: 1 } } },
    ]).option({ maxTimeMS: MAX_MS }),
    User.countDocuments({
      subscriptionPlan: { $nin: [null, 'free'] },
      subscriptionExpiresAt: { $gt: now, $lte: new Date(now.getTime() + 7 * 86_400_000) },
    }).maxTimeMS(MAX_MS),
    User.aggregate([
      {
        $group: {
          _id: null,
          circulating: { $sum: { $ifNull: ['$tokenBalance', 0] } },
          packPurchases: { $sum: { $ifNull: ['$tokenPack10PurchaseCount', 0] } },
          welcomeGrants: { $sum: { $cond: [{ $ifNull: ['$welcomeTokensGrantedAt', false] }, 1, 0] } },
          verificationGrants: { $sum: { $cond: [{ $ifNull: ['$photoVerificationTokensGrantedAt', false] }, 1, 0] } },
          galleryRewardSlots: { $sum: { $ifNull: ['$galleryPostRewardCount', 0] } },
          holders: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$tokenBalance', 0] }, 0] }, 1, 0] } },
        },
      },
    ]).option({ maxTimeMS: MAX_MS }),
    Referral.aggregate([
      { $match: { status: 'rewarded' } },
      { $group: { _id: null, tokens: { $sum: '$tokensAwarded' }, n: { $sum: 1 } } },
    ]).option({ maxTimeMS: MAX_MS }),
  ]);

  const e = economy[0] || {};
  const r = referralTokens[0] || { tokens: 0, n: 0 };
  // Referral tokens go to the referrer; the referee's side is not recorded separately
  const granted = {
    welcome: (e.welcomeGrants || 0) * WELCOME_PROFILE_TOKENS,
    photoVerification: (e.verificationGrants || 0) * PHOTO_VERIFICATION_TOKENS,
    galleryPosts: (e.galleryRewardSlots || 0) * GALLERY_POST_TOKENS_PER_IMAGE,
    referrals: r.tokens || 0,
  };
  const plans = Object.fromEntries(subsByPlan.map((x) => [x._id, x.n]));
  return {
    subscriptions: {
      active: Object.values(plans).reduce((a, b) => a + b, 0),
      byPlan: plans,
      expiringIn7Days: expiringSoon,
    },
    tokens: {
      circulating: e.circulating || 0,
      holders: e.holders || 0,
      packPurchases: e.packPurchases || 0,
      freeGranted: granted,
      freeGrantedTotal: Object.values(granted).reduce((a, b) => a + b, 0),
      referralsRewarded: r.n || 0,
    },
  };
}

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    res.json(await cached('money:summary', 120_000, loadSummary));
  }),
);

const REVENUE_RANGES = { today: 1, '7': 7, '30': 30, '90': 90, '365': 365, all: null };

router.get(
  '/revenue',
  asyncHandler(async (req, res) => {
    if (!razorpay.isConfigured()) return res.json({ configured: false });
    const range = Object.hasOwn(REVENUE_RANGES, String(req.query.range)) ? String(req.query.range) : '30';
    const days = REVENUE_RANGES[range];
    const { orders, truncated } = await razorpay.paidOrders(days);
    res.json({ configured: true, range, currency: 'INR', truncated, ...summarizeOrders(orders, days) });
  }),
);

/** Payment attempts (success/failure/method) over the last N days. */
router.get(
  '/payment-stats',
  asyncHandler(async (req, res) => {
    if (!razorpay.isConfigured()) return res.json({ configured: false });
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const payments = await razorpay.recentPayments(days);
    const byDay = new Map();
    const byMethod = {};
    let captured = 0;
    let failed = 0;
    let revenue = 0;
    let refunded = 0;
    for (const p of payments) {
      const day = p.createdAt.slice(0, 10);
      if (p.status === 'captured') {
        captured += 1;
        revenue += p.amount;
        byDay.set(day, (byDay.get(day) || 0) + p.amount);
        byMethod[p.method || 'other'] = (byMethod[p.method || 'other'] || 0) + p.amount;
      } else if (p.status === 'failed') {
        failed += 1;
      } else if (p.status === 'refunded') {
        refunded += 1;
      }
    }
    const series = fillDaySeries(
      [...byDay.entries()].map(([k, v]) => ({ _id: k, count: v })),
      days,
    );
    res.json({
      configured: true,
      days,
      currency: 'INR',
      revenue,
      captured,
      failed,
      refunded,
      successRate: captured + failed ? captured / (captured + failed) : null,
      byMethod,
      series,
      truncated: payments.length >= 3000,
    });
  }),
);

router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    if (!razorpay.isConfigured()) return res.json({ configured: false, payments: [] });
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 50;
    const status = oneOf(req.query.status, ['captured', 'failed', 'refunded', 'authorized', 'created'], '');
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    let payments;
    if (status) {
      const all = await razorpay.recentPayments(days);
      const filtered = all.filter((p) => p.status === status);
      payments = filtered.slice((page - 1) * limit, page * limit);
      return res.json({ configured: true, payments, page, hasMore: filtered.length > page * limit });
    }
    const from = new Date(startOfUtcDay().getTime() - (days - 1) * 86_400_000);
    payments = await razorpay.listPayments({ from, count: limit, skip: (page - 1) * limit });
    return res.json({ configured: true, payments, page, hasMore: payments.length === limit });
  }),
);

router.get(
  '/referrals',
  asyncHandler(async (_req, res) => {
    const data = await cached('money:referrals', 5 * 60_000, async () => {
      const [leaders, daily, bursts, revoked] = await Promise.all([
        Referral.aggregate([
          { $match: { status: 'rewarded' } },
          { $group: { _id: '$referrerId', n: { $sum: 1 }, tokens: { $sum: '$tokensAwarded' }, last: { $max: '$createdAt' } } },
          { $sort: { n: -1 } },
          { $limit: 25 },
        ]).option({ maxTimeMS: MAX_MS }),
        Referral.aggregate([
          { $match: { createdAt: { $gte: new Date(startOfUtcDay().getTime() - 29 * 86_400_000) } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        ]).option({ maxTimeMS: MAX_MS }),
        // Fraud signal: many rewarded referrals in the last 24h
        Referral.aggregate([
          { $match: { createdAt: { $gte: daysAgo(1) } } },
          { $group: { _id: '$referrerId', n: { $sum: 1 } } },
          { $match: { n: { $gte: 10 } } },
          { $sort: { n: -1 } },
          { $limit: 25 },
        ]).option({ maxTimeMS: MAX_MS }),
        Referral.countDocuments({ status: 'revoked' }),
      ]);
      const refs = await loadUserRefs(User, [...leaders.map((l) => l._id), ...bursts.map((b) => b._id)]);
      const ref = (id) => refs.get(String(id)) || { id: String(id), name: '(deleted)' };
      return {
        leaders: leaders.map((l) => ({ user: ref(l._id), referrals: l.n, tokens: l.tokens, lastAt: l.last })),
        series: fillDaySeries(daily, 30),
        suspicious: bursts.map((b) => ({ user: ref(b._id), referrals24h: b.n })),
        revoked,
      };
    });
    res.json(data);
  }),
);

module.exports = router;
