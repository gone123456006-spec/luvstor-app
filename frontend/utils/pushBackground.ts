/**
 * Background / killed-app FCM handling (WhatsApp-style).
 *
 * Optional: requires a native rebuild that includes `expo-task-manager`.
 * If that native module is missing (older APK / Expo Go), this file no-ops —
 * FCM still delivers data; without TaskManager, Answer/Decline local tray
 * may not appear until the app process is awake.
 */
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

export const BACKGROUND_NOTIFICATION_TASK = 'LUVSTOR_BACKGROUND_NOTIFICATION';

const isExpoGo = isRunningInExpoGo();

let taskManagerUnavailableLogged = false;

function loadNotifications(): typeof import('expo-notifications') | null {
  if (isExpoGo) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications');
  } catch {
    return null;
  }
}

/**
 * Only load expo-task-manager when the native module is in this binary.
 * `require('expo-task-manager')` alone throws a redbox even inside try/catch
 * because requireNativeModule logs before throwing.
 */
function loadTaskManager(): typeof import('expo-task-manager') | null {
  if (isExpoGo) return null;
  try {
    // Prefer Expo's optional loader — avoids the ExpoTaskManager redbox
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expo = require('expo') as {
      requireOptionalNativeModule?: (name: string) => unknown;
    };
    const optional =
      typeof expo.requireOptionalNativeModule === 'function'
        ? expo.requireOptionalNativeModule
        : // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('expo-modules-core') as {
            requireOptionalNativeModule: (name: string) => unknown;
          }).requireOptionalNativeModule;

    if (!optional('ExpoTaskManager')) {
      if (!taskManagerUnavailableLogged) {
        taskManagerUnavailableLogged = true;
        console.warn(
          '[PushBG] ExpoTaskManager missing — rebuild the app (npx expo run:android) to enable background call actions. FCM trays still work.',
        );
      }
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-task-manager');
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, any>;
}

async function dismissCallTray(callId: string): Promise<void> {
  if (!callId) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { cancelIncomingCallNotifee } = require('./callNotifee');
    await cancelIncomingCallNotifee(callId);
  } catch {
    /* ignore */
  }
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.dismissNotificationAsync(`call:${callId}`).catch(
      () => undefined,
    );
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => {
          const data = asRecord(n.request.content.data);
          return (
            String(data.callId || '') === callId ||
            String(data.groupKey || '') === `call:${callId}` ||
            String(n.request.identifier || '') === `call:${callId}`
          );
        })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    /* ignore */
  }
}

