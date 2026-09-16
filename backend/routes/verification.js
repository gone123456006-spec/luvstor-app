const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const User = require('../models/User');
const { redisRateLimit } = require('../utils/scaleHelpers');
const { PHOTO_VERIFICATION_TOKENS } = require('../services/chatTokens');
const {
  createChallenge,
  evaluatePhotoMatch,
  mainPhotoFingerprint,
  verifyChallengeToken,
  profilePhotoUrls,
  POSES,
  REVIEW_DELAY_MS,
} = require('../services/photoFaceMatch');

const submitLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) =>
    req.userId ? String(req.userId) : ipKeyGenerator(req, res),
  handler: (req, res) =>
    res.status(429).json({
      error: 'Too many verification attempts today',
      code: 'RATE_LIMIT',
    }),
});

const redisSubmitGuard = redisRateLimit({
  prefix: 'verify-selfie',
  windowMs: 24 * 60 * 60 * 1000,
  max: 8,
});

function remainingReviewMs(submittedAt, now = Date.now()) {
  if (!submittedAt) return REVIEW_DELAY_MS;
  const dueAt = new Date(submittedAt).getTime() + REVIEW_DELAY_MS;
  return Math.max(0, dueAt - now);
}

function serializePhotoVerification(user) {
  const pv = user.photoVerification || {};
  const submittedAt = pv.submittedAt || null;
  const status = pv.status || 'none';
  const remaining =
    status === 'pending' ? remainingReviewMs(submittedAt) : 0;
  return {
    status,
    selfieUrl: pv.selfieUrl || '',
    submittedAt,
    reviewedAt: pv.reviewedAt || null,
    reviewNote: pv.reviewNote || '',
    pose: pv.pose || '',
    matchScore: pv.matchScore ?? null,
    photoVerified: status === 'approved',
    analysisInMs: remaining,
    autoApproveInMs: remaining,
    analysisDueAt:
      status === 'pending' && submittedAt
        ? new Date(new Date(submittedAt).getTime() + REVIEW_DELAY_MS).toISOString()
        : null,
  };
}

function isOwnedUploadUrl(selfieUrl, userId) {
  const uid = String(userId);
  if (selfieUrl.startsWith('/uploads/')) {
    return selfieUrl.includes(`/uploads/${uid}/`);
  }
  try {
    const u = new URL(selfieUrl);
    return u.pathname.includes(`/uploads/${uid}/`);
  } catch {
    return false;
  }
}

function publicApiBase(req) {
  return (
    process.env.PUBLIC_API_URL ||
    (req ? `${req.protocol}://${req.get('host') || 'localhost:5000'}` : '')
  );
}

async function grantVerificationTokens(userId, io) {
  const granted = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { photoVerificationTokensGrantedAt: null },
        { photoVerificationTokensGrantedAt: { $exists: false } },
      ],
    },
    {
      $inc: { tokenBalance: PHOTO_VERIFICATION_TOKENS },
      $set: { photoVerificationTokensGrantedAt: new Date() },
    },
    { returnDocument: 'after' },
  ).select('tokenBalance');

  if (!granted) return { amount: 0, tokenBalance: null };

  try {
    const { createNotification } = require('../services/notifications');
    await createNotification(io, {
      userId,
      type: 'token',
      title: 'Photo verified!',
      body: `You received ${PHOTO_VERIFICATION_TOKENS} tokens for completing photo verification.`,
      deepLink: '/(tabs)/token',
      data: {
        screen: 'token',
        code: 'PHOTO_VERIFICATION_BONUS',
        amount: PHOTO_VERIFICATION_TOKENS,
      },
    });
  } catch (e) {
    console.warn('photo verification token notification failed', e?.message || e);
  }

  return { amount: PHOTO_VERIFICATION_TOKENS, tokenBalance: granted.tokenBalance };
}

/**
 * After 30 minutes: analyse DP + gallery + live selfie → approve or reject.
 */
