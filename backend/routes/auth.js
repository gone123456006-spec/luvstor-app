const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OTP = require('../models/OTP');
const auth = require('../middleware/auth');
const { smtpConfig } = require('../config/smtp');
const {
  generateOTP,
  sendOTPEmail,
  getSmtpStatus,
  shouldUseDevMode,
} = require('../utils/email');
const {
  normalizeEmail,
  checkSendRateLimit,
  recordOtpSent,
  checkVerifyRateLimit,
  recordVerifyAttempt,
} = require('../middleware/otpRateLimit');
const { serializeUser } = require('../utils/userHelpers');
const { generateUniquePublicId, ensureUserPublicId } = require('../utils/publicId');
const { checkAndRestoreOnLogin } = require('../jobs/accountDeletion');
const { verifyFirebaseIdToken, isFirebaseAdminReady } = require('../services/firebaseAdmin');
const { verifyGoogleIdToken, isGoogleAuthConfigured } = require('../services/googleAuth');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEVICE_IN_USE_MESSAGE =
  'This account is already logged in on another device. Please log out from the previous device before signing in on this one.';

function isValidDeviceId(deviceId) {
  return typeof deviceId === 'string' && deviceId.trim().length >= 8 && deviceId.trim().length <= 128;
}

function issueToken(user) {
  return jwt.sign(
    { userId: user._id, deviceId: user.activeDeviceId },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

async function bindDeviceAndRespond(res, user, deviceId, io = null) {
  const previousDeviceId = user.activeDeviceId;
  const isNewDevice = Boolean(previousDeviceId) && previousDeviceId !== deviceId;

  user.activeDeviceId = deviceId;
  user.activeDeviceBoundAt = new Date();
  user.isVerified = true;
  await ensureUserPublicId(user);
  await user.save();

  if (isNewDevice) {
    // Alert first — the old device still has a live token at this point,
    // which is exactly who needs to hear about an unexpected sign-in
    try {
      const { createNotification } = require('../services/notifications');
      await createNotification(io, {
        userId: user._id,
        type: 'security',
        title: 'New device sign-in',
        body: 'Your account was signed in on a new device. If this was not you, secure your account.',
        data: { code: 'NEW_DEVICE_LOGIN' },
      });
    } catch {
      /* ignore */
    }

    // The old device can no longer use the account — stop pushing to it
    try {
      const { removeTokensForDevice } = require('../services/deviceTokens');
      await removeTokensForDevice(previousDeviceId);
    } catch {
      /* ignore */
    }
  }

  res.json({
    success: true,
    token: issueToken(user),
    user: serializeUser(user),
  });
}

// ─────────────────────────────────────────────
// GET /api/auth/smtp-status
// ─────────────────────────────────────────────
router.get('/smtp-status', (req, res) => {
  res.json({ success: true, smtp: getSmtpStatus() });
});

// ─────────────────────────────────────────────
// POST /api/auth/google
// Body: { idToken, deviceId, forceTransfer? }
// ─────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const idToken = String(req.body.idToken || '').trim();
    const deviceId = String(req.body.deviceId || '').trim();
    const forceTransfer = Boolean(req.body.forceTransfer);

    if (!idToken) {
      return res.status(400).json({ error: 'Google ID token is required' });
    }

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'Valid device ID is required' });
    }

    if (!isGoogleAuthConfigured()) {
      return res.status(503).json({
        error: 'Google sign-in is not configured on the server. Set GOOGLE_WEB_CLIENT_ID in backend/.env',
      });
    }

    let decoded;
    try {
      // Prefer direct Google OAuth token (Expo auth-session)
      decoded = await verifyGoogleIdToken(idToken);
    } catch (googleErr) {
      // Fallback: Firebase ID token if client still sends one
      if (isFirebaseAdminReady()) {
        try {
          const firebaseDecoded = await verifyFirebaseIdToken(idToken);
          decoded = {
            sub: firebaseDecoded.uid,
            email: firebaseDecoded.email,
            name: firebaseDecoded.name,
            picture: firebaseDecoded.picture,
            email_verified: true,
          };
        } catch {
          console.error('google auth verify error:', googleErr.message);
          return res.status(401).json({ error: 'Invalid or expired Google sign-in. Please try again.' });
        }
      } else {
        console.error('google auth verify error:', googleErr.message);
        return res.status(401).json({ error: 'Invalid or expired Google sign-in. Please try again.' });
      }
    }

    const googleUid = decoded.sub;
    const email = normalizeEmail(decoded.email);
    if (!email) {
      return res.status(400).json({ error: 'Your Google account must have an email address' });
    }

    let user = await User.findOne({
      $or: [{ googleUid }, { email }],
    });

    if (!user) {
      const publicId = await generateUniquePublicId();
      user = await User.create({
        email,
        googleUid,
        name: decoded.name || '',
        photo: decoded.picture || '',
        isVerified: true,
        publicId,
        authProvider: 'google',
      });
    } else {
      if (!user.googleUid) user.googleUid = googleUid;
      if (!user.name && decoded.name) user.name = decoded.name;
      if (!user.photo && decoded.picture) user.photo = decoded.picture;
      user.authProvider = 'google';
    }

    const restoreResult = await checkAndRestoreOnLogin(user._id);
    if (restoreResult?.error) {
      return res.status(403).json({
        error: restoreResult.error,
        expired: restoreResult.expired,
      });
    }
    if (restoreResult?.restored) {
      user = restoreResult.user;
    }

    const otherDeviceActive =
      Boolean(user.activeDeviceId) && user.activeDeviceId !== deviceId;

    if (otherDeviceActive && !forceTransfer) {
      return res.status(403).json({
        error: DEVICE_IN_USE_MESSAGE,
        code: 'DEVICE_IN_USE',
      });
    }

    await bindDeviceAndRespond(res, user, deviceId, req.app.get('io'));
  } catch (err) {
    console.error('google auth error:', err);
    res.status(500).json({ error: 'Server error during Google sign-in' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/send-otp
// ─────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    const rateCheck = checkSendRateLimit(email);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: rateCheck.error || `Please wait ${rateCheck.retryAfterSeconds}s before requesting another code`,
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      });
    }

    await OTP.updateMany({ email, used: false }, { used: true });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + smtpConfig.otpExpiryMinutes * 60 * 1000);
    await OTP.create({ email, otp, expiresAt });

    await sendOTPEmail(email, otp);
    recordOtpSent(email);

    const payload = {
      success: true,
      message: `Verification code sent to ${email}`,
      expiresInMinutes: smtpConfig.otpExpiryMinutes,
      resendCooldownSeconds: smtpConfig.resendCooldownSeconds,
    };

    if (shouldUseDevMode()) {
      payload.devMode = true;
      payload.hint = 'SMTP dev mode: check the backend console for the OTP code';
    }

    res.json(payload);
  } catch (err) {
    console.error('send-otp error:', err);
    const message =
      err.code === 'RENDER_SMTP_BLOCKED'
        ? 'Email blocked on this host. Set BREVO_API_KEY in Render (SMTP ports are blocked on free tier).'
        : err.code === 'BREVO_API'
          ? 'Brevo API rejected the email. Check BREVO_API_KEY and that SMTP_FROM_EMAIL is verified in Brevo.'
          : err.code === 'EAUTH'
            ? 'SMTP authentication failed. Check SMTP_USER / SMTP_PASS or use BREVO_API_KEY.'
            : err.code === 'ESOCKET' || err.code === 'ECONNECTION' || /timeout/i.test(err.message || '')
              ? `Cannot reach SMTP (${smtpConfig.host}:${smtpConfig.port}). On Render free tier set BREVO_API_KEY instead.`
              : 'Failed to send verification email. Check BREVO_API_KEY / SMTP settings.';

    res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/verify-otp
// Body: { email, otp, deviceId, forceTransfer? }
// forceTransfer: after OTP identity check, move the session to this device
// ─────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    const deviceId = String(req.body.deviceId || '').trim();
    const forceTransfer = Boolean(req.body.forceTransfer);

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'Valid device ID is required' });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'OTP must be a 6-digit number' });
    }

    const verifyLimit = checkVerifyRateLimit(email);
    if (!verifyLimit.allowed) {
      return res.status(429).json({ error: verifyLimit.error });
    }

    const record = await OTP.findOne({
      email,
      otp,
      used: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!record) {
      recordVerifyAttempt(email, false);
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    let user = await User.findOne({ email });
    if (!user) {
      const publicId = await generateUniquePublicId();
      // Do not set googleUid — sparse unique index rejects multiple nulls
      user = await User.create({
        email,
        isVerified: true,
        publicId,
        authProvider: 'email',
      });
    } else if (!user.isVerified) {
      user.isVerified = true;
      await user.save();
    }

    // Check if account is deactivated and restore if within grace period
    const restoreResult = await checkAndRestoreOnLogin(user._id);
    if (restoreResult?.error) {
      return res.status(403).json({
        error: restoreResult.error,
        expired: restoreResult.expired,
      });
    }
    if (restoreResult?.restored) {
      user = restoreResult.user; // Use restored user
    }

    const otherDeviceActive =
      Boolean(user.activeDeviceId) && user.activeDeviceId !== deviceId;

    if (otherDeviceActive && !forceTransfer) {
      // Keep OTP unused so the user can confirm Transfer Device with the same code
      recordVerifyAttempt(email, true);
      return res.status(403).json({
        error: DEVICE_IN_USE_MESSAGE,
        code: 'DEVICE_IN_USE',
      });
    }

    record.used = true;
    await record.save();
    recordVerifyAttempt(email, true);

    await bindDeviceAndRespond(res, user, deviceId, req.app.get('io'));
  } catch (err) {
    console.error('verify-otp error:', err);
    const dup =
      err?.code === 11000 ||
      String(err?.message || '').includes('E11000') ||
      String(err?.message || '').includes('duplicate key');
    if (dup) {
      try {
        const { repairGoogleUidIndex } = require('../utils/repairGoogleUidIndex');
        await repairGoogleUidIndex();
        // Retry create once after clearing null googleUid duplicates
        const email = normalizeEmail(req.body.email);
        const deviceId = String(req.body.deviceId || '').trim();
        let user = await User.findOne({ email });
        if (!user) {
          const publicId = await generateUniquePublicId();
          user = await User.create({
            email,
            isVerified: true,
            publicId,
            authProvider: 'email',
          });
        }
        const otp = String(req.body.otp || '').trim();
        const record = await OTP.findOne({
          email,
          otp,
          used: false,
          expiresAt: { $gt: new Date() },
        }).sort({ createdAt: -1 });
        if (record) {
          record.used = true;
          await record.save();
        }
        recordVerifyAttempt(email, true);
        return await bindDeviceAndRespond(res, user, deviceId, req.app.get('io'));
      } catch (retryErr) {
        console.error('verify-otp retry error:', retryErr);
      }
    }
    res.status(500).json({ error: 'Server error during verification' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/transfer-device
// OTP-verified force bind to a new device (reinstall / new phone)
// Body: { email, otp, deviceId }
// ─────────────────────────────────────────────
router.post('/transfer-device', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    const deviceId = String(req.body.deviceId || '').trim();

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }
    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'Valid device ID is required' });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'OTP must be a 6-digit number' });
    }

    const verifyLimit = checkVerifyRateLimit(email);
    if (!verifyLimit.allowed) {
      return res.status(429).json({ error: verifyLimit.error });
    }

    const record = await OTP.findOne({
      email,
      otp,
      used: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!record) {
      recordVerifyAttempt(email, false);
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    record.used = true;
    await record.save();
    recordVerifyAttempt(email, true);

    let user = await User.findOne({ email });
    if (!user) {
      const publicId = await generateUniquePublicId();
      user = await User.create({
        email,
        isVerified: true,
        publicId,
        authProvider: 'email',
      });
    }

    // Check if account is deactivated and restore if within grace period
    const restoreResult = await checkAndRestoreOnLogin(user._id);
    if (restoreResult?.error) {
      return res.status(403).json({
        error: restoreResult.error,
        expired: restoreResult.expired,
      });
    }
    if (restoreResult?.restored) {
      user = restoreResult.user; // Use restored user
    }

    // Clears any previous device binding and binds this installation
    await bindDeviceAndRespond(res, user, deviceId, req.app.get('io'));
  } catch (err) {
    console.error('transfer-device error:', err);
    res.status(500).json({ error: 'Server error during device transfer' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/logout
// Clears active device so another device can sign in
// ─────────────────────────────────────────────
router.post('/logout', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only the currently bound device may clear the session via logout
    if (user.activeDeviceId && req.deviceId && user.activeDeviceId !== req.deviceId) {
      return res.status(401).json({
        error: 'Session invalidated. Please log in again.',
        code: 'DEVICE_MISMATCH',
      });
    }

    user.activeDeviceId = null;
    user.activeDeviceBoundAt = null;
    user.isOnline = false;
    user.lastSeen = new Date();
    await user.save();

    // Stop pushing to a device that is no longer signed in
    try {
      const { removeTokensForDevice } = require('../services/deviceTokens');
      if (req.deviceId) await removeTokensForDevice(req.deviceId);
    } catch {
      /* logout must succeed regardless */
    }

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('logout error:', err);
    res.status(500).json({ error: 'Server error during logout' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/delete-account
// Schedules account deletion with 7-day grace period
// ─────────────────────────────────────────────
router.post('/delete-account', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already scheduled
    if (user.deletionScheduledAt && !user.isDeactivated) {
      return res.status(400).json({
        error: 'Account deletion already scheduled',
        scheduledAt: user.deletionScheduledAt,
      });
    }

    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + 7);

    user.deletionScheduledAt = deletionDate;
    user.deletionReason = req.body.reason || null;
    user.isDeactivated = true;
    user.isOnline = false;
    user.lastSeen = new Date();
    await user.save();

    // Send deactivation email
    try {
      await sendOTPEmail(
        user.email,
        null,
        `Account Deletion Scheduled`,
        `Hi ${user.name || 'there'},\n\nYour Luvstor account has been deactivated and is scheduled for permanent deletion on ${deletionDate.toLocaleDateString()}.\n\nYou have a 7-day grace period to restore your account by simply logging in. After 7 days, all your data (profile, matches, chats, photos) will be permanently deleted.\n\nIf you change your mind, just log in anytime within the next 7 days to restore your account.\n\nBest regards,\nLuvstor Team`
      );
    } catch (emailErr) {
      console.error('Failed to send deletion email:', emailErr);
    }

    try {
      const { createNotification } = require('../services/notifications');
      await createNotification(req.app.get('io'), {
        userId: req.userId,
        type: 'system',
        title: 'Account deactivation started',
        body: 'Your account is hidden. You have 7 days to restore it by logging in.',
        data: { screen: 'settings', code: 'ACCOUNT_DEACTIVATED' },
      });
    } catch {
      /* ignore */
    }

    res.json({
      success: true,
      message: 'Account deactivated. You have 7 days to restore it by logging in.',
      deletionScheduledAt: deletionDate,
    });
  } catch (err) {
    console.error('delete-account error:', err);
    res.status(500).json({ error: 'Server error during account deletion' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/restore-account
// Restores a deactivated account within grace period
// ─────────────────────────────────────────────
router.post('/restore-account', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.isDeactivated) {
      return res.status(400).json({ error: 'Account is not deactivated' });
    }

    // Check if grace period has expired
    if (user.deletionScheduledAt && new Date() >= user.deletionScheduledAt) {
      return res.status(400).json({
        error: 'Grace period has expired. Account cannot be restored.',
      });
    }

    user.isDeactivated = false;
    user.deletionScheduledAt = null;
    user.deletionReason = null;
    user.reminderSentAt = null;
    await user.save();

    // Send restoration email
    try {
      await sendOTPEmail(
        user.email,
        null,
        `Account Restored`,
        `Hi ${user.name || 'there'},\n\nWelcome back! Your Luvstor account has been successfully restored.\n\nAll your matches, chats, and profile data are intact. You can continue using Luvstor as before.\n\nBest regards,\nLuvstor Team`
      );
    } catch (emailErr) {
      console.error('Failed to send restoration email:', emailErr);
    }

    res.json({
      success: true,
      message: 'Account restored successfully',
      user: serializeUser(user),
    });
  } catch (err) {
    console.error('restore-account error:', err);
    res.status(500).json({ error: 'Server error during account restoration' });
  }
});

module.exports = router;
