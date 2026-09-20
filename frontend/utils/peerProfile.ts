/**
 * Safe peer profile merge for chat list / header / call UI.
 * Keys every field by userId so one user's name/DP never overwrites another's,
 * and empty/null/stale patches never wipe a good value.
 */

import { resolveMediaUrl } from './media';

export type PeerProfileFields = {
  name?: string | null;
  photo?: string | null;
  gender?: string | null;
};

/** True when a photo string is usable (not empty / null / sentinel). */
export function isUsablePhoto(photo?: string | null): boolean {
  const raw = String(photo || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return !(
    lower === 'null' ||
    lower === 'undefined' ||
    lower === 'none' ||
    lower === 'default'
  );
}

/** True when a display name is usable (not empty / placeholder). */
export function isUsableName(name?: string | null): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  const lower = n.toLowerCase();
  return !(
    lower === 'user' ||
    lower === 'someone' ||
    lower === 'unknown' ||
    lower === 'anonymous' ||
    lower === 'luvstor user'
  );
}

export function resolvePeerPhoto(photo?: string | null): string {
  if (!isUsablePhoto(photo)) return '';
  return resolveMediaUrl(String(photo).trim()) || String(photo).trim();
}

/**
 * Merge a patch onto an existing peer row.
 * - Never applies fields when patchUserId does not match existingUserId
 * - Never overwrites a good name/photo with empty/null/placeholder
 * - `clearPhoto: true` is the only way to intentionally blank a DP (privacy / remove)
 */
export function mergePeerProfile(
  existingUserId: string,
  existing: PeerProfileFields,
  patchUserId: string | null | undefined,
  patch: PeerProfileFields & { clearPhoto?: boolean },
): PeerProfileFields {
  const eid = String(existingUserId || '');
  const pid = String(patchUserId || '');
  if (!eid || !pid || eid !== pid) {
    return {
      name: existing.name || '',
      photo: existing.photo || '',
      gender: existing.gender || '',
    };
  }

  const nextName = isUsableName(patch.name)
    ? String(patch.name).trim()
    : isUsableName(existing.name)
      ? String(existing.name).trim()
      : String(existing.name || patch.name || '').trim() || 'User';

  let nextPhoto = existing.photo || '';
  if (patch.clearPhoto) {
    nextPhoto = '';
  } else if (isUsablePhoto(patch.photo)) {
    nextPhoto = resolvePeerPhoto(patch.photo);
  } else if (isUsablePhoto(existing.photo)) {
    nextPhoto = resolvePeerPhoto(existing.photo);
  }

  const nextGender =
    String(patch.gender || '').trim() ||
    String(existing.gender || '').trim() ||
    '';

  return { name: nextName, photo: nextPhoto, gender: nextGender };
}

/** In-memory last-known good peer profiles (survives list remounts in-session). */
const peerById = new Map<string, PeerProfileFields & { at: number }>();

export function rememberPeerProfile(
  userId: string,
  fields: PeerProfileFields,
): PeerProfileFields {
  const id = String(userId || '');
  if (!id) return { name: 'User', photo: '', gender: '' };
  const prev = peerById.get(id);
  const merged = mergePeerProfile(id, prev || {}, id, fields);
  peerById.set(id, { ...merged, at: Date.now() });
  return merged;
}

export function getRememberedPeerProfile(
  userId: string,
): PeerProfileFields | null {
  const id = String(userId || '');
  if (!id) return null;
  const hit = peerById.get(id);
  if (!hit) return null;
  return { name: hit.name, photo: hit.photo, gender: hit.gender };
}

export function clearPeerProfileMemory() {
  peerById.clear();
}
