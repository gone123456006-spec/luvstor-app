import { API_BASE } from './api';

/** Turn relative /uploads/... or wrong-host absolute URLs into a loadable API_BASE URL */
export function resolveMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  if (
    url.startsWith('file://') ||
    url.startsWith('content://') ||
    url.startsWith('data:')
  ) {
    return url;
  }
  if (url.startsWith('/')) {
    return `${API_BASE}${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${API_BASE}${parsed.pathname}`;
    }
  } catch {
    /* ignore */
  }
  return url;
}
