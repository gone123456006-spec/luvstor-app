import { getApiBase } from './api';

/**
 * Optional CDN / production origin for `/uploads/...` when the API host
 * differs from where files actually live (common in local-dev + Atlas).
 */
function getMediaBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_MEDIA_BASE_URL?.trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return getApiBase();
}

function isLocalOrEmulatorHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '10.0.2.2' || h === '0.0.0.0') {
    return true;
  }
  // Private LAN ranges used by Expo / Metro
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/**
 * Google / Firebase profile pics often ship as tiny thumbs (s96-c).
 * Bump to a high-res variant so DP looks sharp when viewed full-size.
 */
export function upgradeRemotePhotoUrl(url: string): string {
  if (!url) return url;
  try {
    if (/googleusercontent\.com/i.test(url)) {
      let next = url
        .replace(/=s\d+-c\b/gi, '=s1024-c')
        .replace(/=s\d+\b/gi, '=s1024')
        .replace(/=w\d+-h\d+(-[a-z]+)?\b/gi, '=s1024');
      if (next === url && !/[=&]s=\d+/i.test(url) && !/=s\d+/i.test(url)) {
        next = url.includes('?') ? `${url}&sz=1024` : `${url}?sz=1024`;
      }
      return next;
    }
  } catch {
    /* keep original */
  }
  return url;
}

/**
 * Turn relative `/uploads/...` or stale LAN absolute URLs into a loadable URL.
 * Never rewrite production / CDN hosts onto the local API (that blanked DPs,
 * covers, and post images when local `uploads/` was empty).
 */
export function resolveMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('content://') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  const mediaBase = getMediaBase();

  if (trimmed.startsWith('/')) {
    return `${mediaBase}${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.startsWith('/uploads/')) {
      const baseHost = new URL(mediaBase).hostname;
      const sameHost = parsed.hostname === baseHost;
      // Only remap stale local/emulator hosts (or same host, wrong port)
      if (sameHost || isLocalOrEmulatorHost(parsed.hostname)) {
        return `${mediaBase}${parsed.pathname}${parsed.search || ''}`;
      }
      // Keep Render / CDN / other remote absolute URLs intact
      return trimmed;
    }
  } catch {
    /* ignore */
  }

  return upgradeRemotePhotoUrl(trimmed);
}