/** Present Answer/Decline tray for an incoming call FCM data payload. */
async function presentCallFromPushData(data: Record<string, any>): Promise<void> {
  const callId = String(data.callId || '');
  if (!callId) return;

  const action = String(data.action || '').toLowerCase();
  const missed =
    data.missed === true ||
    data.missed === 'true' ||
    action === 'missed';

  if (action === 'clear' || action === 'ended' || action === 'cancel') {
    await dismissCallTray(callId);
    return;
  }

  if (missed) {
    // Missed replaces the ringing tray (same identifier)
    await dismissCallTray(callId);
    // System FCM already shows the missed notification when it has a
    // notification block — skip duplicate local missed tray.
    return;
  }

  if (action && action !== 'incoming') return;

  const callType = data.callType === 'video' ? 'video' : 'voice';
  // Instagram-style: name + Audio/Video call
  const title =
    String(data.actorName || data.callerName || data.title || '').trim() ||
    'Incoming call';
  const body =
    String(data.body || '').trim() ||
    (callType === 'video' ? 'Video call' : 'Audio call');
  const photo = String(data.actorPhoto || data.callerPhoto || '').trim();
  const callerId = String(data.userId || data.actorId || '');

  // Prefer Notifee on Android (circular avatar + CALL category)
  if (Platform.OS === 'android') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { displayIncomingCallNotifee } = require('./callNotifee');
      const shown = await displayIncomingCallNotifee({
        callId,
        callerName: title,
        callType,
        callerId,
        callerPhoto: photo,
      });
      if (shown) return;
    } catch {
      /* fall through */
    }
  }

  const Notifications = loadNotifications();
  if (!Notifications) return;

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('calls', {
        name: 'Incoming calls',
        description: 'Incoming voice and video calls',
        importance: 7,
        vibrationPattern: [0, 500, 500, 500, 500, 500],
        lightColor: '#5A2FC7',
        lockscreenVisibility: 1,
        enableVibrate: true,
        showBadge: true,
        enableLights: true,
      }).catch(() => undefined);
    }

    await Notifications.setNotificationCategoryAsync('incoming_call', [
      {
        identifier: 'ACCEPT_CALL',
        buttonTitle: 'Answer',
        options: {
          opensAppToForeground: true,
          isAuthenticationRequired: false,
        },
      },
      {
        identifier: 'DECLINE_CALL',
        buttonTitle: 'Decline',
        options: {
          opensAppToForeground: true,
          isDestructive: true,
          isAuthenticationRequired: false,
        },
      },
    ]).catch(() => undefined);

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        subtitle: 'Luvstor · now',
        body,
        sound: true,
        categoryIdentifier: 'incoming_call',
        data: {
          type: 'call',
          action: 'incoming',
          callId,
          userId: String(data.userId || data.actorId || ''),
          actorId: String(data.actorId || data.userId || ''),
          actorName: title,
          actorPhoto: photo,
          callType,
          categoryId: 'incoming_call',
          groupKey: String(data.groupKey || `call:${callId}`),
          notificationId: String(data.notificationId || `call:incoming:${callId}`),
          deepLink: String(data.deepLink || `/messages/${data.userId || data.actorId || ''}`),
          screen: 'call',
        },
        ...(photo && /^https?:\/\//i.test(photo)
          ? {
              attachments: [
                {
                  identifier: `caller-${callId}`,
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
      identifier: `call:${callId}`,
    });
  } catch (err: any) {
    console.warn('[PushBG] present call failed:', err?.message || err);
  }
}

function defineBackgroundTask(): boolean {
  const TaskManager = loadTaskManager();
  const Notifications = loadNotifications();
  if (!TaskManager || !Notifications) return false;

  try {
    if (TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) return true;
  } catch {
    /* continue — define anyway */
  }

  TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[PushBG] task error:', error.message);
      return;
    }

    const payload = asRecord(data);
    const remote = asRecord(payload.data);
    const contentData = asRecord(
      remote.data ||
        remote.message?.data ||
        asRecord(payload.notification).request?.content?.data ||
        remote,
    );

    const merged: Record<string, any> = {
      ...remote,
      ...contentData,
    };

    const type = String(merged.type || contentData.type || '');
    if (type === 'call') {
      await presentCallFromPushData(merged);
    }
  });
  return true;
}

/** Register the background task with expo-notifications (idempotent). */
export async function registerBackgroundNotificationTask(): Promise<void> {
  if (isExpoGo) return;
  if (!defineBackgroundTask()) return;

  const Notifications = loadNotifications();
  if (!Notifications?.registerTaskAsync) return;
  try {
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already registered/i.test(msg)) return;
    // Missing TaskManagerInterface on older binaries — ignore
    if (/TaskManage|ExpoTaskManager|native module/i.test(msg)) return;
    console.warn('[PushBG] registerTaskAsync:', msg);
  }
}

// Notifee killed-state Answer/Decline (must register at import time)
try {
  if (!isExpoGo && Platform.OS === 'android') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registerNotifeeBackgroundHandler } = require('./callNotifee');
    registerNotifeeBackgroundHandler();
  }
} catch {
  /* Notifee not in this binary yet */
}

// Safe on import: no-ops when native ExpoTaskManager is not in this binary
defineBackgroundTask();
void registerBackgroundNotificationTask();
