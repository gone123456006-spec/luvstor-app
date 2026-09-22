import { getApiBase } from './api';

/** Where production profile / post / cover files are hosted */
export const PRODUCTION_MEDIA_BASE = 'https://luvstor-api.onrender.com';

/**
 * Optional CDN / production origin for app media when the API host
 * differs from where files actually live.
 */
function getMediaBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_MEDIA_BASE_URL?.trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return getApiBase();
}

const MEDIA_API_RE = /^\/api\/media\/[a-fA-F0-9]{24}/i;

/**
 * Stable identity for a media item, independent of which host/query string
 * it currently resolves through.
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
  const path = durableMediaPathFromUrl(trimmed);
  if (path) return path;
  return trimmed.split('?')[0];
}

/**
 * Extract durable relative media path:
 * - `/api/media/{ObjectId}` (MongoDB binary — preferred)
 * - `/uploads/...` (legacy disk)
 */
export function durableMediaPathFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = String(url).trim().split('?')[0].split('#')[0];
  if (!trimmed) return null;

  if (MEDIA_API_RE.test(trimmed)) {
    const m = trimmed.match(/^(\/api\/media\/[a-fA-F0-9]{24})/i);
    return m ? m[1] : trimmed;
  }
  if (trimmed.startsWith('/uploads/')) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (MEDIA_API_RE.test(parsed.pathname)) {
      const m = parsed.pathname.match(/^(\/api\/media\/[a-fA-F0-9]{24})/i);
      return m ? m[1] : parsed.pathname;
    }
    if (parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
  } catch {
    /* ignore */
  }
  return null;
}

/** @deprecated use durableMediaPathFromUrl — kept for call sites */
export function uploadsPathFromUrl(url?: string | null): string | null {
  return durableMediaPathFromUrl(url);
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

function isAppMediaPath(pathname: string): boolean {
  return (
    pathname.startsWith('/uploads/') ||
    MEDIA_API_RE.test(pathname) ||
    pathname.startsWith('/api/media/')
  );
}

/**
 * Turn relative `/api/media/...` or `/uploads/...` (or stale absolutes)
 * into a loadable URL on the current API/media host.
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
  const durable = durableMediaPathFromUrl(trimmed);
  if (durable) {
    return `${mediaBase}${durable}`;
  }

  if (trimmed.startsWith('/')) {
    return `${mediaBase}${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (isAppMediaPath(parsed.pathname)) {
      return `${mediaBase}${parsed.pathname}${parsed.search || ''}`;
    }
  } catch {
    /* ignore */
  }

  return upgradeRemotePhotoUrl(trimmed);
}

/**
 * Ordered list of URLs to try for reliability across hosts.
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

  const path = durableMediaPathFromUrl(trimmed);
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
