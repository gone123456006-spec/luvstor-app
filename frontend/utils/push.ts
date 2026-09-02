/**
 * Push notification plumbing (Firebase Cloud Messaging via expo-notifications).
 *
 * `getDevicePushTokenAsync()` returns the raw FCM registration token on
 * Android, which the backend sends through firebase-admin directly — no Expo
 * push service in the middle.
 *
 * Remote push requires a development/production build with google-services.json.
 * Expo Go (SDK 53+) errors if expo-notifications is even imported on Android,
 * so that package is loaded lazily and only outside Expo Go.
 */
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiRequest } from './api';
import { getOrCreateDeviceId } from './device';

const STORED_TOKEN_KEY = 'luvstor_fcm_token';

export const isExpoGo = isRunningInExpoGo();

type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null | undefined;

function loadNotifications(): NotificationsModule | null {
  if (isExpoGo) return null;
  if (notificationsModule !== undefined) return notificationsModule;
  try {
    // Evaluated only in a native/dev build — Expo Go throws on import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notificationsModule = require('expo-notifications') as NotificationsModule;
  } catch (err: any) {
    console.warn('[Push] expo-notifications unavailable:', err?.message);
    notificationsModule = null;
  }
  return notificationsModule;
}

const IMPORTANCE = {
  LOW: 4,
  DEFAULT: 5,
  HIGH: 6,
  MAX: 7,
} as const;

const VISIBILITY_PRIVATE = 2;

/** Android channels — must match the channelId the backend sends. */
export const CHANNELS = {
  messages: {
    name: 'Messages',
    description: 'New chat messages',
    importance: IMPORTANCE.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#8E2DE2',
  },
  calls: {
    name: 'Calls',
    description: 'Incoming voice and video calls',
    importance: IMPORTANCE.MAX,
    sound: 'default',
    vibrationPattern: [0, 500, 500, 500],
    lightColor: '#8E2DE2',
  },
  social: {
    name: 'Matches & Likes',
    description: 'New matches, likes and friend requests',
    importance: IMPORTANCE.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF4B6E',
  },
  wallet: {
    name: 'Tokens & Wallet',
    description: 'Token purchases, rewards and balance alerts',
    importance: IMPORTANCE.DEFAULT,
    sound: 'default',
    vibrationPattern: [0, 200],
    lightColor: '#F59E0B',
  },
  security: {
    name: 'Account & Security',
    description: 'Sign-ins and account changes',
    importance: IMPORTANCE.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#EA4335',
  },
  system: {
    name: 'Updates',
    description: 'App announcements',
    importance: IMPORTANCE.DEFAULT,
    sound: 'default',
    lightColor: '#8E2DE2',
  },
  promotions: {
    name: 'Offers',
    description: 'Promotions and special offers',
    importance: IMPORTANCE.LOW,
    sound: undefined,
    lightColor: '#8E2DE2',
  },
  suggestions: {
    name: 'Daily suggestions',
    description: 'One daily summary of likes, matches and new people nearby',
    importance: IMPORTANCE.DEFAULT,
    sound: 'default',
    lightColor: '#8E2DE2',
  },
} as const;

export type ChannelId = keyof typeof CHANNELS;

/**
 * Foreground presentation. The in-app toast already covers chat, so a banner
 * would double up — everything else is shown.
 */
export function configureForegroundHandler(
  isChatVisible: (senderId?: string) => boolean,
) {
  const Notifications = loadNotifications();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = (notification.request.content.data || {}) as Record<string, any>;
      const duplicate =
        data.type === 'chat' && isChatVisible(String(data.actorId || data.userId || ''));

      return {
        shouldShowBanner: !duplicate,
        shouldShowList: true,
        shouldPlaySound: !duplicate,
        shouldSetBadge: true,
        shouldShowAlert: !duplicate,
      } as any;
    },
  });
}

/** Create every Android channel up front so the first push renders correctly. */
export async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  const Notifications = loadNotifications();
  if (!Notifications) return;
  await Promise.all(
    Object.entries(CHANNELS).map(([id, cfg]) =>
      Notifications.setNotificationChannelAsync(id, {
        name: cfg.name,
        description: cfg.description,
        importance: cfg.importance,
        sound: cfg.sound,
        vibrationPattern: (cfg as any).vibrationPattern,
        lightColor: cfg.lightColor,
        lockscreenVisibility: VISIBILITY_PRIVATE,
        enableVibrate: true,
        showBadge: true,
      }).catch(() => undefined),
    ),
  );
}

export type PermissionResult = {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
};

