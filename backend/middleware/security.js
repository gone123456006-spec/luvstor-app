/**
 * App-wide HTTP hardening: security headers, NoSQL-operator stripping and a
 * generous API rate limit. Route-specific limits (OTP, notifications, admin)
 * still apply on top of this.
 */
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const isProd = process.env.NODE_ENV === 'production';

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // JSON / media API never renders HTML; share pages (/u, /r, /go) keep their own markup
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }
  next();
}

/** Drop `$`-prefixed keys so `{ "email": { "$ne": null } }` can't reach a Mongo filter */
function stripOperators(value, depth = 0) {
  if (depth > 20 || !value || typeof value !== 'object' || Buffer.isBuffer(value)) return;
  if (Array.isArray(value)) {
    value.forEach((v) => stripOperators(v, depth + 1));
    return;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith('$')) delete value[key];
    else stripOperators(value[key], depth + 1);
  }
}

function sanitizeInput(req, _res, next) {
  if (req.body && typeof req.body === 'object') stripOperators(req.body);
  if (req.params && typeof req.params === 'object') stripOperators(req.params);
  next();
}

/** Signed-in callers are limited per account (NAT-safe); others per IP */
function rateKey(req, res) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ') && process.env.JWT_SECRET) {
    try {
      const { userId } = jwt.verify(header.slice(7), process.env.JWT_SECRET, {
        algorithms: ['HS256'],
      });
      if (userId) return `u:${userId}`;
    } catch {
      /* fall through to IP */
    }
  }
  return `ip:${ipKeyGenerator(req.ip || '')}`;
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Math.max(60, Number(process.env.API_RATE_LIMIT_PER_MIN) || 600),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: rateKey,
  // Images are cached and requested in bursts by every list screen
  skip: (req) => req.method === 'OPTIONS' || req.path.startsWith('/media/'),
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' }),
});

module.exports = { securityHeaders, sanitizeInput, apiLimiter, stripOperators };
