import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeEmail } from './normalizeEmail';
import { mapNearbyUser, type NearbyUser } from './nearby';

const MAX_CACHED = 60;

type NearbyFeedSnapshot = {
  users: NearbyUser[];
  prefsKey: string;
  at: number;
};

function storageKey(email: string) {
  return `nearby_feed_cache:${normalizeEmail(email)}`;
}

let memory: { email: string; snap: NearbyFeedSnapshot } | null = null;

function isUsable(snap: NearbyFeedSnapshot | null | undefined): boolean {
  return !!snap && Array.isArray(snap.users) && snap.users.length > 0;
}

export const NEARBY_REFRESH_HINT = "Couldn't refresh — pull to retry.";

export function getNearbyFeedCache(email?: string | null): NearbyUser[] {
  const e = normalizeEmail(email || '');
  if (!e || !memory || memory.email !== e) return [];
  return isUsable(memory.snap) ? memory.snap.users.map((u) => mapNearbyUser(u)) : [];
}

export async function hydrateNearbyFeedCache(
  email: string,
): Promise<NearbyUser[]> {
  const e = normalizeEmail(email);
  if (!e) return [];
  if (memory?.email === e && isUsable(memory.snap)) return memory.snap.users;
  try {
    const raw = await AsyncStorage.getItem(storageKey(e));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NearbyFeedSnapshot;
    if (!isUsable(parsed)) return [];
    memory = { email: e, snap: parsed };
    return parsed.users.map((u) => mapNearbyUser(u));
  } catch {
    return [];
  }
}

export function setNearbyFeedCache(
  email: string,
  users: NearbyUser[],
  prefsKey = '',
) {
  const e = normalizeEmail(email);
  if (!e) return;
  const snap: NearbyFeedSnapshot = {
    users: (users || []).slice(0, MAX_CACHED),
    prefsKey,
    at: Date.now(),
  };
  memory = { email: e, snap };
  if (!snap.users.length) {
    void AsyncStorage.removeItem(storageKey(e)).catch(() => {});
    return;
  }
  void AsyncStorage.setItem(storageKey(e), JSON.stringify(snap)).catch(() => {});
}

export function clearNearbyFeedCache(email?: string | null) {
  const e = normalizeEmail(email || '');
  if (!e) {
    memory = null;
    return;
  }
  if (memory?.email === e) memory = null;
  void AsyncStorage.removeItem(storageKey(e)).catch(() => {});
}
