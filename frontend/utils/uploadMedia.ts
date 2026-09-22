/**
 * Durable image upload — stores bytes in MongoDB via the API and returns
 * `/api/media/{id}` (or legacy `/uploads/...`) that works after reinstall.
 */
import {
  fetchWithTimeout,
  getApiBase,
  UPLOAD_FETCH_TIMEOUT_MS,
} from './api';
import { PRODUCTION_MEDIA_BASE, durableMediaPathFromUrl } from './media';

async function readAsDataUri(localUri: string): Promise<string> {
  const FileSystem = await import('expo-file-system/legacy');
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const ext =
    localUri.split('.').pop()?.toLowerCase()?.split('?')[0] || 'jpg';
  const mime =
    ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

async function postImage(
  apiBase: string,
  token: string,
  dataUri: string,
): Promise<string | null> {
  const res = await fetchWithTimeout(
    `${apiBase.replace(/\/$/, '')}/api/upload/image`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ base64: dataUri }),
    },
    UPLOAD_FETCH_TIMEOUT_MS,
  );
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(json?.error || `Upload failed (${res.status})`);
  }
  return (
    durableMediaPathFromUrl(json?.url) ||
    durableMediaPathFromUrl(json?.absoluteUrl) ||
    null
  );
}

/** Confirm the file is reachable from at least one durable public host. */
async function verifyUploadReachable(relPath: string): Promise<boolean> {
  const bases = [
    getApiBase(),
    PRODUCTION_MEDIA_BASE,
    process.env.EXPO_PUBLIC_MEDIA_BASE_URL?.trim().replace(/\/$/, ''),
  ].filter(Boolean) as string[];

  const seen = new Set<string>();
  for (const base of bases) {
    const url = `${base.replace(/\/$/, '')}${relPath}`;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetchWithTimeout(url, { method: 'GET' }, 8_000);
      if (res.ok || res.status === 304) return true;
    } catch {
      /* try next host */
    }
  }
  return false;
}

/**
 * Upload a local device image → MongoDB via API → `/api/media/{id}`.
 */
export async function uploadImageDurable(
  localUri: string,
  token: string,
): Promise<string | null> {
  const uri = String(localUri || '').trim();
  if (!uri) return null;

  if (
    !uri.startsWith('file://') &&
    !uri.startsWith('content://') &&
    !uri.startsWith('ph://') &&
    !uri.startsWith('assets-library://')
  ) {
    const existing = durableMediaPathFromUrl(uri);
    if (existing) return existing;
    if (/^https?:\/\//i.test(uri)) return uri;
    return null;
  }

  const dataUri = await readAsDataUri(uri);
  const primaryBase = getApiBase();
  const path = await postImage(primaryBase, token, dataUri);
  if (!path) return null;

  // Best-effort reachability check (same Atlas DB → any API host can serve it)
  await verifyUploadReachable(path).catch(() => false);
  return path;
}
