const express = require('express');
const { User } = require('../models/app');
const { asyncHandler, pageParams, oneOf } = require('../lib/http');
const { cached } = require('../lib/cache');
const razorpay = require('../lib/razorpay');
const { LIST_FIELDS, PLAN_LABELS, PAID_PLANS, listUser, loadUserRefs } = require('../lib/users');
const { buildSearchFilter } = require('./users');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requirePermission('money.view'));
const MAX_MS = 15_000;
const DAY = 86_400_000;

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const data = await cached('subs:summary', 60_000, async () => {
      const now = new Date();
      const [rows, expiring7d, tokenBuyers] = await Promise.all([
        User.aggregate([
          { $match: { subscriptionPlan: { $in: PAID_PLANS } } },
          {
            $group: {
              _id: '$subscriptionPlan',
              active: { $sum: { $cond: [{ $gt: ['$subscriptionExpiresAt', now] }, 1, 0] } },
              total: { $sum: 1 },
            },
          },
        ]).option({ maxTimeMS: MAX_MS }),
        User.countDocuments({
          subscriptionPlan: { $in: PAID_PLANS },
          subscriptionExpiresAt: { $gt: now, $lte: new Date(now.getTime() + 7 * DAY) },
        }).maxTimeMS(MAX_MS),
        User.countDocuments({ lastTokenPaymentId: { $nin: [null, ''] } }).maxTimeMS(MAX_MS),
      ]);
      const plans = Object.fromEntries(
        PAID_PLANS.map((p) => {
          const r = rows.find((x) => x._id === p) || { active: 0, total: 0 };
          return [p, { label: PLAN_LABELS[p], active: r.active, expired: r.total - r.active }];
        }),
      );
      return {
        plans,
        activeTotal: Object.values(plans).reduce((a, p) => a + p.active, 0),
        expiredTotal: Object.values(plans).reduce((a, p) => a + p.expired, 0),
        expiring7d,
        tokenBuyers,
      };
    });
    res.json(data);
  }),
);

router.get(
  '/subscribers',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const plan = oneOf(req.query.plan, PAID_PLANS, '');
    const status = oneOf(req.query.status, ['active', 'expired', 'expiring', 'all'], 'active');
    const now = new Date();
    const filter = { subscriptionPlan: plan || { $in: PAID_PLANS } };
    if (status === 'active') filter.subscriptionExpiresAt = { $gt: now };
    else if (status === 'expired') filter.subscriptionExpiresAt = { $lte: now };
    else if (status === 'expiring') filter.subscriptionExpiresAt = { $gt: now, $lte: new Date(now.getTime() + 7 * DAY) };
    const search = buildSearchFilter(req.query.q);
    const query = Object.keys(search).length ? { $and: [filter, search] } : filter;
    const sort = status === 'expired' ? { subscriptionExpiresAt: -1 } : { subscriptionExpiresAt: 1 };

    const [rows, total] = await Promise.all([
      User.find(query).select(LIST_FIELDS).sort(sort).skip(skip).limit(limit).lean().maxTimeMS(MAX_MS),
      User.countDocuments(query).maxTimeMS(MAX_MS),
    ]);
    res.json({
      subscribers: rows.map((u) => {
        const expiresAt = u.subscriptionExpiresAt ? new Date(u.subscriptionExpiresAt) : null;
        const active = Boolean(expiresAt && expiresAt > now);
        return {
          user: listUser(u),
          planId: u.subscriptionPlan,
          planLabel: PLAN_LABELS[u.subscriptionPlan] || u.subscriptionPlan,
          expiresAt,
          active,
          daysLeft: active ? Math.ceil((expiresAt.getTime() - now.getTime()) / DAY) : 0,
        };
      }),
      page,
      limit,
      total,
    });
  }),
);

/** Token pack / subscription purchases from paid Razorpay orders. */
router.get(
  '/purchases',
  asyncHandler(async (req, res) => {
    const kind = oneOf(req.query.kind, ['tokens', 'subscription'], 'tokens');
    const { page, limit, skip } = pageParams(req.query, { defaultLimit: 50, maxLimit: 100 });

    if (!razorpay.isConfigured()) {
      // Without Razorpay only the last token purchase per user is known
      if (kind !== 'tokens') return res.json({ configured: false, purchases: [], page, limit, total: 0 });
      const filter = { lastTokenPaymentId: { $nin: [null, ''] } };
      const [rows, total] = await Promise.all([
        User.find(filter)
          .select(`${LIST_FIELDS} lastTokenPaymentId tokenPack10PurchaseCount updatedAt`)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean()
          .maxTimeMS(MAX_MS),
        User.countDocuments(filter).maxTimeMS(MAX_MS),
      ]);
      return res.json({
        configured: false,
        buyers: rows.map((u) => ({
          user: listUser(u),
          lastPaymentId: u.lastTokenPaymentId,
          pack10Purchases: u.tokenPack10PurchaseCount || 0,
        })),
        page,
        limit,
        total,
      });
    }

    const days = req.query.days === 'all' ? null : Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const { orders, truncated } = await razorpay.paidOrders(days);
    const plan = kind === 'subscription' ? oneOf(req.query.plan, PAID_PLANS, '') : '';
    const matching = orders.filter((o) => o.kind === kind && (!plan || o.planId === plan));
    const slice = matching.slice(skip, skip + limit);
    const refs = await loadUserRefs(User, slice.map((o) => o.userId).filter((id) => /^[a-f0-9]{24}$/i.test(id)));
    res.json({
      configured: true,
      days,
      truncated,
      totalAmount: Math.round(matching.reduce((a, o) => a + o.amount, 0) * 100) / 100,
      purchases: slice.map((o) => ({
        orderId: o.id,
        amount: o.amount,
        createdAt: o.createdAt,
        user: refs.get(o.userId) || (o.userId ? { id: o.userId, name: '(deleted user)', email: '', publicId: '', photo: '' } : null),
        planId: o.planId,
        planLabel: PLAN_LABELS[o.planId] || o.planId,
        periodId: o.periodId,
        packId: o.packId,
        tokens: o.tokens,
      })),
      page,
      limit,
      total: matching.length,
    });
  }),
);

module.exports = router;
