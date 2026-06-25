import AsyncStorage from '@react-native-async-storage/async-storage';
import {
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
  name?: string;
  age?: string | number;
  gender?: string;
  height?: string;
  city?: string;
  distance?: string;
  tagline?: string;
  bio?: string;
  interests?: string[];
  relationshipGoal?: string;
  userId?: string;
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
  return Boolean(profile?.name && String(profile.name).trim().length > 0);
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
    return user;
  } catch {
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
  return {
    name: (user.name as string) || '',
    age: user.age != null ? String(user.age) : '',
    gender: (user.gender as string) || '',
    bio: (user.bio as string) || '',
    interests: (user.interests as string[]) || [],
    relationshipGoal: (user.relationshipGoal as string) || '',
    photo: (user.photo as string) || null,
    height: user.height != null ? String(user.height) : '',
    userId: String(user.id || user._id || ''),
  };
}

export async function syncProfileToServer(
  token: string,
  profile: StoredProfile
): Promise<Record<string, unknown>> {
  let photoUrl = profile.photo || '';

  // If the photo is a local device file URI, upload it to the server first
  if (photoUrl && (photoUrl.startsWith('file://') || photoUrl.startsWith('/') || !photoUrl.startsWith('http'))) {
    try {
      const FileSystem = await import('expo-file-system');
      const base64 = await FileSystem.readAsStringAsync(photoUrl, { encoding: 'base64' });
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
      if (json.url) photoUrl = json.url;
    } catch (e) {
      console.warn('Could not upload profile photo, using local URI as fallback', e);
    }
  }

  const body: Record<string, unknown> = {
    name: profile.name?.trim(),
    bio: profile.bio || profile.tagline || '',
    gender: profile.gender || '',
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
    profileComplete: Boolean(me.name && String(me.name).trim()),
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

  const hydrated = await hydrateAccountFromServer(token, email);
  return {
    id: hydrated.id || user.id,
    email,
    name: hydrated.name as string,
    profileComplete: hydrated.profileComplete,
  };
}

export async function resolvePostLoginRoute(user: AuthUser): Promise<'/(tabs)' | '/create-profile'> {
  const email = normalizeEmail(user.email);

  if (user.profileComplete) {
    return '/(tabs)';
  }

  const local = await getLocalProfile(email);
  if (isLocalProfileComplete(local)) {
    return '/(tabs)';
  }

  return '/create-profile';
}

/** Logout: clear session + all shared global cache (keeps per-email archives) */
export async function logout(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
  await AsyncStorage.removeItem(AUTH_USER_KEY);
  await AsyncStorage.removeItem(ACTIVE_ACCOUNT_EMAIL_KEY);
  await clearLegacyGlobalStorage();
}

/** @deprecated use logout() */
export async function clearAuthSession(): Promise<void> {
  await logout();
}