async function finalizePendingAnalysis(userId, io, apiBase = '') {
  const user = await User.findById(userId).select(
    'photo photos photoVerification photoVerificationTokensGrantedAt tokenBalance',
  );
  if (!user || user.photoVerification?.status !== 'pending') {
    return { ok: false, reason: 'not_pending' };
  }

  const pv = user.photoVerification || {};
  const submittedAt = pv.submittedAt ? new Date(pv.submittedAt).getTime() : 0;
  if (!submittedAt || Date.now() - submittedAt < REVIEW_DELAY_MS) {
    return { ok: false, reason: 'too_early' };
  }

  const selfieUrl = String(pv.selfieUrl || '').trim();
  if (!selfieUrl) {
    await User.findByIdAndUpdate(userId, {
      $set: {
        'photoVerification.status': 'rejected',
        'photoVerification.reviewedAt': new Date(),
        'photoVerification.reviewNote': 'Missing selfie — please try again.',
        'photoVerification.matchScore': 0,
      },
    });
    return { ok: true, decision: 'reject' };
  }

  const match = await evaluatePhotoMatch({
    user,
    selfieUrl,
    pose: pv.pose || '',
    challengeToken: '',
    apiBase: apiBase || process.env.PUBLIC_API_URL || '',
    skipChallenge: true,
  });

  const approved = match.decision === 'approve';
  const updated = await User.findOneAndUpdate(
    {
      _id: userId,
      'photoVerification.status': 'pending',
    },
    {
      $set: {
        'photoVerification.status': approved ? 'approved' : 'rejected',
        'photoVerification.reviewedAt': new Date(),
        'photoVerification.reviewNote': match.reason,
        'photoVerification.matchScore': match.score,
        'photoVerification.verifiedMainPhoto': approved
          ? mainPhotoFingerprint(user)
          : '',
      },
    },
    { returnDocument: 'after' },
  ).select('photoVerification tokenBalance photoVerificationTokensGrantedAt');

  if (!updated) return { ok: false, reason: 'race' };

  let verificationTokensGranted = 0;
  if (approved && !updated.photoVerificationTokensGrantedAt) {
    const g = await grantVerificationTokens(userId, io);
    verificationTokensGranted = g.amount;
  }

  try {
    const { createNotification } = require('../services/notifications');
    if (approved) {
      await createNotification(io, {
        userId,
        type: 'system',
        title: 'Photo verified',
        body: verificationTokensGranted
          ? `Analysis complete — you're verified. +${verificationTokensGranted} tokens.`
          : "Analysis complete — your profile now shows a photo verified badge.",
        deepLink: '/(tabs)/profile',
        data: { screen: 'profile', code: 'PHOTO_VERIFIED' },
      });
    } else {
      await createNotification(io, {
        userId,
        type: 'system',
        title: 'Photo verification failed',
        body: match.reason || 'Try again with a clearer live selfie.',
        deepLink: '/photo-verify',
        data: { screen: 'photo-verify', code: 'PHOTO_REJECTED' },
      });
    }
  } catch (e) {
    console.warn('verification result notification failed', e?.message || e);
  }

  console.log(
    `[verification] analysed ${userId} → ${match.decision} (score=${match.score})`,
  );

  return {
    ok: true,
    decision: match.decision,
    score: match.score,
    verificationTokensGranted,
  };
}

function schedulePendingAnalysis(userId, io, apiBase) {
  setTimeout(() => {
    finalizePendingAnalysis(userId, io, apiBase).catch((err) => {
      console.warn('[verification] delayed analysis failed', err?.message || err);
    });
  }, REVIEW_DELAY_MS);
}

/**
 * Batch: finish any pending submissions past the 30-minute analysis window.
 */
async function approveDuePhotoVerifications(io) {
  const cutoff = new Date(Date.now() - REVIEW_DELAY_MS);
  const due = await User.find({
    'photoVerification.status': 'pending',
    'photoVerification.submittedAt': { $lte: cutoff },
  })
    .select('_id')
    .limit(50)
    .lean();

  let done = 0;
  for (const row of due) {
    const result = await finalizePendingAnalysis(row._id, io);
    if (result.ok) done += 1;
  }
  return done;
}

async function approvePhotoVerification(userId, io, reviewNote = 'Approved') {
  const current = await User.findById(userId).select('photo photoVerification');
  if (!current) return { ok: false };

  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      'photoVerification.status': { $in: ['pending', 'rejected', 'none'] },
    },
    {
      $set: {
        'photoVerification.status': 'approved',
        'photoVerification.reviewedAt': new Date(),
        'photoVerification.reviewNote': String(reviewNote || '').slice(0, 500),
        'photoVerification.verifiedMainPhoto': mainPhotoFingerprint(current),
      },
    },
    { returnDocument: 'after' },
  ).select('photoVerification tokenBalance photoVerificationTokensGrantedAt');

  if (!user) return { ok: false, user: null, verificationTokensGranted: 0 };

  let verificationTokensGranted = 0;
  let tokenBalance = user.tokenBalance ?? 0;
  if (!user.photoVerificationTokensGrantedAt) {
    const g = await grantVerificationTokens(userId, io);
    verificationTokensGranted = g.amount;
    if (g.tokenBalance != null) tokenBalance = g.tokenBalance;
  }

  return { ok: true, user, verificationTokensGranted, tokenBalance };
}

