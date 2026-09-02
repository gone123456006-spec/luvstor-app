const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { serializeAccess } = require('../services/chatTokens');
const { createNotification } = require('../services/notifications');

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Token pack prices in INR (paise for Razorpay)
const TOKEN_PACKS = {
  '10': { tokens: 10, price: 10 },
  '100': { tokens: 100, price: 80 },
  '500': { tokens: 500, price: 350 },
  '1000': { tokens: 1000, price: 600 },
  '5000': { tokens: 5000, price: 2000 },
  '10000': { tokens: 10000, price: 3000 },
  '50000': { tokens: 50000, price: 10000 },
  '100000': { tokens: 100000, price: 15000 },
};

// ─────────────────────────────────────────────
// POST /api/payment/create-order
// Create a Razorpay order for token purchase
// ─────────────────────────────────────────────
router.post('/create-order', auth, async (req, res) => {
  try {
    const { packId } = req.body;
    const pack = TOKEN_PACKS[packId];

    if (!pack) {
      return res.status(400).json({ error: 'Invalid token pack' });
    }

    const options = {
      amount: pack.price * 100, // Amount in paise (e.g., ₹10 = 1000 paise)
      currency: 'INR',
      receipt: `token_${req.userId}_${Date.now()}`,
      notes: {
        userId: req.userId.toString(),
        packId: packId,
        tokens: pack.tokens,
      },
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      packId: packId,
      tokens: pack.tokens,
    });
  } catch (err) {
    console.error('Payment create-order error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// ─────────────────────────────────────────────
// POST /api/payment/verify
// Verify Razorpay payment signature and credit tokens
// ─────────────────────────────────────────────
router.post('/verify', auth, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      packId,
    } = req.body;

    // Verify signature
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

    const pack = TOKEN_PACKS[packId];
    if (!pack) {
      return res.status(400).json({ error: 'Invalid token pack' });
    }

    const existingUser = await User.findById(req.userId).select(
      'tokenBalance lastSpinDate chatSessionStartedAt chatSessionExpiresAt',
    );
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const credited = pack.tokens;

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $inc: { tokenBalance: credited } },
      {
        new: true,
        select:
          'tokenBalance lastSpinDate chatSessionStartedAt chatSessionExpiresAt subscriptionPlan subscriptionExpiresAt',
      },
    );

    const io = req.app.get('io');
    await createNotification(io, {
      userId: req.userId,
      type: 'token_purchase',
      title: 'Purchase successful',
      body: `${credited} tokens added to your wallet.`,
      data: {
        screen: 'token',
        credited,
        packId,
        paymentId: razorpay_payment_id,
      },
    });

    res.json({
      success: true,
      verified: true,
      credited,
      tokenBalance: user.tokenBalance ?? 0,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      ...serializeAccess(user),
    });
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/payment/razorpay-key
// Get Razorpay key for frontend (public key only)
// ─────────────────────────────────────────────
router.get('/razorpay-key', (req, res) => {
  res.json({
    keyId: process.env.RAZORPAY_KEY_ID,
  });
});

module.exports = router;