/** Ask once; returns the current state without re-prompting if already decided. */
export async function requestPermission(): Promise<PermissionResult> {
  const Notifications = loadNotifications();
  if (!Notifications || !Device.isDevice) {
    return { granted: false, canAskAgain: false, status: 'unavailable' };
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return { granted: true, canAskAgain: true, status: current.status };
  }
  if (!current.canAskAgain) {
    return { granted: false, canAskAgain: false, status: current.status };
  }

  const asked = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  return {
    granted: asked.granted,
    canAskAgain: asked.canAskAgain,
    status: asked.status,
  };
}

/** Raw FCM registration token for this install. */
export async function getFcmToken(): Promise<string | null> {
  const Notifications = loadNotifications();
  if (!Notifications || !Device.isDevice) return null;
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token?.data === 'string' ? token.data : null;
  } catch (err: any) {
    console.warn('[Push] Could not get FCM token:', err?.message);
    return null;
  }
}

/**
 * Send the token to the backend. Skipped when the token has not changed so
 * app starts stay cheap.
 */
export async function syncToken(
  authToken: string,
  fcmToken: string,
  { force = false } = {},
): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(STORED_TOKEN_KEY);
    if (!force && stored === fcmToken) return true;

    const deviceId = await getOrCreateDeviceId();

    await apiRequest('/api/devices/register', authToken, {
      method: 'POST',
      body: JSON.stringify({
        token: fcmToken,
        deviceId,
        platform: Platform.OS,
        deviceName: Device.deviceName || Device.modelName || '',
        appVersion: Constants.expoConfig?.version || '',
      }),
    });

    await AsyncStorage.setItem(STORED_TOKEN_KEY, fcmToken);
    return true;
  } catch (err: any) {
    console.warn('[Push] Token sync failed:', err?.message);
    return false;
  }
}

/** Called on logout so the device stops receiving the previous user's pushes. */
export async function unregisterToken(authToken?: string | null) {
  try {
    const stored = await AsyncStorage.getItem(STORED_TOKEN_KEY);
    if (authToken) {
      await apiRequest('/api/devices/unregister', authToken, {
        method: 'POST',
        body: JSON.stringify({ token: stored || undefined }),
      }).catch(() => undefined);
    }
    await AsyncStorage.removeItem(STORED_TOKEN_KEY);
  } catch {
    /* logout must never fail because of push cleanup */
  }
}

/** Mirror the backend unread count onto the launcher badge. */
export async function setBadge(count: number) {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    /* unsupported on some launchers */
  }
}

/** Clear the tray notifications for one conversation once it is opened. */
export async function dismissForGroup(groupKey: string) {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => {
          const data = (n.request.content.data || {}) as Record<string, any>;
          return data.groupKey === groupKey;
        })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    /* best effort */
  }
}

export async function dismissAll() {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    /* best effort */
  }
}

const NOOP_SUB = { remove: () => {} };

export function addPushTokenListener(
  listener: (token: { data?: string }) => void,
) {
  const Notifications = loadNotifications();
  if (!Notifications) return NOOP_SUB;
  return Notifications.addPushTokenListener(listener as any);
}

export function addNotificationReceivedListener(
  listener: (notification: any) => void,
) {
  const Notifications = loadNotifications();
  if (!Notifications) return NOOP_SUB;
  return Notifications.addNotificationReceivedListener(listener);
}

export function addNotificationResponseReceivedListener(
  listener: (response: any) => void,
) {
  const Notifications = loadNotifications();
  if (!Notifications) return NOOP_SUB;
  return Notifications.addNotificationResponseReceivedListener(listener);
}

export async function getLastNotificationResponseAsync() {
  const Notifications = loadNotifications();
  if (!Notifications) return null;
  try {
    return await Notifications.getLastNotificationResponseAsync();
  } catch {
    return null;
  }
}

/** Resolve the in-app route for a notification payload. */
export function routeForData(data: Record<string, any> = {}) {
  if (data.action === 'incoming' && data.callId) {
    // Foreground/background: CallProvider handles socket `call:incoming`.
    // Tap opens chat with caller so user can call back if missed.
    const userId = data.userId || data.actorId;
    return userId ? `/messages/${userId}` : '/(tabs)/chat';
  }

  if (data.deepLink && typeof data.deepLink === 'string') {
    return data.deepLink;
  }

  const userId = data.userId || data.actorId;
  switch (data.type) {
    case 'chat':
    case 'call':
    case 'match':
    case 'friends':
      return userId ? `/messages/${userId}` : '/(tabs)/chat';
    case 'friend_request':
    case 'like':
      return '/(tabs)/chat';
    case 'token':
    case 'token_purchase':
    case 'token_low':
    case 'spin':
    case 'subscription':
      return '/(tabs)/token';
    case 'security':
      return '/settings/account';
    case 'suggestion':
      return '/(tabs)';
    default:
      return '/notifications';
  }
}
