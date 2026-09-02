import { API_BASE, apiRequest } from './api';
import {
  AuthUser,
  getAuthToken,
  getCurrentAuthUser,
  getLocalProfile,
  isValidPublicId,
  saveLocalProfile,
  StoredProfile,
} from './auth';

function toAbsolute(url?: string | null) {
  if (!url) return '';
  if (
    url.startsWith('http') ||
    url.startsWith('data:') ||
    url.startsWith('file:')
  ) {
    return url;
  }
  return `${API_BASE}${url}`;
}

export type ProfileScreenSnapshot = {
  profile: StoredProfile | null;
  gallery: string[];
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
  if (!cached) return;
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
  profile.photo = toAbsolute(profile.photo);

  const gallery = Array.isArray(profile.photos)
    ? profile.photos.map(toAbsolute).filter(Boolean)
    : [];

  return {
    profile,
    gallery,
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

  if (profile) {
    await saveLocalProfile(authUser.email, profile);
  }

  let subscriptionBadge: string | null = null;
  let subscriptionExpiresAt: string | null = null;

  const me: any = await apiRequest('/api/users/me', authToken);
  if (Array.isArray(me?.photos)) {
    gallery = me.photos.map(toAbsolute).filter(Boolean);
  }

  const serverPublicId = String(me?.publicId || '').toUpperCase();
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
    photo: toAbsolute(me?.photo || profile?.photo),
    photos: Array.isArray(me?.photos) ? me.photos : profile?.photos,
    userId: String(me?.id || me?._id || profile?.userId || authUser.id || ''),
    publicId: isValidPublicId(serverPublicId) ? serverPublicId : '',
  };

  await saveLocalProfile(authUser.email, next);
  profile = next;

  if (me?.subscription?.isActive && me?.subscription?.badge) {
    subscriptionBadge = me.subscription.badge;
    subscriptionExpiresAt = me.subscription.expiresAt || null;
  }

  return {
    profile,
    gallery,
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
