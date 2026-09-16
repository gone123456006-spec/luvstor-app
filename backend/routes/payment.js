const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { serializeAccess } = require('../services/chatTokens');
const { createNotification } = require('../services/notifications');
const {
  TOKEN_PACKS,
  PACK_10_ID,
  getPackPriceInr,
  serializePacksForUser,
} = require('../services/tokenPacks');
const { resolvePaidPackFromOrder } = require('../utils/paidPackFromOrder');
const { getRazorpay, paymentUnavailable } = require('../utils/razorpayClient');

// GET /api/payment/packs — personalized prices (pack 10 ladder)
router.get('/packs', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('tokenPack10PurchaseCount');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      packs: serializePacksForUser(user),
      tokenPack10PurchaseCount: user.tokenPack10PurchaseCount || 0,
    });
  } catch (err) {
    console.error('Payment packs error:', err);
    res.status(500).json({ error: 'Failed to load packs' });
  }
});

// POST /api/payment/create-order
router.post('/create-order', auth, async (req, res) => {
  try {
    const razorpay = getRazorpay();
    const { packId } = req.body;
    const pack = TOKEN_PACKS[packId];
    if (!pack) {
      return res.status(400).json({ error: 'Invalid token pack' });
    }

    const user = await User.findById(req.userId).select('tokenPack10PurchaseCount');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const priceInr = getPackPriceInr(packId, user);
    if (priceInr == null || priceInr < 1) {
      return res.status(400).json({ error: 'Invalid pack price' });
    }

    const options = {
      amount: priceInr * 100,
      currency: 'INR',
      receipt: `token_${req.userId}_${Date.now()}`.slice(0, 40),
      notes: {
        userId: String(req.userId),
        packId: String(packId),
        tokens: String(pack.tokens),
        priceInr: String(priceInr),
        pack10Count: String(user.tokenPack10PurchaseCount || 0),
      },
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      packId,
      tokens: pack.tokens,
      priceInr,
      listPriceInr: pack.listPriceInr,
    });
  } catch (err) {
    if (paymentUnavailable(res, err)) return;
    console.error('Payment create-order error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// POST /api/payment/verify
router.post('/verify', auth, async (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({
        error:
          'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env',
        code: 'RAZORPAY_NOT_CONFIGURED',
      });
    }

    const razorpay = getRazorpay();
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      packId: clientPackId,
    } = req.body;

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

    const existingUser = await User.findById(req.userId).select(
      'tokenBalance tokenPack10PurchaseCount lastTokenPaymentId chatSessionStartedAt chatSessionExpiresAt subscriptionPlan subscriptionExpiresAt',
    );
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Idempotency: same payment must not credit twice
    if (
      existingUser.lastTokenPaymentId &&
      existingUser.lastTokenPaymentId === razorpay_payment_id
    ) {
      return res.json({
        success: true,
        verified: true,
        credited: 0,
        alreadyCredited: true,
        tokenBalance: existingUser.tokenBalance ?? 0,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        packs: serializePacksForUser(existingUser),
        ...serializeAccess(existingUser),
      });
    }

    // Authoritative pack/amount come from the Razorpay order notes set at create-order.
    // Never credit from client-supplied packId (cheap-pay / large-credit attack).
    let order;
    try {
      order = await razorpay.orders.fetch(razorpay_order_id);
    } catch (e) {
      console.warn('order fetch failed', e?.message || e);
      return res.status(400).json({ error: 'Could not verify order' });
    }

    if (String(order.notes?.userId || '') !== String(req.userId)) {
      return res.status(403).json({ error: 'Order does not belong to this user' });
    }

    const resolved = resolvePaidPackFromOrder({
      order,
      clientPackId,
      TOKEN_PACKS,
      getPackPriceInr,
      user: existingUser,
    });
    if (!resolved.ok) {
      return res.status(resolved.status).json({
        error: resolved.error,
        ...(resolved.code ? { code: resolved.code } : {}),
      });
    }

    const { packId, credited } = resolved;
    const inc = { tokenBalance: credited };
    if (String(packId) === PACK_10_ID) {
      inc.tokenPack10PurchaseCount = 1;
    }

    const user = await User.findOneAndUpdate(
      {
        _id: req.userId,
        $or: [
          { lastTokenPaymentId: null },
          { lastTokenPaymentId: { $ne: razorpay_payment_id } },
          { lastTokenPaymentId: { $exists: false } },
        ],
      },
      {
        $inc: inc,
        $set: { lastTokenPaymentId: razorpay_payment_id },
      },
      {
        returnDocument: 'after',
        select:
          'tokenBalance tokenPack10PurchaseCount lastSpinDate chatSessionStartedAt chatSessionExpiresAt subscriptionPlan subscriptionExpiresAt',
      },
    );

    if (!user) {
      const again = await User.findById(req.userId).select(
        'tokenBalance tokenPack10PurchaseCount chatSessionStartedAt chatSessionExpiresAt subscriptionPlan subscriptionExpiresAt',
      );
      return res.json({
        success: true,
        verified: true,
        credited: 0,
        alreadyCredited: true,
        tokenBalance: again?.tokenBalance ?? 0,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        packs: serializePacksForUser(again),
        ...serializeAccess(again),
      });
    }

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
      packs: serializePacksForUser(user),
      tokenPack10PurchaseCount: user.tokenPack10PurchaseCount || 0,
      ...serializeAccess(user),
    });
  } catch (err) {
    if (paymentUnavailable(res, err)) return;
    console.error('Payment verify error:', err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

router.get('/razorpay-key', (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID || null;
  if (!keyId) {
    return res.status(503).json({
      error: 'Razorpay is not configured',
      code: 'RAZORPAY_NOT_CONFIGURED',
    });
  }
  res.json({ keyId });
});

module.exports = router;
