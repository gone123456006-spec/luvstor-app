const { smtpConfig } = require('../config/smtp');

// In-memory stores (use Redis in production for multi-instance deployments)
const sendCounts = new Map(); // email -> { count, windowStart }
const lastSendAt = new Map(); // email -> timestamp
const verifyAttempts = new Map(); // email -> { count, windowStart }

const HOUR_MS = 60 * 60 * 1000;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function checkResendCooldown(email) {
  const key = normalizeEmail(email);
  const last = lastSendAt.get(key);
  if (!last) return { allowed: true };

  const elapsed = (Date.now() - last) / 1000;
  const cooldown = smtpConfig.resendCooldownSeconds;
  if (elapsed < cooldown) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(cooldown - elapsed),
    };
  }
  return { allowed: true };
}

function recordOtpSent(email) {
  const key = normalizeEmail(email);
  const now = Date.now();
  lastSendAt.set(key, now);

  const entry = sendCounts.get(key) || { count: 0, windowStart: now };
  if (now - entry.windowStart > HOUR_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  sendCounts.set(key, entry);
}

function checkSendRateLimit(email) {
  const key = normalizeEmail(email);
  const cooldown = checkResendCooldown(key);
  if (!cooldown.allowed) return cooldown;

  const entry = sendCounts.get(key);
  if (entry && entry.count >= smtpConfig.maxSendsPerHour) {
    const retryAfterSeconds = Math.ceil(
      (entry.windowStart + HOUR_MS - Date.now()) / 1000
    );
    return {
      allowed: false,
      error: 'Too many OTP requests. Try again later.',
      retryAfterSeconds: Math.max(retryAfterSeconds, 60),
    };
  }
  return { allowed: true };
}

function recordVerifyAttempt(email, success) {
  const key = normalizeEmail(email);
  if (success) {
    verifyAttempts.delete(key);
    return;
  }

  const now = Date.now();
  const entry = verifyAttempts.get(key) || { count: 0, windowStart: now };
  if (now - entry.windowStart > HOUR_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  verifyAttempts.set(key, entry);
}

function checkVerifyRateLimit(email) {
  const key = normalizeEmail(email);
  const entry = verifyAttempts.get(key);
  if (entry && entry.count >= smtpConfig.maxVerifyAttempts) {
    return {
      allowed: false,
      error: 'Too many failed attempts. Request a new code.',
    };
  }
  return { allowed: true };
}

module.exports = {
  normalizeEmail,
  checkResendCooldown,
  checkSendRateLimit,
  recordOtpSent,
  checkVerifyRateLimit,
  recordVerifyAttempt,
};
