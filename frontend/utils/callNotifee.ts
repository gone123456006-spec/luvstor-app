/**
 * Instagram-like incoming call tray via Notifee (Android).
 *
 * Uses circular largeIcon + CALL category + Answer/Decline actions.
 * True Android 12 CallStyle (system green/red pills) is not in @notifee
 * 9.x yet — this is the closest supported look.
 *
 * Requires a native rebuild after adding @notifee/react-native.
 */
import { NativeModules, Platform } from 'react-native';
import { resolveMediaUrl } from './media';

/** Keep in sync with utils/push.ts — avoid importing push (circular). */
const CALL_ACTION_ACCEPT = 'ACCEPT_CALL';
const CALL_ACTION_DECLINE = 'DECLINE_CALL';

export const NOTIFEE_CALL_CHANNEL = 'calls_notifee';
export const NOTIFEE_CALL_ID_PREFIX = 'call:';

type IncomingOpts = {
  callId: string;
  callerName: string;
  callType: 'voice' | 'video';
  callerId: string;
  callerPhoto?: string;
};

let channelReady = false;
let foregroundBound = false;
let backgroundBound = false;
let notifeeModule: typeof import('@notifee/react-native') | null | undefined;
let missingNativeLogged = false;

/**
 * Notifee's JS entry throws on import when the native binary lacks NotifeeApiModule.
 * Probe NativeModules first — never require until a rebuilt APK includes it.
 */
function hasNotifeeNative(): boolean {
  return !!NativeModules?.NotifeeApiModule;
}

function loadNotifee(): typeof import('@notifee/react-native') | null {
  if (Platform.OS !== 'android') return null;
  if (notifeeModule !== undefined) return notifeeModule;

  if (!hasNotifeeNative()) {
    notifeeModule = null;
    if (!missingNativeLogged) {
      missingNativeLogged = true;
      console.warn(
        '[Notifee] native module missing — rebuild the Android app to enable Instagram-style call trays. Falling back to expo-notifications.',
      );
    }
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifeeModule = require('@notifee/react-native');
    return notifeeModule;
  } catch (err: any) {
    notifeeModule = null;
    console.warn('[Notifee] load failed:', err?.message);
    return null;
  }
}

export function isNotifeeAvailable(): boolean {
  return !!loadNotifee();
}

async function ensureCallChannel(
  notifeeMod: typeof import('@notifee/react-native'),
): Promise<string> {
  if (channelReady) return NOTIFEE_CALL_CHANNEL;
  const { AndroidImportance, AndroidVisibility } = notifeeMod;
  await notifeeMod.default.createChannel({
    id: NOTIFEE_CALL_CHANNEL,
    name: 'Incoming calls',
    description: 'Incoming voice and video calls',
    // MAX heads-up on lock screen / Doze (falls back if enum missing)
    importance: (AndroidImportance as any).MAX ?? AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    vibration: true,
    sound: 'default',
    lights: true,
    lightColor: '#5A2FC7',
  });
  channelReady = true;
  return NOTIFEE_CALL_CHANNEL;
}

function absolutePhoto(url?: string): string | undefined {
  const raw = String(url || '').trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  const resolved = resolveMediaUrl(raw);
  return resolved && /^https?:\/\//i.test(resolved) ? resolved : undefined;
}

function intentFromActionId(actionId: string): 'open' | 'accept' | 'decline' {
  const id = String(actionId || '');
  if (
    id === CALL_ACTION_ACCEPT ||
    id.toLowerCase() === 'answer' ||
    id.toLowerCase() === 'accept'
  ) {
    return 'accept';
  }
  if (id === CALL_ACTION_DECLINE || id.toLowerCase() === 'decline') {
    return 'decline';
  }
  return 'open';
}

/**
 * Show Instagram-style incoming call notification.
 * Returns true if Notifee displayed it; false → caller should fall back.
 */
