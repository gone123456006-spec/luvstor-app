const express = require('express');
const { User, Report, SupportTicket, Call, Message } = require('../models/app');
const { asyncHandler, daysAgo, startOfUtcDay, fillDaySeries } = require('../lib/http');
const { cached } = require('../lib/cache');
const razorpay = require('../lib/razorpay');
const { requirePermission } = require('../middleware/auth');
const { can } = require('../lib/permissions');

const router = express.Router();
const MAX_MS = 20_000;
const LIVE_CALL_STATUSES = ['ringing', 'connecting', 'connected'];

async function loadOverview() {
  const now = new Date();
  const today = startOfUtcDay();
  const notGone = { deletionScheduledAt: null };

  const [
    total,
    signupsToday,
    signupsWeek,
    signupsMonth,
    byProvider,
    completed,
    dau,
    wau,
    mau,
    onlineNow,
    openReports,
    pendingVerifications,
    openTickets,
    subsByPlan,
    callsToday,
    liveCalls,
    messagesToday,
    signupRows,
  ] = await Promise.all([
    User.estimatedDocumentCount(),
    User.countDocuments({ createdAt: { $gte: today } }).maxTimeMS(MAX_MS),
    User.countDocuments({ createdAt: { $gte: daysAgo(7) } }).maxTimeMS(MAX_MS),
    User.countDocuments({ createdAt: { $gte: daysAgo(30) } }).maxTimeMS(MAX_MS),
    User.aggregate([{ $group: { _id: '$authProvider', n: { $sum: 1 } } }]).option({ maxTimeMS: MAX_MS }),
    User.countDocuments({ profileCompleted: true }).maxTimeMS(MAX_MS),
    User.countDocuments({ ...notGone, lastSeen: { $gte: daysAgo(1) } }).maxTimeMS(MAX_MS),
    User.countDocuments({ ...notGone, lastSeen: { $gte: daysAgo(7) } }).maxTimeMS(MAX_MS),
    User.countDocuments({ ...notGone, lastSeen: { $gte: daysAgo(30) } }).maxTimeMS(MAX_MS),
    // isOnline can go stale on hard kills — require a recent lastSeen too
    User.countDocuments({ isOnline: true, lastSeen: { $gte: daysAgo(1 / 24) } }).maxTimeMS(MAX_MS),
    Report.countDocuments({ status: 'open' }).maxTimeMS(MAX_MS),
    User.countDocuments({ 'photoVerification.status': 'pending' }).maxTimeMS(MAX_MS),
    SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress'] } }).maxTimeMS(MAX_MS),
    User.aggregate([
      { $match: { subscriptionPlan: { $nin: [null, 'free'] }, subscriptionExpiresAt: { $gt: now } } },
      { $group: { _id: '$subscriptionPlan', n: { $sum: 1 } } },
    ]).option({ maxTimeMS: MAX_MS }),
    Call.countDocuments({ startedAt: { $gte: today } }).maxTimeMS(MAX_MS),
    Call.countDocuments({ status: { $in: LIVE_CALL_STATUSES }, startedAt: { $gte: daysAgo(1 / 8) } }).maxTimeMS(MAX_MS),
    Message.countDocuments({ createdAt: { $gte: today } }).maxTimeMS(MAX_MS),
    User.aggregate([
      { $match: { createdAt: { $gte: new Date(today.getTime() - 29 * 86_400_000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    ]).option({ maxTimeMS: MAX_MS }),
  ]);

  const providers = { google: 0, email: 0 };
  for (const row of byProvider) providers[row._id === 'google' ? 'google' : 'email'] += row.n;
  const plans = Object.fromEntries(subsByPlan.map((r) => [r._id, r.n]));

  return {
    generatedAt: now.toISOString(),
    users: {
      total,
      signupsToday,
      signupsWeek,
      signupsMonth,
      byProvider: providers,
      profileCompleted: completed,
      profileCompletionRate: total ? completed / total : 0,
      dau,
      wau,
      mau,
      onlineNow,
    },
    queues: { openReports, pendingVerifications, openTickets },
    subscriptions: {
      active: Object.values(plans).reduce((a, b) => a + b, 0),
      byPlan: plans,
    },
    activity: { callsToday, liveCalls, messagesToday },
    signupsSeries: fillDaySeries(signupRows, 30),
  };
}

async function loadRevenue() {
  if (!razorpay.isConfigured()) return { configured: false };
  try {
    const { orders } = await razorpay.paidOrders(30);
    const today = startOfUtcDay().getTime();
    let revenueToday = 0;
    let revenueMonth = 0;
    for (const o of orders) {
      revenueMonth += o.amount;
      if (new Date(o.createdAt).getTime() >= today) revenueToday += o.amount;
    }
    return { configured: true, revenueToday, revenueMonth, paidOrders: orders.length, currency: 'INR' };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

router.get(
  '/',
  requirePermission('overview.view'),
  asyncHandler(async (req, res) => {
    const [overview, revenue] = await Promise.all([
      cached('overview', 60_000, loadOverview),
      can(req.admin.role, 'money.view') ? loadRevenue() : Promise.resolve(null),
    ]);
    res.json({ ...overview, revenue });
  }),
);

module.exports = router;
