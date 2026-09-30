import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { apiRequest } from './api';

/**
 * Location access for Nearby: one-time Enable Location screen after profile
 * setup, plus the small Nearby prompt when access is off later.
 *
 * Never requests the OS permission on its own — only from an explicit tap.
 */

export type LocationAccessStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'services-off';

export type LocationAccess = {
  status: LocationAccessStatus;
  /** False once Android stops showing the permission dialog (denied twice). */
  canAskAgain: boolean;
};

const SKIP_KEY_PREFIX = 'luvstor.locationSetupSkipped.';

export async function getLocationAccess(): Promise<LocationAccess> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      return {
        status: perm.canAskAgain === false ? 'blocked' : 'denied',
        canAskAgain: perm.canAskAgain !== false,
      };
    }
    const services = await Location.hasServicesEnabledAsync();
    return { status: services ? 'granted' : 'services-off', canAskAgain: true };
  } catch {
    return { status: 'unknown', canAskAgain: true };
  }
}

async function openLocationSettings(access: LocationAccess) {
  if (access.status === 'services-off' && Platform.OS === 'android') {
    try {
      await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      return;
    } catch {
      /* fall back to app settings */
    }
  }
  await Linking.openSettings().catch(() => {});
}

/**
 * User tapped "Enable". Shows the OS dialog when Android still allows it,
 * otherwise opens Settings. Returns the access state right after.
 */
export async function requestLocationAccess(): Promise<LocationAccess> {
  const current = await getLocationAccess();
  if (current.status === 'granted') return current;

  if (current.status === 'denied') {
    try {
      const res = await Location.requestForegroundPermissionsAsync();
      if (res.status !== 'granted') {
        return {
          status: res.canAskAgain === false ? 'blocked' : 'denied',
          canAskAgain: res.canAskAgain !== false,
        };
      }
    } catch {
      return current;
    }
    return getLocationAccess();
  }

  await openLocationSettings(current);
  return current;
}

export async function wasLocationSetupSkipped(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await AsyncStorage.getItem(SKIP_KEY_PREFIX + userId)) === '1';
  } catch {
    return false;
  }
}

export async function markLocationSetupSkipped(userId: string) {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(SKIP_KEY_PREFIX + userId, '1');
  } catch {
    /* best effort */
  }
}

/**
 * Should the one-time Enable Location screen be shown?
 * Fast path: app already has location permission → never (no network call).
 * Any failure → false, so a flaky network never blocks the home screen.
 */
export async function needsLocationSetup(
  token: string,
  userId: string,
): Promise<boolean> {
  const access = await getLocationAccess();
  // GPS switched off (permission already granted) is handled by the Nearby prompt.
  if (access.status !== 'denied' && access.status !== 'blocked') return false;
  if (await wasLocationSetupSkipped(userId)) return false;
  try {
    const me: any = await Promise.race([
      apiRequest('/api/users/me', token),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    return me?.locationSetupCompleted === false;
  } catch {
    return false;
  }
}

/** Live location access; re-checked on screen focus and when the app returns from Settings. */
export function useLocationAccess() {
  const [access, setAccess] = useState<LocationAccess>({
    status: 'unknown',
    canAskAgain: true,
  });
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const next = await getLocationAccess();
    if (mounted.current) setAccess(next);
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { access, refresh, setAccess };
}
