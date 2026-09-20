import { getApiBase } from './api';

/** Where production profile / post / cover files are hosted */
export const PRODUCTION_MEDIA_BASE = 'https://luvstor-api.onrender.com';

/**
 * Optional CDN / production origin for `/uploads/...` when the API host
 * differs from where files actually live (common in local-dev + Atlas).
 *
 * Default: same host as the API (so a photo you just uploaded locally
 * actually loads). `mediaUrlCandidates` still tries production as failover
 * when Mongo still points at Render-hosted files.
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
 * Stable identity for a media item, independent of which host/query string
 * it currently resolves through. Use this (not the resolved URL) as a React
 * `key` / expo-image `recyclingKey` — otherwise a profile refresh that
 * re-resolves the *same* photo through a slightly different absolute URL
 * (different host, added query, etc.) forces a hard remount and the image
 * flashes blank for a frame — the "blink" WhatsApp/Instagram never show.
 */
export function mediaIdentity(url?: string | null): string {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('content://') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }
  const path = uploadsPathFromUrl(trimmed);
  if (path) return path;
  return trimmed.split('?')[0];
}

/** Extract `/uploads/...` path from relative or absolute URL. */
export function uploadsPathFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = String(url).trim().split('?')[0];
  if (!trimmed) return null;
  if (trimmed.startsWith('/uploads/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
  } catch {
    /* ignore */
  }
  return null;
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
      // Keep Render / CDN / other remote absolute URLs intact
      if (!isLocalOrEmulatorHost(parsed.hostname)) {
        return trimmed;
      }
      // Stale localhost / emulator / old LAN host → current media origin
      return `${mediaBase}${parsed.pathname}${parsed.search || ''}`;
    }
  } catch {
    /* ignore */
  }

  return upgradeRemotePhotoUrl(trimmed);
}

/**
 * Ordered list of URLs to try for Instagram/WhatsApp-style reliability.
 * Primary resolve first, then production + local API for `/uploads` paths.
 */
export function mediaUrlCandidates(url?: string | null): string[] {
  if (!url) return [];
  const trimmed = String(url).trim();
  if (!trimmed) return [];

  if (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('content://') ||
    trimmed.startsWith('data:')
  ) {
    return [trimmed];
  }

  const out: string[] = [];
  const push = (u?: string | null) => {
    const v = String(u || '').trim();
    if (!v) return;
    if (!out.includes(v)) out.push(v);
  };

  push(resolveMediaUrl(trimmed));

  const path = uploadsPathFromUrl(trimmed);
  if (path) {
    push(`${PRODUCTION_MEDIA_BASE}${path}`);
    try {
      const api = getApiBase();
      push(`${api}${path}`);
    } catch {
      /* ignore */
    }
    const envBase = process.env.EXPO_PUBLIC_MEDIA_BASE_URL?.trim().replace(/\/$/, '');
    if (envBase) push(`${envBase}${path}`);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    push(trimmed);
    push(upgradeRemotePhotoUrl(trimmed));
  }

  return out;
}
