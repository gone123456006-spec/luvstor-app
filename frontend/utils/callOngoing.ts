/**
 * Ongoing call foreground service + notification (Android).
 *
 * Play-compliant: uses microphone (+ camera when video cam is on) FGS types only.
 * Starts only during an active user-initiated call after runtime grants, while
 * the app is visible (while-in-use). Stops immediately on hangup.
 * Force-stop by the OS ends the process — FGS cannot continue after that.
 *
 * Falls back to a sticky expo-notifications tray when the native module is
 * missing (Expo Go / stale binary); that fallback is not an FGS.
 */
import {
  AppState,
  DeviceEventEmitter,
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import Constants from 'expo-constants';

export const CALL_ONGOING_END_EVENT = 'luvstor_call_end_requested';
export const CALL_ONGOING_OPEN_EVENT = 'luvstor_call_open_requested';
export const CALL_ACTION_END = 'END_CALL';

export type OngoingCallInfo = {
  callId: string;
  peerName: string;
  callType: 'voice' | 'video';
  hasCamera: boolean;
  /** WhatsApp-style status line */
  status: 'calling' | 'ringing' | 'connected';
  startedAt: number;
};

type NativeCallFg = {
  start: (
    callId: string,
    peerName: string,
    callType: string,
    hasCamera: boolean,
    status?: string,
  ) => Promise<boolean>;
  update: (
    callId: string,
    peerName: string,
    callType: string,
    durationSec: number,
    hasCamera: boolean,
    status?: string,
  ) => Promise<boolean>;
  stop: () => Promise<boolean>;
  isAvailable: () => Promise<boolean>;
  enterPictureInPicture: () => Promise<boolean>;
  addListener?: (event: string) => void;
  removeListeners?: (count: number) => void;
};

const Native: NativeCallFg | undefined =
  Platform.OS === 'android'
    ? (NativeModules.LuvstorCallForeground as NativeCallFg | undefined)
    : undefined;

let active: OngoingCallInfo | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let usingNative = false;
let fallbackNotifId: string | null = null;

function loadNotifications(): typeof import('expo-notifications') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications');
  } catch {
    return null;
  }
}

export function isCallForegroundNativeAvailable(): boolean {
  return !!Native;
}

async function ensureNotifPermissionSoft(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PermissionsAndroid } = require('react-native');
    if (Number(Platform.Version) >= 33) {
      const ok = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (ok) return true;
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        {
          title: 'Call notifications',
          message:
            'Luvstor shows an ongoing call notification so you can return to or end the call while using other apps.',
          buttonPositive: 'Allow',
          buttonNegative: 'Not now',
        },
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch {
    /* ignore */
  }
  const Notifications = loadNotifications();
  if (!Notifications) return false;
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    if (!cur.canAskAgain) return false;
    const next = await Notifications.requestPermissionsAsync();
    return !!next.granted;
  } catch {
    return false;
  }
}

async function startFallback(info: OngoingCallInfo) {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync('ongoing_calls', {
      name: 'Ongoing calls',
      importance: Notifications.AndroidImportance.DEFAULT,
      bypassDnd: false,
      sound: undefined,
      vibrationPattern: [0],
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: false,
    });
  } catch {
    /* ignore */
  }

  try {
    await Notifications.setNotificationCategoryAsync('ongoing_call', [
      {
        identifier: 'END_CALL',
        buttonTitle: 'End call',
        options: {
          opensAppToForeground: true,
          isDestructive: true,
          isAuthenticationRequired: false,
        },
      },
    ]);
  } catch {
    /* ignore */
  }

  const typeLabel = info.callType === 'video' ? 'Video call' : 'Voice call';
  const statusLabel =
    info.status === 'calling'
      ? 'Calling…'
      : info.status === 'ringing'
        ? 'Ringing…'
        : 'Ongoing';
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: info.peerName || 'Luvstor call',
      body: `${typeLabel} · ${statusLabel}`,
      data: {
        type: 'call',
        action: 'ongoing',
        callId: info.callId,
        callType: info.callType,
        categoryId: 'ongoing_call',
        status: info.status,
      },
      categoryIdentifier: 'ongoing_call',
      sticky: true,
      autoDismiss: false,
      sound: undefined,
      ...(Platform.OS === 'android'
        ? {
            channelId: 'ongoing_calls',
            priority: Notifications.AndroidNotificationPriority.DEFAULT,
          }
        : {}),
    },
    trigger: null,
    identifier: `ongoing:${info.callId}`,
  });
  fallbackNotifId = id || `ongoing:${info.callId}`;
}

