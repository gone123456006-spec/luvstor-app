import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Session JWT lives in Keychain (iOS) / Keystore (Android) via expo-secure-store,
 * with AsyncStorage as the fallback when the native module is unavailable (web,
 * older binaries).
 *
 * The iOS Keychain survives uninstall, so a marker in AsyncStorage (wiped on
 * uninstall) decides whether the secure copy belongs to this install — a
 * reinstall still starts signed out, exactly like before.
 */
const TOKEN_KEY = 'auth_token';
const SECURE_MARKER_KEY = 'auth_token_secure';

type SecureStoreModule = {
  getItemAsync: (key: string, options?: object) => Promise<string | null>;
  setItemAsync: (key: string, value: string, options?: object) => Promise<void>;
  deleteItemAsync: (key: string, options?: object) => Promise<void>;
  AFTER_FIRST_UNLOCK?: number;
};

let secure: SecureStoreModule | null = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-secure-store') as SecureStoreModule;
    if (typeof mod?.getItemAsync === 'function') secure = mod;
  } catch {
    secure = null;
  }
}

/** Readable while the phone is locked (incoming calls, push actions) after first unlock */
function secureOptions(): object {
  return secure?.AFTER_FIRST_UNLOCK != null
    ? { keychainAccessible: secure.AFTER_FIRST_UNLOCK }
    : {};
}

let cached: string | null | undefined;
let loading: Promise<string | null> | null = null;

async function saveSecure(token: string): Promise<boolean> {
  if (!secure) return false;
  try {
    await secure.setItemAsync(TOKEN_KEY, token, secureOptions());
    if ((await secure.getItemAsync(TOKEN_KEY, secureOptions())) !== token) return false;
    await AsyncStorage.setItem(SECURE_MARKER_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** `undefined` = could not read right now (don't treat as signed out) */
async function load(): Promise<string | null | undefined> {
  if (secure && (await AsyncStorage.getItem(SECURE_MARKER_KEY))) {
    try {
      const value = await secure.getItemAsync(TOKEN_KEY, secureOptions());
      if (value) return value;
    } catch {
      const legacy = await AsyncStorage.getItem(TOKEN_KEY);
      return legacy ?? undefined;
    }
  }
  const legacy = await AsyncStorage.getItem(TOKEN_KEY);
  if (legacy && (await saveSecure(legacy))) {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
  return legacy;
}

export async function readAuthToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  if (!loading) {
    loading = load()
      .then((value) => {
        if (value !== undefined && cached === undefined) cached = value;
        return value ?? null;
      })
      .catch(() => null)
      .finally(() => {
        loading = null;
      });
  }
  const value = await loading;
  return cached !== undefined ? cached : value;
}

export async function writeAuthToken(token: string): Promise<void> {
  cached = token;
  if (await saveSecure(token)) {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } else {
    await AsyncStorage.multiSet([[TOKEN_KEY, token]]);
    await AsyncStorage.removeItem(SECURE_MARKER_KEY);
  }
}

export async function clearAuthToken(): Promise<void> {
  cached = null;
  await AsyncStorage.multiRemove([TOKEN_KEY, SECURE_MARKER_KEY]);
  if (secure) {
    try {
      await secure.deleteItemAsync(TOKEN_KEY, secureOptions());
    } catch {
      /* marker is gone, so a leftover secure copy is ignored */
    }
  }
}
