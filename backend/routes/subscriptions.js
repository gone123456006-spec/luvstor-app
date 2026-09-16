const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const {
  PLANS,
  listPlansForClient,
  listBillingPeriods,
  getPlanPrice,
  serializeSubscription,
  activateSubscription,
  syncExpiredSubscription,
  getEffectivePlan,
} = require('../services/subscriptions');
const { createNotification } = require('../services/notifications');
const User = require('../models/User');

function razorpayConfigured() {
  return Boolean(
    process.env.RAZORPAY_KEY_ID?.trim() &&
      process.env.RAZORPAY_KEY_SECRET?.trim(),
  );
}

function getRazorpay() {
  if (!razorpayConfigured()) {
    const err = new Error(
      'Payments are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
    );
    err.status = 503;
    err.code = 'PAYMENTS_DISABLED';
    throw err;
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

function verifyCheckoutSignature(orderId, paymentId, signature) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
}

async function assertPaidSubscriptionOrder(razorpay, orderId, paymentId) {
  const order = await razorpay.orders.fetch(orderId);
  const notes = order?.notes || {};

  if (String(notes.type || '') !== 'subscription') {
    const err = new Error('Not a subscription payment');
    err.status = 400;
    throw err;
  }

  const planId = String(notes.planId || '');
  const periodId = String(notes.periodId || 'monthly');
  const plan = PLANS[planId];
  const priceInfo = getPlanPrice(planId, periodId);

  if (!plan || planId === 'free' || !priceInfo) {
    const err = new Error('Invalid subscription plan on order');
    err.status = 400;
    throw err;
  }

  if (Number(order.amount) !== Number(priceInfo.pricePaise)) {
    const err = new Error('Payment amount does not match plan price');
    err.status = 400;
    err.code = 'AMOUNT_MISMATCH';
    throw err;
  }

  // Confirm the payment itself is captured (not just signatured)
  if (paymentId) {
    const payment = await razorpay.payments.fetch(paymentId);
    const status = String(payment?.status || '');
    if (!['captured', 'authorized'].includes(status)) {
      const err = new Error(`Payment not complete (status: ${status || 'unknown'})`);
      err.status = 400;
      err.code = 'PAYMENT_INCOMPLETE';
      throw err;
    }
    if (String(payment.order_id || '') !== String(orderId)) {
      const err = new Error('Payment does not belong to this order');
      err.status = 400;
      throw err;
    }
    if (Number(payment.amount) !== Number(priceInfo.pricePaise)) {
      const err = new Error('Payment amount does not match plan price');
      err.status = 400;
      err.code = 'AMOUNT_MISMATCH';
      throw err;
    }
  }

  return { order, notes, planId, periodId, plan, priceInfo };
}

async function notifyActivated(io, userId, plan, priceInfo, paymentId, tokensCredited) {
  const tokenMsg =
    tokensCredited > 0
      ? ` ${tokensCredited} tokens added to your wallet.`
      : '';
  await createNotification(io, {
    userId,
    type: 'subscription',
    title: `${plan.name} activated`,
    body: `Your ${plan.name} plan is active for ${priceInfo.periodLabel.toLowerCase()} (${priceInfo.durationDays} days).${tokenMsg}`,
    data: {
      screen: 'subscription',
      planId: plan.id,
      periodId: priceInfo.periodId,
      paymentId: paymentId || '',
      tokensCredited: tokensCredited || 0,
    },
  });
}

// ─────────────────────────────────────────────
// GET /api/subscriptions/plans
// ─────────────────────────────────────────────
router.get('/plans', (req, res) => {
  res.json({
    plans: listPlansForClient(),
    billingPeriods: listBillingPeriods(),
    defaultPeriodId: 'monthly',
    paymentsEnabled: razorpayConfigured(),
  });
});

// ─────────────────────────────────────────────
// GET /api/subscriptions/status
// ─────────────────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    await syncExpiredSubscription(req.userId);
    const user = await User.findById(req.userId).select(
      'subscriptionPlan subscriptionExpiresAt subscriptionSpinsUsedToday subscriptionSpinsDate spinTokensWonToday spinWindowStartedAt discoverTopSpotUntil discoverTopSpotDate',
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      ...serializeSubscription(user),
      paymentsEnabled: razorpayConfigured(),
    });
  } catch (err) {
    console.error('subscriptions/status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/subscriptions/create-order
// ─────────────────────────────────────────────
router.post('/create-order', auth, async (req, res) => {
  try {
    const razorpay = getRazorpay();
    const planId = String(req.body.planId || '');
    const periodId = String(req.body.periodId || 'monthly');
    const plan = PLANS[planId];
    const priceInfo = getPlanPrice(planId, periodId);

    if (!plan || planId === 'free' || !priceInfo) {
      return res.status(400).json({
        error: 'Invalid subscription plan or period',
        code: 'INVALID_PLAN',
      });
    }

    // Soft check: warn client before charging if this would be a blocked downgrade
    await syncExpiredSubscription(req.userId);
    const user = await User.findById(req.userId).select(
      'subscriptionPlan subscriptionExpiresAt',
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    const current = getEffectivePlan(user);
    const {
      PLAN_RANK,
      getPlanConfig,
    } = require('../services/subscriptions');
    if (
      current !== 'free' &&
      (PLAN_RANK[planId] || 0) < (PLAN_RANK[current] || 0)
    ) {
      return res.status(409).json({
        error: `You already have ${getPlanConfig(current).name} active. Manage it from Subscriptions.`,
        code: 'DOWNGRADE_BLOCKED',
        currentPlan: current,
      });
    }

    const order = await razorpay.orders.create({
      amount: priceInfo.pricePaise,
      currency: 'INR',
      receipt: `sub_${String(req.userId).slice(-8)}_${planId}_${Date.now()}`.slice(
        0,
        40,
      ),
      notes: {
        userId: String(req.userId),
        planId,
        periodId: priceInfo.periodId,
        durationDays: String(priceInfo.durationDays),
        type: 'subscription',
      },
    });

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      planId,
      planName: plan.name,
      periodId: priceInfo.periodId,
      periodLabel: priceInfo.periodLabel,
      priceInr: priceInfo.priceInr,
      durationDays: priceInfo.durationDays,
    });
  } catch (err) {
    console.error('subscriptions/create-order error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Failed to create subscription order',
      code: err.code || 'CREATE_ORDER_FAILED',
    });
  }
});