async function updateFallback(info: OngoingCallInfo, durationSec: number) {
  if (!fallbackNotifId) return;
  const Notifications = loadNotifications();
  if (!Notifications) return;
  const typeLabel = info.callType === 'video' ? 'Video call' : 'Voice call';
  let statusLabel = 'Ongoing';
  if (info.status === 'calling') statusLabel = 'Calling…';
  else if (info.status === 'ringing') statusLabel = 'Ringing…';
  else if (durationSec > 0) {
    const m = Math.floor(durationSec / 60);
    const s = durationSec % 60;
    statusLabel = `${m}:${String(s).padStart(2, '0')}`;
  }
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: info.peerName || 'Luvstor call',
        body: `${typeLabel} · ${statusLabel}`,
        data: {
          type: 'call',
          action: 'ongoing',
          callId: info.callId,
          callType: info.callType,
          categoryId: 'ongoing_call',
          status: info.status,
        },
        categoryIdentifier: 'ongoing_call',
        sticky: true,
        autoDismiss: false,
        sound: undefined,
        ...(Platform.OS === 'android'
          ? {
              channelId: 'ongoing_calls',
              priority: Notifications.AndroidNotificationPriority.DEFAULT,
            }
          : {}),
      },
      trigger: null,
      identifier: fallbackNotifId,
    });
  } catch {
    /* ignore */
  }
}

async function stopFallback() {
  const Notifications = loadNotifications();
  if (Notifications && fallbackNotifId) {
    try {
      await Notifications.dismissNotificationAsync(fallbackNotifId);
    } catch {
      /* ignore */
    }
  }
  fallbackNotifId = null;
}

function clearTick() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function startTick() {
  clearTick();
  tickTimer = setInterval(() => {
    if (!active) return;
    const durationSec = Math.max(
      0,
      Math.floor((Date.now() - active.startedAt) / 1000),
    );
    void (async () => {
      if (usingNative && Native) {
        try {
          await Native.update(
            active!.callId,
            active!.peerName,
            active!.callType,
            durationSec,
            active!.hasCamera,
            active!.status,
          );
        } catch {
          /* ignore */
        }
      } else {
        await updateFallback(active!, durationSec);
      }
    })();
  }, 1000);
}

async function hasRequiredRuntimePermissions(
  callType: 'voice' | 'video',
  hasCamera: boolean,
): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const mic = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (!mic) return false;
    if (callType === 'video' && hasCamera) {
      const cam = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.CAMERA,
      );
      if (!cam) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Microphone/camera FGS may only be created while the app is user-visible
 * (while-in-use). If already running, updates from background are OK.
 */
function canStartMicCameraFgsFromHere(): boolean {
  if (Platform.OS !== 'android') return true;
  const state = AppState.currentState;
  return state === 'active' || state === 'inactive';
}

/**
 * Start (or refresh) the ongoing call notification / FGS.
 * Safe to call repeatedly when phase becomes connecting/connected.
 */
