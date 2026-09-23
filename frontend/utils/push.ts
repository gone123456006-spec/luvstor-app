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
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiRequest } from './api';
import { getOrCreateDeviceId } from './device';

const STORED_TOKEN_KEY = 'luvstor_fcm_token';

export const isExpoGo = isRunningInExpoGo();

/** True after permission + FCM token registered — FG toast can defer to system tray */
let pushTrayReady = false;

export function setPushTrayReady(ready: boolean) {
  pushTrayReady = !!ready;
}

export function isPushTrayReady() {
  return pushTrayReady;
}

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

/**
 * Android channels — must match the channelId the backend sends.
 *
 * Omit `sound` for the system default notification sound.
 * Do NOT use `sound: 'default'` — expo-notifications treats that as a custom
 * filename and logs "Custom sound 'default' not found".
 * Use `sound: null` for silent channels.
 */
export const CHANNELS = {
  messages: {
    name: 'Messages',
    description: 'New chat messages',
    importance: IMPORTANCE.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#8E2DE2',
    /** Show sender + preview on lock screen (WhatsApp default) */
    lockscreenVisibility: 1,
  },
  calls: {
    name: 'Incoming calls',
    description: 'Incoming voice and video calls',
    importance: IMPORTANCE.MAX,
    vibrationPattern: [0, 500, 500, 500, 500, 500],
    lightColor: '#8E2DE2',
    lockscreenVisibility: 1,
    /** Heads-up + lock-screen even in quiet hours when OS allows */
    bypassDnd: false,
    enableLights: true,
  },
  ongoing_calls: {
    name: 'Ongoing calls',
    description: 'Active and outgoing voice and video calls',
    importance: IMPORTANCE.DEFAULT,
    vibrationPattern: [0],
    lightColor: '#8E2DE2',
    lockscreenVisibility: 1,
    bypassDnd: false,
    enableVibrate: false,
  },
  social: {
    name: 'Matches & Likes',
    description: 'New matches, likes and friend requests',
    importance: IMPORTANCE.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF4B6E',
  },
  wallet: {
    name: 'Tokens & Wallet',
    description: 'Token purchases, rewards and balance alerts',
    importance: IMPORTANCE.DEFAULT,
    vibrationPattern: [0, 200],
    lightColor: '#F59E0B',
  },
  security: {
    name: 'Account & Security',
    description: 'Sign-ins and account changes',
    importance: IMPORTANCE.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#EA4335',
  },
  system: {
    name: 'Updates',
    description: 'App announcements',
    importance: IMPORTANCE.DEFAULT,
    lightColor: '#8E2DE2',
  },
  promotions: {
    name: 'Offers',
    description: 'Promotions and special offers',
    importance: IMPORTANCE.LOW,
    sound: null as string | null,
    lightColor: '#8E2DE2',
  },
  suggestions: {
    name: 'Daily suggestions',
    description: 'One daily summary of likes, matches and new people nearby',
    importance: IMPORTANCE.DEFAULT,
    lightColor: '#8E2DE2',
  },
} as const;

export type ChannelId = keyof typeof CHANNELS;

/** WhatsApp-style Answer / Decline on the incoming-call notification */
export const INCOMING_CALL_CATEGORY = 'incoming_call';
export const CALL_ACTION_ACCEPT = 'ACCEPT_CALL';
export const CALL_ACTION_DECLINE = 'DECLINE_CALL';

/** Direct reply from the message shade (Android RemoteInput) */
export const CHAT_REPLY_CATEGORY = 'chat_reply';
export const CHAT_ACTION_REPLY = 'REPLY_MESSAGE';

let callCategoryReady = false;
let chatReplyCategoryReady = false;

/** Register Answer / Decline actions (iOS + Android). Safe to call repeatedly. */
export async function ensureCallNotificationCategory(): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications || callCategoryReady) return;
  try {
    await Notifications.setNotificationCategoryAsync(INCOMING_CALL_CATEGORY, [
      {
        identifier: CALL_ACTION_ACCEPT,
        buttonTitle: 'Answer',
        options: {
          opensAppToForeground: true,
          isAuthenticationRequired: false,
        },
      },
      {
        identifier: CALL_ACTION_DECLINE,
        buttonTitle: 'Decline',
        options: {
          // Must open app so JS can decline via HTTP/socket (shade-only often never runs)
          opensAppToForeground: true,
          isDestructive: true,
          isAuthenticationRequired: false,
        },
      },
    ]);
    callCategoryReady = true;
  } catch (err: any) {
    console.warn('[Push] call category failed:', err?.message);
  }
}