// GET /api/verification/challenge
router.get('/challenge', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('photoVerification photo photos');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.photoVerification?.status === 'approved') {
      return res.json({
        ...serializePhotoVerification(user),
        alreadyVerified: true,
        poses: POSES,
      });
    }
    if (user.photoVerification?.status === 'pending') {
      return res.json({
        ...serializePhotoVerification(user),
        alreadyVerified: false,
        pending: true,
        poses: POSES,
      });
    }
    const challenge = createChallenge();
    res.json({ ...challenge, poses: POSES, alreadyVerified: false });
  } catch (err) {
    console.error('verification/challenge error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/verification/me — may finish overdue analysis
router.get('/me', auth, async (req, res) => {
  try {
    let user = await User.findById(req.userId).select('photoVerification');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const pv = user.photoVerification || {};
    if (pv.status === 'pending' && pv.submittedAt) {
      const age = Date.now() - new Date(pv.submittedAt).getTime();
      if (age >= REVIEW_DELAY_MS) {
        await finalizePendingAnalysis(
          req.userId,
          req.app.get('io'),
          publicApiBase(req),
        );
        user = await User.findById(req.userId).select('photoVerification');
      }
    }

    res.json(serializePhotoVerification(user));
  } catch (err) {
    console.error('verification/me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/verification/selfie
 * Validate live pose → queue for 30 min analysis of DP + photos + selfie.
 */
router.post('/selfie', auth, redisSubmitGuard, submitLimiter, async (req, res) => {
  try {
    const selfieUrl = String(req.body.selfieUrl || '').trim();
    const pose = String(req.body.pose || '').trim();
    const challengeToken = String(req.body.challengeToken || '').trim();

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

    const existing = await User.findById(req.userId).select(
      'photo photos photoVerification',
    );
    if (!existing) return res.status(404).json({ error: 'User not found' });

    if (existing.photoVerification?.status === 'approved') {
      return res.json({
        ...serializePhotoVerification(existing),
        message: 'Already photo verified',
        decision: 'pending',
      });
    }

    if (existing.photoVerification?.status === 'pending') {
      return res.json({
        ...serializePhotoVerification(existing),
        message:
          'Analysis already in progress. We are comparing your DP, photos, and live selfie.',
        decision: 'pending',
      });
    }

    const challenge = verifyChallengeToken(challengeToken, pose);
    if (!challenge.ok) {
      return res.status(400).json({ error: challenge.reason, code: 'CHALLENGE' });
    }

    if (!profilePhotoUrls(existing).length) {
      return res.status(400).json({
        error: 'Add at least one clear profile photo, then try again.',
        code: 'NO_PROFILE_PHOTO',
      });
    }

    const now = new Date();
    const user = await User.findByIdAndUpdate(
      req.userId,
      {
        $set: {
          photoVerification: {
            status: 'pending',
            selfieUrl,
            submittedAt: now,
            reviewedAt: null,
            reviewNote: 'Analysing your DP, profile photos, and live selfie…',
            pose,
            matchScore: null,
            verifiedMainPhoto: '',
          },
        },
      },
      { returnDocument: 'after' },
    ).select('photoVerification');

    const apiBase = publicApiBase(req);
    schedulePendingAnalysis(req.userId, req.app.get('io'), apiBase);

    res.status(201).json({
      ...serializePhotoVerification(user),
      decision: 'pending',
      message:
        'Selfie received. We will analyse your DP, profile photos, and live selfie for about 30 minutes, then approve or reject.',
      analysisInMs: REVIEW_DELAY_MS,
      autoApproveInMs: REVIEW_DELAY_MS,
      canRetry: false,
    });
  } catch (err) {
    console.error('verification/selfie error:', err);
    res.status(500).json({ error: 'Could not submit verification' });
  }
});

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

    if (decision === 'reject') {
      const user = await User.findByIdAndUpdate(
        req.params.userId,
        {
          $set: {
            'photoVerification.status': 'rejected',
            'photoVerification.reviewedAt': new Date(),
            'photoVerification.reviewNote': reviewNote || 'Rejected',
          },
        },
        { returnDocument: 'after' },
      ).select('photoVerification');
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(serializePhotoVerification(user));
    }

    const result = await approvePhotoVerification(
      req.params.userId,
      req.app.get('io'),
      reviewNote || 'Approved',
    );
    if (!result.ok) return res.status(404).json({ error: 'User not found' });

    res.json({
      ...serializePhotoVerification(result.user),
      verificationTokensGranted: result.verificationTokensGranted,
      tokenBalance: result.tokenBalance,
    });
  } catch (err) {
    console.error('verification/admin decide error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.serializePhotoVerification = serializePhotoVerification;
module.exports.approvePhotoVerification = approvePhotoVerification;
module.exports.approveDuePhotoVerifications = approveDuePhotoVerifications;
module.exports.finalizePendingAnalysis = finalizePendingAnalysis;
module.exports.REVIEW_DELAY_MS = REVIEW_DELAY_MS;
module.exports.mainPhotoFingerprint = mainPhotoFingerprint;
