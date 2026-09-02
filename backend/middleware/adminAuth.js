const crypto = require('crypto');

/**
 * Guard for endpoints that can push to arbitrary users.
 *
 * Requires the `x-admin-key` header to match ADMIN_API_KEY. Compared in
 * constant time so the key can't be recovered by timing the response.
 * If ADMIN_API_KEY is unset the endpoints are closed rather than open.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;

  if (!expected) {
    return res.status(503).json({
      error: 'Admin API is not configured',
      code: 'ADMIN_KEY_MISSING',
    });
  }

  const provided = req.headers['x-admin-key'];
  if (!provided || !safeEqual(provided, expected)) {
    return res.status(403).json({ error: 'Forbidden', code: 'ADMIN_FORBIDDEN' });
  }

  req.isAdmin = true;
  next();
};
