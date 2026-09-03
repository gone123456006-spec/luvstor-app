const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const User = require('../models/User');
const { redisRateLimit } = require('../utils/scaleHelpers');

const submitLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) =>
    req.userId ? String(req.userId) : ipKeyGenerator(req, res),
  handler: (req, res) =>
    res.status(429).json({
      error: 'Too many verification submissions today',
      code: 'RATE_LIMIT',
    }),
});

const redisSubmitGuard = redisRateLimit({
  prefix: 'verify-selfie',
  windowMs: 24 * 60 * 60 * 1000,
  max: 5,
});

function serializePhotoVerification(user) {
  const pv = user.photoVerification || {};
  return {
    status: pv.status || 'none',
    selfieUrl: pv.selfieUrl || '',
    submittedAt: pv.submittedAt || null,
    reviewedAt: pv.reviewedAt || null,
    reviewNote: pv.reviewNote || '',
    photoVerified: pv.status === 'approved',
  };
}

function isOwnedUploadUrl(selfieUrl, userId) {
  const uid = String(userId);
  // Relative: /uploads/{userId}/...
  if (selfieUrl.startsWith('/uploads/')) {
    return selfieUrl.includes(`/uploads/${uid}/`);
  }
  // Absolute URL pointing at our uploads path
  try {
    const u = new URL(selfieUrl);
    return u.pathname.includes(`/uploads/${uid}/`);
  } catch {
    return false;
  }
}

// GET /api/verification/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('photoVerification');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(serializePhotoVerification(user));
  } catch (err) {
    console.error('verification/me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/verification/selfie
 * Body: { selfieUrl } from /api/upload/image
 * Sets status to pending. Does not change isVerified.
 */
router.post('/selfie', auth, redisSubmitGuard, submitLimiter, async (req, res) => {
  try {
    const selfieUrl = String(req.body.selfieUrl || '').trim();
    if (!selfieUrl || selfieUrl.length > 2000) {
      return res.status(400).json({ error: 'selfieUrl is required' });
    }
    if (!/^https?:\/\//i.test(selfieUrl) && !selfieUrl.startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Invalid selfieUrl' });
    }
    if (!isOwnedUploadUrl(selfieUrl, req.userId)) {
      return res.status(400).json({
        error: 'Selfie must be an upload from your account',
        code: 'SELFIE_OWNERSHIP',
      });
    }

    const existing = await User.findById(req.userId).select('photoVerification');
    if (!existing) return res.status(404).json({ error: 'User not found' });

    if (existing.photoVerification?.status === 'approved') {
      return res.json({
        ...serializePhotoVerification(existing),
        message: 'Already photo verified',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      {
        $set: {
          photoVerification: {
            status: 'pending',
            selfieUrl,
            submittedAt: new Date(),
            reviewedAt: null,
            reviewNote: '',
          },
        },
      },
      { returnDocument: 'after' },
    ).select('photoVerification');

    res.status(201).json({
      ...serializePhotoVerification(user),
      message: 'Selfie submitted. We will review it shortly.',
    });
  } catch (err) {
    console.error('verification/selfie error:', err);
    res.status(500).json({ error: 'Could not submit verification' });
  }
});

// ── Admin review ───────────────────────────────────────────────────────
router.get('/admin/pending', adminAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const users = await User.find({ 'photoVerification.status': 'pending' })
      .sort({ 'photoVerification.submittedAt': 1 })
      .limit(limit)
      .select('name email publicId photo photoVerification')
      .lean();
    res.json({
      pending: users.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        publicId: u.publicId,
        photo: u.photo,
        ...serializePhotoVerification(u),
      })),
    });
  } catch (err) {
    console.error('verification/admin pending error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/admin/:userId', adminAuth, async (req, res) => {
  try {
    const decision = String(req.body.decision || '').trim();
    const reviewNote = String(req.body.reviewNote || '').slice(0, 500);
    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({ error: 'decision must be approve or reject' });
    }

    const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
    const user = await User.findOneAndUpdate(
      {
        _id: req.params.userId,
        'photoVerification.status': 'pending',
      },
      {
        $set: {
          'photoVerification.status': nextStatus,
          'photoVerification.reviewedAt': new Date(),
          'photoVerification.reviewNote': reviewNote,
        },
      },
      { returnDocument: 'after' },
    ).select('photoVerification');

    if (!user) {
      const current = await User.findById(req.params.userId).select('photoVerification');
      if (!current) return res.status(404).json({ error: 'User not found' });
      return res.status(400).json({
        error: 'No pending verification',
        status: current.photoVerification?.status || 'none',
      });
    }

    res.json(serializePhotoVerification(user));
  } catch (err) {
    console.error('verification/admin decide error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.serializePhotoVerification = serializePhotoVerification;