/** Register Reply action for message notifications. */
export async function ensureChatReplyCategory(): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications || chatReplyCategoryReady) return;
  try {
    await Notifications.setNotificationCategoryAsync(CHAT_REPLY_CATEGORY, [
      {
        identifier: CHAT_ACTION_REPLY,
        buttonTitle: 'Reply',
        textInput: {
          submitButtonTitle: 'Send',
          placeholder: 'Reply…',
        },
        options: {
          opensAppToForeground: false,
          isAuthenticationRequired: false,
        },
      },
    ]);
    chatReplyCategoryReady = true;
  } catch (err: any) {
    console.warn('[Push] chat reply category failed:', err?.message);
  }
}

/**
 * Foreground presentation — WhatsApp-style:
 * - Actively viewing that chat → silent
 * - App open elsewhere → local tray (from socket) owns chat alerts; suppress
 *   duplicate remote FCM chat so the shade doesn't double-post
 * - Incoming call UI already on screen → suppress duplicate call FCM
 * - Background / killed → OS shows remote FCM (handler not used)
 */
export function configureForegroundHandler(
  isChatVisible: (senderId?: string) => boolean,
) {
  const Notifications = loadNotifications();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = (notification.request.content.data || {}) as Record<string, any>;
      const isChat = data.type === 'chat';
      const isIncomingCall =
        data.type === 'call' &&
        (data.action === 'incoming' || data.categoryId === 'incoming_call');
      const senderId = String(data.actorId || data.userId || '');
      const onThatChat = isChat && !!senderId && isChatVisible(senderId);

      const trigger = notification.request.trigger as { type?: string } | null;
      const isRemotePush =
        trigger != null &&
        typeof trigger === 'object' &&
        (trigger.type === 'push' ||
          (trigger as { remoteMessage?: unknown }).remoteMessage != null);

      // App is open: socket CallOverlay / local chat tray already owns the alert
      if (
        isRemotePush &&
        AppState.currentState === 'active' &&
        (isChat || isIncomingCall)
      ) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: true,
          shouldShowAlert: false,
        } as any;
      }

      const show = !onThatChat;
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: true,
        shouldShowAlert: show,
      } as any;
    },
  });
}

/** Create every Android channel up front so the first push renders correctly. */
export async function ensureChannels() {
  if (Platform.OS !== 'android') {
    await ensureCallNotificationCategory();
    await ensureChatReplyCategory();
    return;
  }
  const Notifications = loadNotifications();
  if (!Notifications) return;
  await Promise.all(
    Object.entries(CHANNELS).map(([id, cfg]) => {
      const options: Record<string, unknown> = {
        name: cfg.name,
        description: cfg.description,
        importance: cfg.importance,
        vibrationPattern: (cfg as { vibrationPattern?: number[] }).vibrationPattern,
        lightColor: cfg.lightColor,
        lockscreenVisibility:
          (cfg as { lockscreenVisibility?: number }).lockscreenVisibility ??
          VISIBILITY_PRIVATE,
        enableVibrate: true,
        showBadge: true,
        enableLights: (cfg as { enableLights?: boolean }).enableLights === true,
      };
      if ((cfg as { bypassDnd?: boolean }).bypassDnd === true) {
        options.bypassDnd = true;
      }
      // Only pass sound for silent (null) or a bundled custom filename.
      // Omitting it uses the Android system default notification sound.
      if ('sound' in cfg) {
        options.sound = (cfg as { sound?: string | null }).sound ?? null;
      }
      return Notifications.setNotificationChannelAsync(id, options as any).catch(
        () => undefined,
      );
    }),
  );
  await ensureCallNotificationCategory();
  await ensureChatReplyCategory();
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

  // Android 13+ — explicit POST_NOTIFICATIONS (Expo alone can miss on some OEMs)
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    try {
      const { PermissionsAndroid } = require('react-native');
      const already = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (!already) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Notifications',
            message:
              'Luvstor needs notification access so you see new messages and calls.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          },
        );
      }
    } catch {
      /* fall through to expo-notifications */
    }
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

