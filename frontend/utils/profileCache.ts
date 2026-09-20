import { apiRequest } from './api';
import {
  AuthUser,
  getAuthToken,
  getCurrentAuthUser,
  getLocalProfile,
  isValidPublicId,
  saveLocalProfile,
  StoredProfile,
} from './auth';
import { resolveMediaUrl } from './media';

function toAbsolute(url?: string | null) {
  if (!url) return '';
  return resolveMediaUrl(url) || url;
}

/** Persist uploads as relative paths so host/port changes don't break media. */
function toStoredMediaPath(url?: string | null): string {
  if (!url) return '';
  const clean = String(url).trim().split('?')[0];
  if (!clean) return '';
  if (
    clean.startsWith('file://') ||
    clean.startsWith('content://') ||
    clean.startsWith('data:')
  ) {
    return clean;
  }
  try {
    const parsed = new URL(clean);
    if (parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
    return clean; // Google / CDN — keep absolute
  } catch {
    /* relative */
  }
  if (clean.startsWith('/uploads/')) return clean;
  return clean;
}

export type ProfileScreenSnapshot = {
  profile: StoredProfile | null;
  gallery: string[];
  coverPhoto: string;
  subscriptionBadge: string | null;
  subscriptionExpiresAt: string | null;
  at: number;
};

let cached: ProfileScreenSnapshot | null = null;
let inflight: Promise<ProfileScreenSnapshot | null> | null = null;

const CACHE_TTL_MS = 60_000;

export function getCachedProfile(): ProfileScreenSnapshot | null {
  if (!cached) return null;
  if (Date.now() - cached.at > CACHE_TTL_MS) return null;
  return cached;
}

export function setCachedProfile(
  snapshot: Omit<ProfileScreenSnapshot, 'at'>,
) {
  cached = { ...snapshot, at: Date.now() };
}

export function updateCachedProfile(
  patch: Partial<Omit<ProfileScreenSnapshot, 'at'>>,
) {
  if (!cached) {
    cached = {
      profile: null,
      gallery: [],
      coverPhoto: '',
      subscriptionBadge: null,
      subscriptionExpiresAt: null,
      at: Date.now(),
      ...patch,
    };
    return;
  }
  cached = { ...cached, ...patch, at: Date.now() };
}

export function clearProfileCache() {
  cached = null;
  inflight = null;
}

async function snapshotFromLocal(
  authUser: AuthUser,
): Promise<ProfileScreenSnapshot | null> {
  const parsed = await getLocalProfile(authUser.email);
  if (!parsed) return null;

  const profile: StoredProfile = { ...parsed };
  if (!profile.userId && authUser.id) {
    profile.userId = authUser.id;
  }
  if (!isValidPublicId(profile.publicId)) {
    profile.publicId = '';
  }
  // Resolve for display — do not bake absolute LAN hosts into storage later
  const displayPhoto = toAbsolute(profile.photo);
  const displayCover = toAbsolute(profile.coverPhoto);
  profile.photo = displayPhoto;
  profile.coverPhoto = displayCover;

  const gallery = Array.isArray(profile.photos)
    ? profile.photos.map(toAbsolute).filter(Boolean)
    : [];

  return {
    profile,
    gallery,
    coverPhoto: displayCover,
    subscriptionBadge: cached?.subscriptionBadge ?? null,
    subscriptionExpiresAt: cached?.subscriptionExpiresAt ?? null,
    at: Date.now(),
  };
}

export async function buildProfileSnapshot(
  authUser: AuthUser,
  authToken: string,
): Promise<ProfileScreenSnapshot> {
  const localSnapshot = await snapshotFromLocal(authUser);
  let profile = localSnapshot?.profile ?? null;
  let gallery = localSnapshot?.gallery ?? [];
  let coverPhoto = localSnapshot?.coverPhoto ?? '';

  if (profile) {
    await saveLocalProfile(authUser.email, profile);
  }

  let subscriptionBadge: string | null = null;
  let subscriptionExpiresAt: string | null = null;

  const me: any = await apiRequest('/api/users/me', authToken);
  if (Array.isArray(me?.photos)) {
    gallery = me.photos.map(toAbsolute).filter(Boolean);
  }

  // Prefer server cover when present; otherwise keep local (avoids wipe races)
  const serverCover = toAbsolute(me?.coverPhoto || '');
  coverPhoto = serverCover || coverPhoto;

  const serverPublicId = String(me?.publicId || '').toUpperCase();
  const pv = me?.photoVerification;
  const next: StoredProfile = {
    ...(profile || {}),
    name: me?.name || profile?.name,
    age: me?.age ?? profile?.age,
    gender: me?.gender || profile?.gender,
    showMe: me?.showMe || profile?.showMe,
    bio: me?.bio || profile?.bio,
    interests: me?.interests || profile?.interests,
    relationshipGoal: me?.relationshipGoal || profile?.relationshipGoal,
    height: me?.height ?? profile?.height,
    // Store relative /uploads paths (or remote absolutes) — resolve at display time
    photo: toStoredMediaPath(me?.photo || profile?.photo),
    coverPhoto: toStoredMediaPath(coverPhoto || me?.coverPhoto || profile?.coverPhoto),
    photos: Array.isArray(me?.photos)
      ? me.photos.map(toStoredMediaPath).filter(Boolean)
      : Array.isArray(profile?.photos)
        ? profile.photos.map(toStoredMediaPath).filter(Boolean)
        : [],
    userId: String(me?.id || me?._id || profile?.userId || authUser.id || ''),
    publicId: isValidPublicId(serverPublicId) ? serverPublicId : '',
    photoVerification: pv
      ? {
          status: String(pv.status || 'none'),
          photoVerified:
            !!pv.photoVerified || String(pv.status || '') === 'approved',
          reviewNote: String(pv.reviewNote || ''),
        }
      : profile?.photoVerification || null,
  };

  await saveLocalProfile(authUser.email, next);

  // UI snapshot uses resolved absolute URLs
  const displayProfile: StoredProfile = {
    ...next,
    photo: toAbsolute(next.photo),
    coverPhoto: toAbsolute(next.coverPhoto),
    photos: Array.isArray(next.photos)
      ? next.photos.map(toAbsolute).filter(Boolean)
      : [],
  };
  profile = displayProfile;
  gallery = displayProfile.photos || gallery;
  coverPhoto = toAbsolute(next.coverPhoto) || coverPhoto;

  if (me?.subscription?.isActive && me?.subscription?.badge) {
    subscriptionBadge = me.subscription.badge;
    subscriptionExpiresAt = me.subscription.expiresAt || null;
  }

  return {
    profile,
    gallery,
    coverPhoto,
    subscriptionBadge,
    subscriptionExpiresAt,
    at: Date.now(),
  };
}

/** Background preload for the Profile tab — safe to call from tab layout. */
export async function preloadProfile(
  { force = false }: { force?: boolean } = {},
): Promise<ProfileScreenSnapshot | null> {
  if (!force) {
    const fresh = getCachedProfile();
    if (fresh) return fresh;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const authUser = await getCurrentAuthUser();
      const token = authUser ? await getAuthToken() : null;
      if (!authUser?.email || !token) {
        return getCachedProfile();
      }

      const localSnapshot = await snapshotFromLocal(authUser);
      if (localSnapshot && !getCachedProfile()) {
        setCachedProfile(localSnapshot);
      }

      const snapshot = await buildProfileSnapshot(authUser, token);
      cached = snapshot;
      return snapshot;
    } catch {
      return getCachedProfile();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
