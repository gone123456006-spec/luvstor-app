import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  apiLogout,
  apiRequest,
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
} from './api';
import {
  clearLegacyGlobalStorage,
  migrateAllGlobalsForAccount,
} from './accountStorage';

export type StoredProfile = {
  photo?: string | null;
  /** Banner cover — independent from DP and posts */
  coverPhoto?: string | null;
  photos?: string[];
  name?: string;
  age?: string | number;
  gender?: string;
  /** Who this user wants to see in Nearby: Man | Woman | Other | All */
  showMe?: string;
  height?: string;
  city?: string;
  distance?: string;
  tagline?: string;
  bio?: string;
  interests?: string[];
  relationshipGoal?: string;
  userId?: string;
  /** Unique public ID — format ABCD1234 */
  publicId?: string;
  photoVerification?: {
    status?: string;
    photoVerified?: boolean;
    reviewNote?: string;
  } | null;
};

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  profileComplete?: boolean;
};

const LEGACY_PROFILE_KEY = 'user_profile';
export const ACTIVE_ACCOUNT_EMAIL_KEY = 'active_account_email';

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function profileStorageKey(email: string): string {
  return `user_profile:${normalizeEmail(email)}`;
}

export function isLocalProfileComplete(profile: StoredProfile | null | undefined): boolean {
  if (!profile) return false;
  const name = String(profile.name || '').trim();
  const gender = String(profile.gender || '').trim();
  const photo = String(
    profile.photo || (Array.isArray(profile.photos) && profile.photos[0]) || '',
  ).trim();
  const age = Number(profile.age);
  const ageOk = Number.isFinite(age) && age >= 18;
  const bio = String(profile.bio || '').trim();
  const interests = Array.isArray(profile.interests)
    ? profile.interests.filter((i) => String(i || '').trim())
    : [];
  const goal = String(profile.relationshipGoal || '').trim();
  return Boolean(
    name && ageOk && gender && photo && bio && interests.length > 0 && goal,
  );
}

/** Server /me shape → profileComplete (same rules as backend). */
export function isServerProfileComplete(me: Record<string, unknown> | null | undefined): boolean {
  if (!me) return false;
  return isLocalProfileComplete(userToLocalProfile(me));
}

export async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem(AUTH_TOKEN_KEY);
}

export async function getCurrentAuthUser(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as AuthUser;
    if (!user?.email) return null;
    user.email = normalizeEmail(user.email);

    const token = await getAuthToken();
    if (!token) {
      return null;
    }

    return user;
  } catch (err) {
    console.warn('[Auth] Error loading current user:', err);
    return null;
  }
}