export async function displayIncomingCallNotifee(
  opts: IncomingOpts,
): Promise<boolean> {
  const notifeeMod = loadNotifee();
  if (!notifeeMod) return false;

  const notifee = notifeeMod.default;
  const { AndroidCategory, AndroidImportance, AndroidVisibility } = notifeeMod;

  try {
    const channelId = await ensureCallChannel(notifeeMod);
    const title = (opts.callerName || 'Incoming call').trim() || 'Incoming call';
    const body = opts.callType === 'video' ? 'Video call' : 'Audio call';
    const photo = absolutePhoto(opts.callerPhoto);
    const callId = String(opts.callId);
    const data = {
      type: 'call',
      action: 'incoming',
      callId,
      userId: opts.callerId,
      actorId: opts.callerId,
      actorName: title,
      actorPhoto: photo || '',
      callType: opts.callType,
      categoryId: 'incoming_call',
      groupKey: `call:${callId}`,
      notificationId: `call:incoming:${callId}`,
      deepLink: `/messages/${opts.callerId}`,
      screen: 'call',
    };

    await notifee.displayNotification({
      id: `${NOTIFEE_CALL_ID_PREFIX}${callId}`,
      title,
      subtitle: 'Luvstor · now',
      body,
      data,
      android: {
        channelId,
        category: AndroidCategory.CALL,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        color: '#5A2FC7',
        smallIcon: 'notification_icon',
        ...(photo
          ? {
              largeIcon: photo,
              circularLargeIcon: true,
            }
          : {}),
        ongoing: true,
        autoCancel: false,
        loopSound: true,
        lightUpScreen: true,
        pressAction: {
          id: 'default',
          launchActivity: 'default',
        },
        fullScreenAction: {
          id: 'default',
          launchActivity: 'default',
        },
        actions: [
          {
            title: 'Decline',
            pressAction: {
              id: CALL_ACTION_DECLINE,
              launchActivity: 'default',
            },
          },
          {
            title: 'Answer',
            pressAction: {
              id: CALL_ACTION_ACCEPT,
              launchActivity: 'default',
            },
          },
        ],
        tag: `call:${callId}`,
      },
    });
    return true;
  } catch (err: any) {
    console.warn('[Notifee] display incoming call failed:', err?.message);
    return false;
  }
}

export async function cancelIncomingCallNotifee(
  callId?: string | null,
): Promise<void> {
  const notifeeMod = loadNotifee();
  if (!notifeeMod || !callId) return;
  const id = String(callId);
  try {
    await notifeeMod.default.cancelNotification(
      `${NOTIFEE_CALL_ID_PREFIX}${id}`,
      `call:${id}`,
    );
    await notifeeMod.default.cancelNotification(
      `${NOTIFEE_CALL_ID_PREFIX}${id}`,
    );
  } catch {
    /* ignore */
  }
}

/**
 * Killed / background Answer·Decline — register once at app import time.
 */
export function registerNotifeeBackgroundHandler(): void {
  if (backgroundBound) return;
  const notifeeMod = loadNotifee();
  if (!notifeeMod) return;

  try {
    backgroundBound = true;
    const { EventType } = notifeeMod;
    notifeeMod.default.onBackgroundEvent(async ({ type, detail }) => {
      const data = (detail.notification?.data || {}) as Record<string, any>;
      const actionId = String(detail.pressAction?.id || '');
      const callId = String(data.callId || '');

      if (type !== EventType.ACTION_PRESS && type !== EventType.PRESS) return;
      if (!callId || (data.action !== 'incoming' && data.type !== 'call')) return;

      const intent = intentFromActionId(actionId);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { setPendingIncomingCall } = require('./pendingIncomingCall');
        setPendingIncomingCall(data, intent);
        void cancelIncomingCallNotifee(callId);
        if (intent === 'decline') {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { declineCallHttp } = require('./callHttpActions');
          void declineCallHttp(callId);
        }
      } catch {
        /* ignore */
      }
    });
  } catch (err: any) {
    backgroundBound = false;
    console.warn('[Notifee] background handler unavailable:', err?.message);
  }
}

/**
 * Foreground Answer / Decline — call from PushProvider with navigate callback.
 */
export function bindNotifeeCallEvents(
  onNavigate?: (
    data: Record<string, any>,
    intent: 'open' | 'accept' | 'decline',
  ) => void,
): () => void {
  if (foregroundBound) return () => undefined;
  const notifeeMod = loadNotifee();
  if (!notifeeMod) return () => undefined;

  try {
    foregroundBound = true;
    const { EventType } = notifeeMod;
    const unsubFg = notifeeMod.default.onForegroundEvent(({ type, detail }) => {
      const data = (detail.notification?.data || {}) as Record<string, any>;
      const actionId = String(detail.pressAction?.id || '');
      const callId = String(data.callId || '');

      if (type !== EventType.ACTION_PRESS && type !== EventType.PRESS) return;
      if (!callId || (data.action !== 'incoming' && data.type !== 'call')) return;

      const intent = intentFromActionId(actionId);
      void cancelIncomingCallNotifee(callId);
      onNavigate?.(data, intent);
    });

    return () => {
      unsubFg();
      foregroundBound = false;
    };
  } catch (err: any) {
    foregroundBound = false;
    console.warn('[Notifee] foreground events unavailable:', err?.message);
    return () => undefined;
  }
}