export async function startOngoingCall(info: {
  callId: string;
  peerName: string;
  callType: 'voice' | 'video';
  hasCamera?: boolean;
  status?: 'calling' | 'ringing' | 'connected';
}): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!info.callId) return;

  const next: OngoingCallInfo = {
    callId: String(info.callId),
    peerName: String(info.peerName || 'Call').trim() || 'Call',
    callType: info.callType === 'video' ? 'video' : 'voice',
    hasCamera: info.hasCamera ?? info.callType === 'video',
    status: info.status || 'connected',
    startedAt: active?.callId === info.callId ? active.startedAt : Date.now(),
  };
  // Connected timer starts when we first enter connected
  if (
    next.status === 'connected' &&
    active?.callId === info.callId &&
    active.status !== 'connected'
  ) {
    next.startedAt = Date.now();
  }
  active = next;

  // Soft ask for notifications — denial must not end the call
  void ensureNotifPermissionSoft();

  // Downgrade camera FGS type if CAMERA not granted (audio-only video call)
  if (next.callType === 'video' && next.hasCamera) {
    try {
      const camOk = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.CAMERA,
      );
      if (!camOk) next.hasCamera = false;
    } catch {
      next.hasCamera = false;
    }
  }

  const permsOk = await hasRequiredRuntimePermissions(
    next.callType,
    next.hasCamera,
  );
  if (!permsOk) {
    // Do not start typed FGS without while-in-use grants (Play / Android 14+)
    console.warn(
      '[CallOngoing] skip FGS — RECORD_AUDIO not granted yet',
    );
    return;
  }

  if (Platform.OS === 'android' && Native) {
    try {
      if (!usingNative && !canStartMicCameraFgsFromHere()) {
        // Cannot legally create mic/camera FGS from background; keep sticky fallback
        console.warn(
          '[CallOngoing] skip FGS start from background — using sticky fallback',
        );
        usingNative = false;
        await startFallback(next);
        startTick();
        return;
      }
      if (usingNative) {
        const durationSec = Math.max(
          0,
          Math.floor((Date.now() - next.startedAt) / 1000),
        );
        await Native.update(
          next.callId,
          next.peerName,
          next.callType,
          durationSec,
          next.hasCamera,
          next.status,
        );
      } else {
        await Native.start(
          next.callId,
          next.peerName,
          next.callType,
          next.hasCamera,
          next.status,
        );
        usingNative = true;
      }
      startTick();
      return;
    } catch (err: any) {
      console.warn('[CallOngoing] native FGS start failed:', err?.message);
      usingNative = false;
    }
  }

  // Fallback sticky notification (not an FGS — OEM may still kill capture)
  usingNative = false;
  await startFallback(next);
  startTick();
}

export async function stopOngoingCall(): Promise<void> {
  clearTick();
  active = null;
  if (usingNative && Native) {
    try {
      await Native.stop();
    } catch {
      /* ignore */
    }
  }
  usingNative = false;
  await stopFallback();
}

/** Android system PiP for video calls when the user leaves the app. */
export async function enterCallPictureInPicture(): Promise<boolean> {
  if (Platform.OS !== 'android' || !Native) return false;
  try {
    return !!(await Native.enterPictureInPicture());
  } catch {
    return false;
  }
}

export function emitOngoingCallEnd(callId?: string) {
  DeviceEventEmitter.emit(CALL_ONGOING_END_EVENT, {
    callId: String(callId || ''),
  });
}

export function emitOngoingCallOpen(callId?: string) {
  DeviceEventEmitter.emit(CALL_ONGOING_OPEN_EVENT, {
    callId: String(callId || ''),
  });
}

export function subscribeOngoingCallEnd(
  handler: (callId: string) => void,
): () => void {
  const jsSub = DeviceEventEmitter.addListener(
    CALL_ONGOING_END_EVENT,
    (payload: { callId?: string }) => {
      handler(String(payload?.callId || ''));
    },
  );

  if (Platform.OS !== 'android' || !Native) {
    return () => jsSub.remove();
  }
  const emitter = new NativeEventEmitter(NativeModules.LuvstorCallForeground);
  const nativeSub = emitter.addListener(
    'luvstor_call_end_requested',
    (payload: { callId?: string }) => {
      handler(String(payload?.callId || ''));
    },
  );
  return () => {
    jsSub.remove();
    nativeSub.remove();
  };
}

export function subscribeOngoingCallOpen(
  handler: (callId: string) => void,
): () => void {
  const sub = DeviceEventEmitter.addListener(
    CALL_ONGOING_OPEN_EVENT,
    (payload: { callId?: string }) => {
      handler(String(payload?.callId || ''));
    },
  );
  return () => sub.remove();
}

export function getActiveOngoingCall(): OngoingCallInfo | null {
  return active;
}

/** True when running inside a native rebuild that includes the FGS module. */
export function hasNativeCallForeground(): boolean {
  return (
    Platform.OS === 'android' &&
    !!Native &&
    Constants.appOwnership !== 'expo'
  );
}