export async function getLocalProfile(email?: string): Promise<StoredProfile | null> {
  const resolvedEmail = email
    ? normalizeEmail(email)
    : (await getCurrentAuthUser())?.email;

  if (!resolvedEmail) return null;

  try {
    const key = profileStorageKey(resolvedEmail);
    let raw = await AsyncStorage.getItem(key);

    if (!raw) {
      const legacy = await AsyncStorage.getItem(LEGACY_PROFILE_KEY);
      if (legacy) {
        const authUser = await getCurrentAuthUser();
        if (authUser?.email === resolvedEmail) {
          raw = legacy;
          await AsyncStorage.setItem(key, legacy);
          await AsyncStorage.removeItem(LEGACY_PROFILE_KEY);
        }
      }
    }

    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveLocalProfile(
  email: string,
  profile: StoredProfile
): Promise<void> {
  const key = profileStorageKey(email);
  await AsyncStorage.setItem(key, JSON.stringify(profile));
  await AsyncStorage.removeItem(LEGACY_PROFILE_KEY);
}

export function userToLocalProfile(user: Record<string, unknown>): StoredProfile {
  const publicId = String(user.publicId || '');
  return {
    name: (user.name as string) || '',
    age: user.age != null ? String(user.age) : '',
    gender: (user.gender as string) || '',
    showMe: (user.showMe as string) || '',
    bio: (user.bio as string) || '',
    interests: (user.interests as string[]) || [],
    relationshipGoal: (user.relationshipGoal as string) || '',
    photo: (user.photo as string) || null,
    coverPhoto: (user.coverPhoto as string) || null,
    photos: Array.isArray(user.photos) ? (user.photos as string[]) : [],
    height: user.height != null ? String(user.height) : '',
    userId: String(user.id || user._id || ''),
    // Only keep valid ABCD1234 — never store Mongo ObjectId here
    publicId: /^[A-Z]{4}[0-9]{4}$/.test(publicId) ? publicId : '',
    photoVerification: (user.photoVerification as StoredProfile['photoVerification']) || null,
  };
}

/** True when value is the unique public display ID (ABCD1234). */
export function isValidPublicId(value?: string | null): boolean {
  return /^[A-Z]{4}[0-9]{4}$/.test(String(value || '').trim().toUpperCase());
}

export async function syncProfileToServer(
  token: string,
  profile: StoredProfile
): Promise<Record<string, unknown>> {
  let photoUrl = profile.photo || '';

  // If the photo is a local device file URI, upload it to the server first
  if (photoUrl && (photoUrl.startsWith('file://') || photoUrl.startsWith('/') || !photoUrl.startsWith('http'))) {
    try {
      const FileSystem = await import('expo-file-system/legacy');
      const base64 = await FileSystem.readAsStringAsync(photoUrl, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const ext = photoUrl.split('.').pop()?.toLowerCase() || 'jpg';
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const dataUri = `data:${mimeType};base64,${base64}`;
      const { API_BASE } = await import('./api');
      const res = await fetch(`${API_BASE}/api/upload/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ base64: dataUri }),
      });
      const json = await res.json();
      if (json.url) {
        photoUrl = json.url.startsWith('/') ? `${API_BASE}${json.url}` : json.url;
      }
    } catch (e) {
      console.warn('Could not upload profile photo, using local URI as fallback', e);
    }
  }

  const body: Record<string, unknown> = {
    name: profile.name?.trim(),
    bio: profile.bio || profile.tagline || '',
    gender: profile.gender || '',
    showMe: profile.showMe || '',
    interests: profile.interests || [],
    relationshipGoal: profile.relationshipGoal || '',
    photo: photoUrl,
  };
  if (profile.age) body.age = parseInt(String(profile.age), 10);
  if (profile.height) body.height = parseInt(String(profile.height), 10);
  if (profile.distance) body.distance = parseInt(String(profile.distance), 10);

  return apiRequest('/api/users/me', token, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** Fetch current user from API and save as THIS account's local profile only */
export async function hydrateAccountFromServer(
  token: string,
  email: string
): Promise<AuthUser & Record<string, unknown>> {
  const me = (await apiRequest('/api/users/me', token)) as Record<string, unknown>;
  const accountEmail = normalizeEmail(email);
  await saveLocalProfile(accountEmail, userToLocalProfile(me));
  return {
    id: String(me._id || me.id || ''),
    email: accountEmail,
    name: (me.name as string) || '',
    profileComplete: isServerProfileComplete(me),
    ...me,
  };
}

/**
 * Before saving a new session: clear shared global cache so prior account data
 * cannot leak. Per-account archives (user_profile:email, etc.) are kept.
 */
export async function prepareAccountSwitch(newEmail: string): Promise<string | null> {
  const previous = await getCurrentAuthUser();
  const prevEmail = previous?.email ? normalizeEmail(previous.email) : null;
  const nextEmail = normalizeEmail(newEmail);

  await clearLegacyGlobalStorage();

  if (prevEmail && prevEmail !== nextEmail) {
    // Switched Gmail on same device — old account's scoped data stays on disk
    // but must not remain in memory / global keys (already cleared above)
  }

  return prevEmail;
}

export async function completeAccountLogin(
  token: string,
  user: AuthUser
): Promise<AuthUser> {
  const email = normalizeEmail(user.email);
  await prepareAccountSwitch(email);

  await AsyncStorage.multiSet([
    [AUTH_TOKEN_KEY, token],
    [AUTH_USER_KEY, JSON.stringify({ ...user, email })],
    [ACTIVE_ACCOUNT_EMAIL_KEY, email],
  ]);

  await migrateAllGlobalsForAccount(email);

  try {
    const hydrated = await hydrateAccountFromServer(token, email);
    return {
      id: hydrated.id || user.id,
      email,
      name: hydrated.name as string,
      profileComplete: hydrated.profileComplete,
    };
  } catch (err) {
    console.warn('[Auth] Could not hydrate profile from server, using OTP response:', err);
    return {
      id: user.id,
      email,
      name: user.name || '',
      profileComplete: user.profileComplete || false,
    };
  }
}

export async function resolvePostLoginRoute(
  user: AuthUser,
): Promise<'/(tabs)' | '/create-profile'> {
  const email = normalizeEmail(user.email);
  const local = await getLocalProfile(email);

  // Full dating profile already on device → Discover (home tabs)
  if (isLocalProfileComplete(local)) {
    return '/(tabs)';
  }

  // Confirm with server (covers reinstall / another device)
  try {
    const token = await getAuthToken();
    if (token) {
      const me = (await apiRequest('/api/users/me', token)) as Record<
        string,
        unknown
      >;
      const mapped = userToLocalProfile(me);
      await saveLocalProfile(email, mapped);
      if (isLocalProfileComplete(mapped)) {
        return '/(tabs)';
      }
    }
  } catch {
    /* offline — fall through to create-profile */
  }

  // New / incomplete user (incl. Google name+photo only) → Create profile
  return '/create-profile';
}

/** Logout: notify server (clears device lock) + clear all local session data */
export async function logout(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      try {
        await apiLogout(token);
      } catch (err) {
        console.warn('[Auth] Could not notify server of logout:', err);
      }
    }
  } finally {
    try {
      const { clearChatListCache } = await import('./chatListCache');
      clearChatListCache();
    } catch {
      /* ignore */
    }
    await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_KEY, ACTIVE_ACCOUNT_EMAIL_KEY]);
    await clearLegacyGlobalStorage();
  }
}

/** @deprecated use logout() */
export async function clearAuthSession(): Promise<void> {
  await logout();
}
