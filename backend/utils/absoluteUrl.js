/**
 * FCM / APNs require absolute https URLs for notification images.
 * Profile photos are stored as `/uploads/...` — expand them for push.
 */
const PRODUCTION_API_FALLBACK = 'https://luvstor-api.onrender.com';

function publicApiBase() {
  const fromEnv = String(
    process.env.PUBLIC_API_URL ||
      process.env.EXPO_PUBLIC_API_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      '',
  )
    .trim()
    .replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  // Local/dev without PUBLIC_API_URL still needs a reachable host for FCM images
  if (process.env.NODE_ENV === 'production') return PRODUCTION_API_FALLBACK;
  return PRODUCTION_API_FALLBACK;
}

function absoluteMediaUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;

  const base = publicApiBase();
  if (!base) return '';

  if (raw.startsWith('/')) return `${base}${raw}`;
  return `${base}/${raw}`;
}

module.exports = { publicApiBase, absoluteMediaUrl, PRODUCTION_API_FALLBACK };
