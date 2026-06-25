import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeEmail } from './auth';

export const MATCHES_KEY = 'user_matches';
export const RECENT_CHATS_KEY = 'recent_chats';
export const CHAT_HISTORY_PREFIX = 'chat_history';
export const TEMP_USER_ID_KEY = 'temp_user_id';

/** Keys shared across accounts — must be cleared on logout / account switch */
const LEGACY_GLOBAL_KEYS = [
  'user_profile',
  MATCHES_KEY,
  RECENT_CHATS_KEY,
  TEMP_USER_ID_KEY,
  'profile_setup_complete',
  'active_account_email',
];

export function scopedKey(baseKey: string, email: string): string {
  return `${baseKey}:${normalizeEmail(email)}`;
}

export function chatHistoryKey(email: string, chatId: string): string {
  return `${CHAT_HISTORY_PREFIX}:${normalizeEmail(email)}:${chatId}`;
}

export async function getAccountJson<T>(
  baseKey: string,
  email: string
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(scopedKey(baseKey, email));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setAccountJson(
  baseKey: string,
  email: string,
  value: unknown
): Promise<void> {
  await AsyncStorage.setItem(scopedKey(baseKey, email), JSON.stringify(value));
}

export async function removeAccountJson(baseKey: string, email: string): Promise<void> {
  await AsyncStorage.removeItem(scopedKey(baseKey, email));
}

/** Migrate old global key → per-account (one-time) */
export async function migrateGlobalToAccount(
  globalKey: string,
  baseKey: string,
  email: string
): Promise<void> {
  const scoped = scopedKey(baseKey, email);
  const existing = await AsyncStorage.getItem(scoped);
  if (existing) return;

  const legacy = await AsyncStorage.getItem(globalKey);
  if (legacy) {
    await AsyncStorage.setItem(scoped, legacy);
    await AsyncStorage.removeItem(globalKey);
  }
}

/** Remove legacy chat keys (chat_history_1) — not per-account format */
export async function purgeLegacyChatHistoryKeys(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const oldFormat = keys.filter((k) => k.startsWith('chat_history_'));
  if (oldFormat.length) await AsyncStorage.multiRemove(oldFormat);
}

export async function clearLegacyGlobalStorage(): Promise<void> {
  for (const key of LEGACY_GLOBAL_KEYS) {
    await AsyncStorage.removeItem(key);
  }
  await purgeLegacyChatHistoryKeys();
}

export async function migrateAllGlobalsForAccount(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  await migrateGlobalToAccount('user_profile', 'user_profile', normalized);
  await migrateGlobalToAccount(MATCHES_KEY, MATCHES_KEY, normalized);
  await migrateGlobalToAccount(RECENT_CHATS_KEY, RECENT_CHATS_KEY, normalized);
}
