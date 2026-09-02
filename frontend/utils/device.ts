import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEVICE_ID_KEY = 'luvstor_device_id';

function generateDeviceId(): string {
  // Persistent installation ID (UUID v4-style)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Stable ID for this app install — survives logout, reset only on uninstall/clear data */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing && existing.length >= 8) return existing;

  const deviceId = generateDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}
