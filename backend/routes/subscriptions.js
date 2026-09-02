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
} = require('../services/subscriptions');
const { createNotification } = require('../services/notifications');
const User = require('../models/User');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─────────────────────────────────────────────
// GET /api/subscriptions/plans
// ─────────────────────────────────────────────
router.get('/plans', (req, res) => {
  res.json({
    plans: listPlansForClient(),
    billingPeriods: listBillingPeriods(),
    defaultPeriodId: 'monthly',
  });
});

// ─────────────────────────────────────────────
// GET /api/subscriptions/status
// ─────────────────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    await syncExpiredSubscription(req.userId);
    const user = await User.findById(req.userId).select(
      'subscriptionPlan subscriptionExpiresAt subscriptionSpinsUsedToday subscriptionSpinsDate spinTokensWonToday discoverTopSpotUntil discoverTopSpotDate',
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(serializeSubscription(user));
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
    const planId = String(req.body.planId || '');
    const periodId = String(req.body.periodId || 'monthly');
    const plan = PLANS[planId];
    const priceInfo = getPlanPrice(planId, periodId);

    if (!plan || planId === 'free' || !priceInfo) {
      return res.status(400).json({ error: 'Invalid subscription plan or period' });
    }

    const order = await razorpay.orders.create({
      amount: priceInfo.pricePaise,
      currency: 'INR',
      receipt: `sub_${req.userId}_${planId}_${periodId}_${Date.now()}`,
      notes: {
        userId: req.userId.toString(),
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
    res.status(500).json({ error: 'Failed to create subscription order' });
  }
});

// ─────────────────────────────────────────────
// POST /api/subscriptions/verify
// Activates the plan from Razorpay order notes (not client body)
// ─────────────────────────────────────────────
router.post('/verify', auth, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        error: 'Payment verification failed',
        code: 'INVALID_SIGNATURE',
      });
    }

    // Trust order notes written at create-order time
    const order = await razorpay.orders.fetch(razorpay_order_id);
    const notes = order?.notes || {};
    const planId = String(notes.planId || '');
    const periodId = String(notes.periodId || 'monthly');
    const noteUserId = String(notes.userId || '');

    if (noteUserId && noteUserId !== String(req.userId)) {
      return res.status(403).json({ error: 'Payment does not belong to this account' });
    }

    if (String(notes.type || '') !== 'subscription') {
      return res.status(400).json({ error: 'Not a subscription payment' });
    }

    const plan = PLANS[planId];
    const priceInfo = getPlanPrice(planId, periodId);
    if (!plan || planId === 'free' || !priceInfo) {
      return res.status(400).json({ error: 'Invalid subscription plan on order' });
    }

    // Amount check — paid order must match catalog price
    if (Number(order.amount) !== Number(priceInfo.pricePaise)) {
      return res.status(400).json({
        error: 'Payment amount does not match plan price',
        code: 'AMOUNT_MISMATCH',
      });
    }

    const subscription = await activateSubscription(
      req.userId,
      planId,
      priceInfo.durationDays,
      { paymentId: razorpay_payment_id },
    );

    if (!subscription.alreadyActivated) {
      const io = req.app.get('io');
      const tokenMsg =
        subscription.tokensCredited > 0
          ? ` ${subscription.tokensCredited} tokens added to your wallet.`
          : '';
      await createNotification(io, {
        userId: req.userId,
        type: 'subscription',
        title: `${plan.name} activated`,
        body: `Your ${plan.name} plan is active for ${priceInfo.periodLabel.toLowerCase()} (${priceInfo.durationDays} days).${tokenMsg}`,
        data: {
          screen: 'subscription',
          planId,
          periodId: priceInfo.periodId,
          paymentId: razorpay_payment_id,
          tokensCredited: subscription.tokensCredited || 0,
        },
      });
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
    });
  }
});

module.exports = router;
