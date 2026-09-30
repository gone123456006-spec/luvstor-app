const jwt = require('jsonwebtoken');

const TOKEN_TTL = '30d';
/** Active sessions get a fresh token once the current one is this old. */
const RENEW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function issueToken(userId, deviceId) {
  return jwt.sign({ userId, deviceId }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/** A renewed token when `decoded` (a verified payload) is due, else null. */
function renewedTokenFor(decoded, now = Date.now()) {
  const issuedAtMs = Number(decoded?.iat) * 1000;
  if (!Number.isFinite(issuedAtMs) || now - issuedAtMs < RENEW_AFTER_MS) return null;
  return issueToken(decoded.userId, decoded.deviceId);
}

module.exports = { issueToken, renewedTokenFor, RENEW_AFTER_MS };