// ─────────────────────────────────────────────
// POST /api/subscriptions/verify
// Activates the plan from Razorpay order notes (not client body)
// ─────────────────────────────────────────────
router.post('/verify', auth, async (req, res) => {
  try {
    const razorpay = getRazorpay();
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    if (
      !verifyCheckoutSignature(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      )
    ) {
      return res.status(400).json({
        error: 'Payment verification failed',
        code: 'INVALID_SIGNATURE',
      });
    }

    const { notes, planId, plan, priceInfo } = await assertPaidSubscriptionOrder(
      razorpay,
      razorpay_order_id,
      razorpay_payment_id,
    );

    const noteUserId = String(notes.userId || '');
    if (noteUserId && noteUserId !== String(req.userId)) {
      return res.status(403).json({ error: 'Payment does not belong to this account' });
    }

    const subscription = await activateSubscription(
      req.userId,
      planId,
      priceInfo.durationDays,
      { paymentId: razorpay_payment_id },
    );

    if (!subscription.alreadyActivated) {
      await notifyActivated(
        req.app.get('io'),
        req.userId,
        plan,
        priceInfo,
        razorpay_payment_id,
        subscription.tokensCredited,
      );
    }

    res.json({
      success: true,
      verified: true,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      periodId: priceInfo.periodId,
      periodLabel: priceInfo.periodLabel,
      durationDays: priceInfo.durationDays,
      ...subscription,
    });
  } catch (err) {
    console.error('subscriptions/verify error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Subscription verification failed',
      code: err.code || 'VERIFY_FAILED',
    });
  }
});

/**
 * Recover a paid order if the app closed after Razorpay success but before verify.
 * Looks up payments on the order and activates if any are captured.
 */
router.post('/recover', auth, async (req, res) => {
  try {
    const razorpay = getRazorpay();
    const orderId = String(req.body.orderId || req.body.razorpay_order_id || '');
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const payments = await razorpay.orders.fetchPayments(orderId);
    const items = payments?.items || [];
    const paid = items.find((p) =>
      ['captured', 'authorized'].includes(String(p.status || '')),
    );
    if (!paid) {
      return res.status(404).json({
        error: 'No completed payment found for this order',
        code: 'NO_PAYMENT',
      });
    }

    const { notes, planId, plan, priceInfo } = await assertPaidSubscriptionOrder(
      razorpay,
      orderId,
      paid.id,
    );

    const noteUserId = String(notes.userId || '');
    if (noteUserId && noteUserId !== String(req.userId)) {
      return res.status(403).json({ error: 'Payment does not belong to this account' });
    }

    const subscription = await activateSubscription(
      req.userId,
      planId,
      priceInfo.durationDays,
      { paymentId: paid.id },
    );

    if (!subscription.alreadyActivated) {
      await notifyActivated(
        req.app.get('io'),
        req.userId,
        plan,
        priceInfo,
        paid.id,
        subscription.tokensCredited,
      );
    }

    res.json({
      success: true,
      verified: true,
      recovered: true,
      paymentId: paid.id,
      orderId,
      periodId: priceInfo.periodId,
      periodLabel: priceInfo.periodLabel,
      durationDays: priceInfo.durationDays,
      ...subscription,
    });
  } catch (err) {
    console.error('subscriptions/recover error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Could not recover subscription',
      code: err.code || 'RECOVER_FAILED',
    });
  }
});

module.exports = router;
