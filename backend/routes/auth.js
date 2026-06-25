const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OTP = require('../models/OTP');
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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─────────────────────────────────────────────
// GET /api/auth/smtp-status
// Check SMTP configuration (no secrets exposed)
// ─────────────────────────────────────────────
router.get('/smtp-status', (req, res) => {
  res.json({ success: true, smtp: getSmtpStatus() });
});

// ─────────────────────────────────────────────
// POST /api/auth/send-otp
// Send a 6-digit OTP to the given email via SMTP
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
      err.code === 'EAUTH'
        ? 'SMTP authentication failed. Use a Gmail App Password (not your regular password).'
        : err.code === 'ESOCKET' || err.code === 'ECONNECTION'
          ? `Cannot reach SMTP server at ${smtpConfig.host}:${smtpConfig.port}`
          : 'Failed to send verification email. Check SMTP settings in backend/.env';

    res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/verify-otp
// Verify the OTP and return a JWT token
// ─────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
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
      user = await User.create({ email, isVerified: true });
    } else {
      user.isVerified = true;
      await user.save();
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });

    res.json({
      success: true,
      token,
      user: serializeUser(user),
    });
  } catch (err) {
    console.error('verify-otp error:', err);
    res.status(500).json({ error: 'Server error during verification' });
  }
});

module.exports = router;
