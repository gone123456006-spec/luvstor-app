/**
 * Signed links for private (chat) media: /api/media/{id}?e={expiry}&s={sig}
 *
 * Expiry is snapped to a fixed window so the same photo keeps the same URL for
 * a while — phones can keep it in their image cache instead of re-downloading.
 *
 * MEDIA_URL_SECRET       HMAC key (falls back to JWT_SECRET)
 * MEDIA_URL_TTL_HOURS    window length (default 72); links stay valid 1–2 windows
 * MEDIA_PRIVATE_ENFORCE  off | log | on   (default log)
 *   off — private media served to anyone (old behaviour)
 *   log — served, but unsigned requests are counted and logged
 *   on  — unsigned / expired requests get 403
 */
const crypto = require('crypto');

const MEDIA_ID_RE = /^\/api\/media\/([a-fA-F0-9]{24})(?:\.[a-z0-9]+)?$/i;

function secret() {
  return process.env.MEDIA_URL_SECRET || process.env.JWT_SECRET || '';
}

function windowMs() {
  const hours = Number(process.env.MEDIA_URL_TTL_HOURS) || 72;
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function enforceMode() {
  const v = String(process.env.MEDIA_PRIVATE_ENFORCE || 'log').toLowerCase();
  return v === 'on' || v === 'off' ? v : 'log';
}

function sign(id, exp) {
  return crypto
    .createHmac('sha256', secret())
    .update(`${String(id).toLowerCase()}.${exp}`)
    .digest('base64url')
    .slice(0, 32);
}

/** Expiry (unix seconds) for links issued now */
function currentExpiry(now = Date.now()) {
  const w = windowMs();
  return Math.floor((Math.floor(now / w) + 2) * w / 1000);
}

/**
 * Add a signature to a stored `/api/media/{id}` path. Anything else
 * (null, legacy `/uploads/…`, external https) is returned unchanged.
 */
function signMediaUrl(url, now = Date.now()) {
  if (!url || typeof url !== 'string' || !secret()) return url;
  const path = url.split('?')[0].split('#')[0];
  const m = path.match(MEDIA_ID_RE);
  if (!m) return url;
  const exp = currentExpiry(now);
  return `${path}?e=${exp}&s=${sign(m[1], exp)}`;
}

/** True when `e`/`s` query params are a valid, unexpired signature for id */
function verifyMediaSignature(id, e, s, now = Date.now()) {
  if (!id || !e || !s || !secret()) return false;
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = sign(id, exp);
  const a = Buffer.from(String(s));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Sign mediaUrl on a message-like object (and its reply quote) for the wire */
function signMessageMedia(msg, now = Date.now()) {
  if (!msg || typeof msg !== 'object') return msg;
  let out = msg;
  if (msg.mediaUrl) out = { ...out, mediaUrl: signMediaUrl(msg.mediaUrl, now) };
  if (msg.replyTo && typeof msg.replyTo === 'object' && msg.replyTo.mediaUrl) {
    out = { ...out, replyTo: { ...msg.replyTo, mediaUrl: signMediaUrl(msg.replyTo.mediaUrl, now) } };
  }
  return out;
}

module.exports = {
  signMediaUrl,
  verifyMediaSignature,
  signMessageMedia,
  currentExpiry,
  enforceMode,
};
