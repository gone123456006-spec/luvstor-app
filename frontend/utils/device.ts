import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';

export const DEVICE_ID_KEY = 'luvstor_device_id';

type SecureStoreModule = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
};

let SecureStore: SecureStoreModule | null = null;
try {
  // Optional — survives iOS reinstall better than AsyncStorage when hardware ID is unavailable
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SecureStore = require('expo-secure-store') as SecureStoreModule;
} catch {
  SecureStore = null;
}

function generateFallbackDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function readPersistedDeviceId(): Promise<string | null> {
  try {
    const fromAsync = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (fromAsync && fromAsync.trim().length >= 8) return fromAsync.trim();
  } catch {
    /* ignore */
  }
  if (SecureStore) {
    try {
      const fromSecure = await SecureStore.getItemAsync(DEVICE_ID_KEY);
      if (fromSecure && fromSecure.trim().length >= 8) return fromSecure.trim();
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function persistDeviceId(deviceId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  } catch {
    /* ignore */
  }
  if (SecureStore) {
    try {
      await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Hardware / OS install fingerprint that survives app uninstall+reinstall
 * on the same phone (Android ID; iOS IDFV).
 * Different physical phones → different IDs → transfer prompt is correct.
 */
async function getStableHardwareDeviceId(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      const androidId = Application.getAndroidId?.();
      const id = String(androidId || '').trim();
      // Emulator / broken stubs sometimes return empty or the well-known bad id
      if (id.length >= 8 && id.toLowerCase() !== 'unknown') {
        return `a:${id}`;
      }
    }
    if (Platform.OS === 'ios') {
      const vendorId = await Application.getIosIdForVendorAsync?.();
      const id = String(vendorId || '').trim();
      if (id.length >= 8) {
        return `i:${id}`;
      }
    }
  } catch (err) {
    console.warn('[device] hardware id unavailable', err);
  }
  return null;
}

/**
 * Stable ID for this physical device.
 * Prefer OS hardware fingerprints (survive uninstall). Never clear on logout.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const hardwareId = await getStableHardwareDeviceId();
  if (hardwareId) {
    await persistDeviceId(hardwareId);
    return hardwareId;
  }

  const existing = await readPersistedDeviceId();
  // Prefer SecureStore/AsyncStorage only when hardware is unavailable (web / rare)
  if (existing && existing.length >= 8) {
    await persistDeviceId(existing);
    return existing;
  }

  const deviceId = `f:${generateFallbackDeviceId()}`;
  await persistDeviceId(deviceId);
  return deviceId;
}

/** True when id is an OS-backed fingerprint (not an app-generated UUID). */
export function isStableHardwareDeviceId(deviceId: string | null | undefined): boolean {
  const id = String(deviceId || '').trim();
  return /^a:[A-Za-z0-9_-]{8,}$/i.test(id) || /^i:[A-Za-z0-9_-]{8,}$/i.test(id);
}

/** Decode JWT payload (no verify) — used to compare session device vs stable device. */
export function peekJwtDeviceId(token: string | null | undefined): string | null {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
    const b64 = payload + pad;
    let json: string;
    if (typeof globalThis.atob === 'function') {
      json = globalThis.atob(b64);
    } else {
      // Node / rare environments without atob
      // eslint-disable-next-line no-undef
      const Buf = typeof Buffer !== 'undefined' ? Buffer : null;
      if (!Buf) return null;
      json = Buf.from(b64, 'base64').toString('utf8');
    }
    const data = JSON.parse(json) as { deviceId?: string };
    const id = String(data?.deviceId || '').trim();
    return id.length >= 8 ? id : null;
  } catch {
    return null;
  }
}
