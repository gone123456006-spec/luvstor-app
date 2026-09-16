const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const {
  ensureProfileShareLink,
  ensureReferralShareLink,
} = require('../services/shareLinks');
const { ensureReferralCode } = require('../services/referrals');

/**
 * GET /api/share/profile/:publicId
 * Branded OneLink-style URL for a profile (no auth required).
 */
router.get('/profile/:publicId', async (req, res) => {
  try {
    const publicId = String(req.params.publicId || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{4}\d{4}$/.test(publicId)) {
      return res.status(400).json({ error: 'Invalid public ID' });
    }
    const owner = await User.findOne({ publicId }).select('_id publicId');
    if (!owner) return res.status(404).json({ error: 'Profile not found' });

    const link = await ensureProfileShareLink({
      publicId,
      ownerUserId: owner._id,
    });
    if (!link) return res.status(500).json({ error: 'Could not create share link' });

    res.json({
      shareUrl: link.shareUrl,
      slug: link.slug,
      publicId: link.publicId,
      type: 'profile',
    });
  } catch (err) {
    console.error('share/profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/share/me/profile  (auth)
 * Branded share URL for the signed-in user's profile.
 */
router.get('/me/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('_id publicId');
    if (!user?.publicId) {
      return res.status(400).json({ error: 'Profile ID not ready yet' });
    }
    const link = await ensureProfileShareLink({
      publicId: user.publicId,
      ownerUserId: user._id,
    });
    res.json({
      shareUrl: link.shareUrl,
      slug: link.slug,
      publicId: link.publicId,
      type: 'profile',
    });
  } catch (err) {
    console.error('share/me/profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/share/me/referral  (auth)
 * Same branded format for Refer & Earn (also returned by /api/referrals/me).
 */
router.get('/me/referral', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const code = await ensureReferralCode(user);
    const link = await ensureReferralShareLink({
      referralCode: code,
      ownerUserId: user._id,
    });
    res.json({
      shareUrl: link.shareUrl,
      slug: link.slug,
      referralCode: code,
      type: 'referral',
    });
  } catch (err) {
    console.error('share/me/referral error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/share/resolve/:slug
 * JSON resolve for app deep links (https://…/go/SLUG).
 */
router.get('/resolve/:slug', async (req, res) => {
  try {
    const { findBySlug } = require('../services/shareLinks');
    const row = await findBySlug(req.params.slug);
    if (!row) return res.status(404).json({ error: 'Link not found' });
    res.json({
      slug: row.slug,
      type: row.type,
      referralCode: row.referralCode || null,
      publicId: row.publicId || null,
    });
  } catch (err) {
    console.error('share/resolve error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
