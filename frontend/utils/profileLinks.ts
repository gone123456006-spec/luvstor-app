import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { getAuthToken, isValidPublicId } from './auth';
import { getApiBase } from './api';

/** Custom app scheme (app.json → scheme) */
export const APP_SCHEME = 'luvstor';

/**
 * HTTPS base for shareable profile links (branded OneLink-style).
 * Prefer EXPO_PUBLIC_SHARE_BASE_URL; never prefer raw API host for sharing.
 */
export function getProfileLinkBase(): string {
  const share = (process.env.EXPO_PUBLIC_SHARE_BASE_URL || '').trim();
  if (share) return share.replace(/\/$/, '');
  // Working default: same host as API (share path /go/:slug)
  return getApiBase().replace(/\/$/, '');
}

export function getOnelinkTemplatePath(): string {
  return (
    (process.env.EXPO_PUBLIC_ONELINK_TEMPLATE_PATH || 'go')
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase() || 'go'
  );
}

/** Normalize ABCD1234 */
export function normalizePublicId(raw?: string | null): string | null {
  const id = String(raw || '')
    .trim()
    .toUpperCase();
  return isValidPublicId(id) ? id : null;
}

/**
 * Fallback before API returns slug — prefer /go/ style once slug is known from API.
 */
export function buildProfileHttpsUrl(publicId: string): string | null {
  const id = normalizePublicId(publicId);
  if (!id) return null;
  // Legacy-compatible path until branded slug is fetched
  return `${getProfileLinkBase()}/u/${id}`;
}

/**
 * Fetch backend-generated OneLink-style URL:
 * https://luvstor-one.onelink.me/luvstor/{slug}
 */
export async function fetchBrandedProfileShareUrl(
  publicId: string,
): Promise<string | null> {
  const id = normalizePublicId(publicId);
  if (!id) return null;
  try {
    const token = await getAuthToken();
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const path =
      token
        ? // Prefer “me” when sharing own profile (same publicId often)
          `/api/share/profile/${id}`
        : `/api/share/profile/${id}`;

    const res = await fetch(`${getApiBase()}${path}`, { headers });
    if (!res.ok) return buildProfileHttpsUrl(id);
    const data = await res.json();
    return String(data.shareUrl || '').trim() || buildProfileHttpsUrl(id);
  } catch {
    return buildProfileHttpsUrl(id);
  }
}

/**
 * Native deep link used by the bounce page / installed app.
 * Example: luvstor://u/ABCD1234
 */
export function buildProfileAppUrl(publicId: string): string | null {
  const id = normalizePublicId(publicId);
  if (!id) return null;
  // Triple-slash so path is /u/ID (Expo Router + Android intent filters)
  return `${APP_SCHEME}:///u/${id}`;
}

/** Prefer https for sharing (works in WhatsApp/SMS); app URL as fallback. */
export function buildProfileShareUrl(publicId: string): string | null {
  return buildProfileHttpsUrl(publicId) || buildProfileAppUrl(publicId);
}

export async function buildProfileShareMessageAsync(
  name: string,
  publicId: string,
): Promise<string> {
  const id = normalizePublicId(publicId) || String(publicId || '').toUpperCase();
  const who = (name || '').trim() || 'this profile';
  const link =
    (await fetchBrandedProfileShareUrl(id)) || buildProfileShareUrl(id);
  const lines = [`Meet ${who} on Luvstor 💜`, `ID: ${id}`];
  if (link) {
    lines.push('', link);
    lines.push('', 'Tap the link to open their profile in Luvstor.');
  } else {
    lines.push(
      '',
      'Open Luvstor → Discover → search this ID to find them.',
    );
  }
  return lines.join('\n');
}

export function buildProfileShareMessage(name: string, publicId: string): string {
  const id = normalizePublicId(publicId) || String(publicId || '').toUpperCase();
  const who = (name || '').trim() || 'this profile';
  const link = buildProfileShareUrl(id);
  const lines = [
    `Meet ${who} on Luvstor 💜`,
    `ID: ${id}`,
  ];
  if (link) {
    lines.push('', link);
    lines.push('', 'Tap the link to open their profile in Luvstor.');
  } else {
    lines.push(
      '',
      'Open Luvstor → Discover → search this ID to find them.',
    );
  }
  return lines.join('\n');
}

/**
 * Extract publicId from:
 * - luvstor://u/ABCD1234
 * - https://host/u/ABCD1234
 * - /u/ABCD1234
 * - bare ABCD1234
 */
export function parseProfilePublicIdFromUrl(url: string): string | null {
  if (!url) return null;
  const raw = String(url).trim();

  // Bare ID
  const bare = normalizePublicId(raw);
  if (bare) return bare;

  try {
    // Linking.parse handles custom schemes
    const parsed = Linking.parse(raw);
    const path = String(parsed.path || '')
      .replace(/^\//, '')
      .replace(/\/$/, '');
    const parts = path.split('/').filter(Boolean);
    // u/ABCD1234 or profile/ABCD1234
    if (
      parts.length >= 2 &&
      (parts[0] === 'u' || parts[0] === 'profile')
    ) {
      return normalizePublicId(parts[1]);
    }
    // luvstor://u/ABCD1234 → host=u, path=ABCD1234
    if (
      (parsed.hostname === 'u' || parsed.hostname === 'profile') &&
      parts[0]
    ) {
      return normalizePublicId(parts[0]);
    }
    // query ?publicId= or ?id=
    const q =
      (parsed.queryParams?.publicId as string) ||
      (parsed.queryParams?.id as string) ||
      '';
    const fromQuery = normalizePublicId(q);
    if (fromQuery) return fromQuery;
  } catch {
    /* fall through */
  }

  // Regex fallback for https://…/u/ABCD1234
  const m = raw.match(/\/(?:u|profile)\/([A-Za-z]{4}\d{4})\b/i);
  if (m) return normalizePublicId(m[1]);

  return null;
}

export function shareOptsForPlatform(message: string, title: string) {
  if (Platform.OS === 'ios') {
    return { message };
  }
  return { message, title };
}
