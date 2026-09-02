const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

/**
 * Rate limiters for the notification surface.
 * Keyed by user id when authenticated so one abusive account can't exhaust
 * the quota for everyone behind the same NAT/IP. Falls back to the library's
 * IP helper, which normalises IPv6 into /64 subnets.
 */
const keyByUser = (req, res) => req.userId || ipKeyGenerator(req, res);

const jsonLimitHandler = (message) => (req, res) =>
  res.status(429).json({ error: message, code: 'RATE_LIMITED' });

/** Read-heavy endpoints (list, unread count) — generous. */
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  handler: jsonLimitHandler('Too many requests. Please slow down.'),
});

/** Mutations (mark read, delete, register token). */
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  handler: jsonLimitHandler('Too many requests. Please slow down.'),
});

/** Actually sending pushes — tight, and admin-only anyway. */
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  handler: jsonLimitHandler('Notification send limit reached. Try again shortly.'),
});

/** Broadcasts — very tight, they hit every user. */
const broadcastLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  handler: jsonLimitHandler('Broadcast limit reached. Try again later.'),
});

module.exports = {
  readLimiter,
  writeLimiter,
  sendLimiter,
  broadcastLimiter,
};