/** Present a local tray notification for an incoming call (Answer / Decline). */
export async function presentIncomingCallLocalNotification(opts: {
  callId: string;
  callerName: string;
  callType: 'voice' | 'video';
  callerId: string;
  callerPhoto?: string;
}): Promise<void> {
  // Clear any FCM lock-screen stub for this call before Answer/Decline tray
  try {
    await dismissCallNotifications(opts.callId);
  } catch {
    /* ignore */
  }

  // Prefer Notifee on Android (circular avatar + CALL category)
  if (Platform.OS === 'android') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { displayIncomingCallNotifee } = require('./callNotifee') as typeof import('./callNotifee');
      const shown = await displayIncomingCallNotifee(opts);
      if (shown) return;
    } catch {
      /* fall through to expo-notifications */
    }
  }

  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    await ensureCallNotificationCategory();
    // Instagram-style: name as title, call type as body
    const title = (opts.callerName || 'Incoming call').trim() || 'Incoming call';
    const body = opts.callType === 'video' ? 'Video call' : 'Audio call';
    const photo = String(opts.callerPhoto || '').trim();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        subtitle: 'Luvstor · now',
        body,
        sound: true,
        categoryIdentifier: INCOMING_CALL_CATEGORY,
        data: {
          type: 'call',
          action: 'incoming',
          callId: opts.callId,
          userId: opts.callerId,
          actorId: opts.callerId,
          actorName: title,
          actorPhoto: photo,
          callType: opts.callType,
          categoryId: INCOMING_CALL_CATEGORY,
          groupKey: `call:${opts.callId}`,
          notificationId: `call:incoming:${opts.callId}`,
          screen: 'call',
          deepLink: `/messages/${opts.callerId}`,
        },
        // iOS attachment shows circular-ish avatar when expanded
        ...(photo && /^https?:\/\//i.test(photo)
          ? {
              attachments: [
                {
                  identifier: `caller-${opts.callId}`,
                  url: photo,
                  typeHint: 'public.jpeg',
                },
              ],
            }
          : {}),
        ...(Platform.OS === 'android'
          ? {
              channelId: 'calls' as const,
              sticky: true,
              color: '#5A2FC7',
              priority: Notifications.AndroidNotificationPriority?.MAX,
            }
          : {}),
      },
      trigger: null,
      // Match FCM android.tag (`call:{callId}`) so tray collapses to one entry
      identifier: `call:${opts.callId}`,
    });
  } catch (err: any) {
    console.warn('[Push] local incoming call notify failed:', err?.message);
  }
}

/**
 * WhatsApp-style message tray while the app is in the foreground.
 * Same conversation reuses one identifier so rapid messages collapse.
 * Background / killed still rely on FCM from the server.
 */
export async function presentChatMessageNotification(opts: {
  senderId: string;
  senderName: string;
  body: string;
  senderPhoto?: string;
  senderGender?: string;
  roomId?: string;
  messageId?: string;
}): Promise<void> {
  if (isExpoGo) return;
  const Notifications = loadNotifications();
  if (!Notifications || !Device.isDevice) return;

  const senderId = String(opts.senderId || '');
  if (!senderId) return;

  const groupKey = opts.roomId
    ? `chat:${opts.roomId}`
    : `chat:${senderId}`;
  const title = (opts.senderName || 'New message').trim() || 'New message';
  const body = (opts.body || 'New message').trim() || 'New message';
  const photo = String(opts.senderPhoto || '').trim();

  try {
    await ensureChatReplyCategory();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        subtitle: 'now',
        body,
        sound: true,
        categoryIdentifier: CHAT_REPLY_CATEGORY,
        data: {
          type: 'chat',
          notificationId: opts.messageId
            ? `chat:${groupKey}:${opts.messageId}`
            : groupKey,
          deepLink: `/messages/${senderId}`,
          groupKey,
          actorId: senderId,
          userId: senderId,
          actorName: title,
          actorPhoto: photo,
          actorGender: opts.senderGender || '',
          screen: 'messages',
          messageId: opts.messageId || '',
          roomId: opts.roomId || '',
        },
        ...(photo && /^https?:\/\//i.test(photo)
          ? {
              attachments: [
                {
                  identifier: `msg-${senderId}`,
                  url: photo,
                  typeHint: 'public.jpeg',
                },
              ],
            }
          : {}),
        ...(Platform.OS === 'android'
          ? {
              channelId: 'messages' as const,
              color: '#5A2FC7',
              priority: Notifications.AndroidNotificationPriority?.MAX,
              sticky: false,
            }
          : {
              // iOS threads stack by conversation like WhatsApp
              threadIdentifier: groupKey,
            }),
      },
      trigger: null,
      // One shade entry per conversation — new msgs replace the previous
      identifier: groupKey,
    });
  } catch (err: any) {
    console.warn('[Push] local chat notify failed:', err?.message);
  }
}

