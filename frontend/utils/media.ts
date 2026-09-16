import { getApiBase } from './api';

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

/** Turn relative /uploads/... or wrong-host absolute URLs into a loadable API URL */
export function resolveMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  if (
    url.startsWith('file://') ||
    url.startsWith('content://') ||
    url.startsWith('data:')
  ) {
    return url;
  }
  const base = getApiBase();
  if (url.startsWith('/')) {
    return `${base}${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${base}${parsed.pathname}`;
    }
  } catch {
    /* ignore */
  }
  return upgradeRemotePhotoUrl(url);
}
