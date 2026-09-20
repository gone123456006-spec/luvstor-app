/**
 * Persistent media URLs for profile / posts / chat.
 * Device URIs (file://, content://) and LAN/localhost absolutes must never
 * be the source of truth in Mongo — they break after logout / reinstall.
 */

const DEVICE_URI_RE = /^(file:|content:|data:|ph:|assets-library:|blob:)/i;
const UPLOADS_PATH_RE = /^\/uploads\/[A-Za-z0-9_\-./]+$/;

function isPrivateOrLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '10.0.2.2' ||
    h === '::1'
  ) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function isDeviceLocalUri(url) {
  return DEVICE_URI_RE.test(String(url || '').trim());
}

/**
 * Normalize any client/server media string to a durable form:
 * - `/uploads/...` relative path (preferred for app uploads)
 * - remote https:// URL (Google / CDN)
 * - '' when empty or not persistable (file://, broken, etc.)
 *
 * Never returns file:// / content:// / localhost absolutes.
 */
function toPersistentMediaUrl(url) {
  if (url == null) return '';
  const raw = String(url).trim();
  if (!raw) return '';
  if (isDeviceLocalUri(raw)) return '';

  const noQuery = raw.split('?')[0].split('#')[0];

  if (UPLOADS_PATH_RE.test(noQuery) || noQuery.startsWith('/uploads/')) {
    // Collapse accidental double slashes but keep `/uploads/...`
    return noQuery.replace(/\/{2,}/g, '/').replace(/^([^/])/, '/$1');
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.pathname.startsWith('/uploads/')) {
        // LAN / localhost absolute → store relative so any API host can serve it
        if (isPrivateOrLocalHost(parsed.hostname)) {
          return parsed.pathname;
        }
        // Public host absolute for /uploads — still prefer relative path
        // so MEDIA_BASE / API host changes don't break images
        return parsed.pathname;
      }
      // External avatar (Google, etc.)
      return raw;
    } catch {
      return '';
    }
  }

  // Reject bare tokens / garbage
  return '';
}

/** True when value is safe to store as the permanent media reference. */
function isPersistentMediaUrl(url) {
  const v = toPersistentMediaUrl(url);
  return !!v;
}

/**
 * For profile updates:
 * - undefined → leave field alone (caller omits)
 * - '' → explicit clear
 * - invalid device URI → treat as omit (return undefined) so we don't wipe a good URL
 * - valid → normalized persistent URL
 */
function sanitizeProfileMediaUpdate(value) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (isDeviceLocalUri(raw)) return undefined; // do not overwrite
  const normalized = toPersistentMediaUrl(raw);
  return normalized || undefined;
}

function sanitizePhotosArray(list, max = 6) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const n = toPersistentMediaUrl(item);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

module.exports = {
  isDeviceLocalUri,
  isPrivateOrLocalHost,
  toPersistentMediaUrl,
  isPersistentMediaUrl,
  sanitizeProfileMediaUpdate,
  sanitizePhotosArray,
};