/** Dismiss local/tray notifications for a call once answered or ended. */
export async function dismissCallNotifications(callId?: string | null): Promise<void> {
  if (!callId) return;
  const id = String(callId);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { cancelIncomingCallNotifee } = require('./callNotifee') as typeof import('./callNotifee');
    void cancelIncomingCallNotifee(id);
  } catch {
    /* ignore */
  }
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.dismissNotificationAsync(`call:${id}`).catch(() => undefined);
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => {
          const data = (n.request.content.data || {}) as Record<string, any>;
          const key = String(data.callId || data.groupKey || n.request.identifier || '');
          return (
            key === id ||
            key === `call:${id}` ||
            String(data.groupKey || '') === `call:${id}`
          );
        })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    /* ignore */
  }
}

function profileRouteFromData(data: Record<string, any> = {}) {
  const publicId = String(data.publicId || data.actorPublicId || '').trim();
  if (/^[A-Za-z]{4}\d{4}$/.test(publicId)) {
    return `/u/${publicId.toUpperCase()}`;
  }
  const userId = data.userId || data.actorId;
  return userId ? `/profile/${userId}` : '/notifications';
}

/**
 * Turn FCM / history deep links into Expo Router paths.
 * Empty `luvstor:///` and missing `/profile` used to open Unmatched Route.
 */
export function hrefToAppRoute(
  raw?: string | null,
  data: Record<string, any> = {},
): string {
  const href = String(raw || '').trim();
  if (!href || /^luvstor:\/{0,3}$/i.test(href)) {
    return '';
  }

  let path = href;
  if (/^luvstor:/i.test(path)) {
    path = path.replace(/^luvstor:\/+/i, '/');
    if (!path.startsWith('/')) path = `/${path}`;
  }

  const q = path.indexOf('?');
  const pathOnly = (q >= 0 ? path.slice(0, q) : path).replace(/\/+$/, '') || '/';
  if (pathOnly === '/') return '';

  if (/^\/profile\/edit$/i.test(pathOnly)) return '/(tabs)/profile';

  const profileSeg = pathOnly.match(/^\/profile\/([^/]+)$/i);
  if (profileSeg) {
    const id = decodeURIComponent(profileSeg[1]);
    if (/^[A-Za-z]{4}\d{4}$/.test(id)) return `/u/${id.toUpperCase()}`;
    if (id && id !== 'undefined') return `/profile/${id}`;
    return profileRouteFromData(data);
  }

  const uSeg = pathOnly.match(/^\/u\/([^/]+)$/i);
  if (uSeg && /^[A-Za-z]{4}\d{4}$/.test(uSeg[1])) {
    return `/u/${uSeg[1].toUpperCase()}`;
  }

  if (pathOnly.startsWith('/(tabs)/discover') || pathOnly === '/discover') {
    return '/(tabs)';
  }

  return pathOnly;
}

/** Resolve the in-app route for a notification payload. */
export function routeForData(data: Record<string, any> = {}) {
  if (
    (data.action === 'incoming' || data.type === 'call') &&
    data.callId &&
    !data.missed
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { setPendingIncomingCall } = require('./pendingIncomingCall');
      setPendingIncomingCall(data, 'open');
    } catch {
      /* ignore */
    }
    const userId = data.userId || data.actorId;
    return userId ? `/messages/${userId}` : '/(tabs)/chat';
  }

  const fromLink = hrefToAppRoute(data.deepLink, data);
  if (fromLink) return fromLink;

  const userId = data.userId || data.actorId;
  switch (data.type) {
    case 'chat':
    case 'call':
    case 'match':
    case 'friends':
      return userId ? `/messages/${userId}` : '/(tabs)/chat';
    case 'friend_request':
    case 'like':
    case 'profile_view':
    case 'suggestion':
      return profileRouteFromData(data);
    case 'token':
    case 'token_purchase':
    case 'token_low':
    case 'spin':
    case 'subscription':
      return '/(tabs)/token';
    case 'security':
      return '/settings/account';
    default:
      return '/notifications';
  }
}
