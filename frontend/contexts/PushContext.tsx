/**
 * Push notification lifecycle for the whole app.
 *
 * Owns permission prompting, FCM token registration/refresh, foreground and
 * background handlers, tap deep-linking, badge sync and de-duplication.
 * Mounted once in the root layout, below AuthProvider and SocketProvider.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { usePathname, useRouter } from 'expo-router';

import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { getAuthToken } from '../utils/auth';
import {
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  addPushTokenListener,
  CALL_ACTION_ACCEPT,
  CALL_ACTION_DECLINE,
  CHAT_ACTION_REPLY,
  configureForegroundHandler,
  dismissCallNotifications,
  dismissForGroup,
  ensureChannels,
  getFcmToken,
  getLastNotificationResponseAsync,
  isExpoGo,
  requestPermission,
  routeForData,
  setBadge,
  syncToken,
  unregisterToken,
  setPushTrayReady,
} from '../utils/push';
import {
  CALL_ACTION_END,
  emitOngoingCallEnd,
  emitOngoingCallOpen,
} from '../utils/callOngoing';
import { setPendingIncomingCall } from '../utils/pendingIncomingCall';
import { declineCallHttp } from '../utils/callHttpActions';
import { registerBackgroundNotificationTask } from '../utils/pushBackground';
import { bindNotifeeCallEvents } from '../utils/callNotifee';
import { apiRequest } from '../utils/api';

type PushContextValue = {
  /** null while the permission state is still being resolved */
  permissionGranted: boolean | null;
  pushEnabled: boolean;
  fcmToken: string | null;
  /** Re-prompt / re-register, e.g. from a settings toggle */
  register: () => Promise<boolean>;
  /** Clear the tray for one conversation (call when a chat is opened) */
  clearConversation: (otherUserId: string) => void;
};

const PushContext = createContext<PushContextValue | null>(null);

/** Notification ids already handled, so a tap never routes twice. */
const HANDLED_LIMIT = 50;

export function PushProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { refreshNotifUnread, unreadCount, refreshUnread } = useSocket();

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [fcmToken, setFcmToken] = useState<string | null>(null);

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const handledIds = useRef<string[]>([]);
  const userRef = useRef(user);
  userRef.current = user;

  const isChatVisible = useCallback((senderId?: string) => {
    if (!senderId) return false;
    const path = pathnameRef.current || '';
    // Match /messages/:id even with query strings or nested segments
    return (
      path === `/messages/${senderId}` ||
      path.startsWith(`/messages/${senderId}?`) ||
      path.startsWith(`/messages/${senderId}/`) ||
      path.includes(`/messages/${senderId}`)
    );
  }, []);

  const markHandled = useCallback((id?: string) => {
    if (!id) return false;
    if (handledIds.current.includes(id)) return false;
    handledIds.current.push(id);
    if (handledIds.current.length > HANDLED_LIMIT) {
      handledIds.current = handledIds.current.slice(-HANDLED_LIMIT);
    }
    return true;
  }, []);

  const navigateTo = useCallback(
    (data: Record<string, any>, intent: 'open' | 'accept' | 'decline' = 'open') => {
      if (data?.callId && (data?.action === 'incoming' || data?.type === 'call')) {
        setPendingIncomingCall(data, intent);
        const callId = String(data.callId);
        void dismissCallNotifications(callId);
        if (intent === 'decline') {
          // Decline immediately over HTTP — works even before socket connects
          void declineCallHttp(callId);
          return;
        }
      }
      const route = routeForData(data);
      // Give the router a tick — a cold start tap can fire before mount
      setTimeout(() => {
        try {
          if (route.startsWith('/messages/')) {
            router.push({
              pathname: '/messages/[id]',
              params: {
                id: route.split('/messages/')[1],
                name: data.actorName || 'User',
                photo: data.actorPhoto || '',
                gender: data.actorGender || '',
                isOnline: 'false',
              },
            });
          } else {
            router.push(route as any);
          }
        } catch (err: any) {
          console.warn('[Push] Navigation failed:', err?.message);
        }
      }, 120);
    },
    [router],
  );

  /** Ask for permission, fetch the token and register it with the backend. */
  const register = useCallback(async (): Promise<boolean> => {
    if (isExpoGo) {
      // Expo Go dropped remote push support; a dev build is required
      setPermissionGranted(false);
      setPushTrayReady(false);
      return false;
    }

    try {
      await ensureChannels();
      await registerBackgroundNotificationTask();

      const permission = await requestPermission();
      setPermissionGranted(permission.granted);
      if (!permission.granted) {
        setPushTrayReady(false);
        return false;
      }

      const token = await getFcmToken();
      if (!token) {
        console.warn('[Push] No FCM token — message tray pushes will not work');
        setPushTrayReady(false);
        return false;
      }
      setFcmToken(token);

      const authToken = await getAuthToken();
      if (!authToken) {
        setPushTrayReady(false);
        return false;
      }

      // Force upsert so backend always has this install after login / resume
      const ok = await syncToken(authToken, token, { force: true });
      setPushTrayReady(ok);
      if (!ok) {
        console.warn('[Push] Token register failed — retry on next resume');
      } else {
        console.log('[Push] FCM token registered with backend');
      }
      return ok;
    } catch (err: any) {
      console.warn('[Push] register failed:', err?.message);
      setPushTrayReady(false);
      return false;
    }
  }, []);

  // Foreground presentation rules — set once, before any listener fires
  useEffect(() => {
    configureForegroundHandler(isChatVisible);
  }, [isChatVisible]);

  // Register on login; clean up on logout
  useEffect(() => {
    if (!user) {
      setFcmToken(null);
      setPushTrayReady(false);
      getAuthToken()
        .then((t) => unregisterToken(t))
        .catch(() => undefined);
      setBadge(0);
      return;
    }
    register();
  }, [user, register]);

  // FCM rotates tokens — push the new one immediately
  useEffect(() => {
    if (isExpoGo) return;
    const sub = addPushTokenListener(async (token) => {
      const next = typeof token?.data === 'string' ? token.data : null;
      if (!next) return;
      setFcmToken(next);
      const authToken = await getAuthToken();
      if (authToken) await syncToken(authToken, next, { force: true });
    });
    return () => sub.remove();
  }, []);

  // Received while the app is in the foreground
  useEffect(() => {
    const sub = addNotificationReceivedListener((notification) => {
      const data = (notification.request.content.data || {}) as Record<string, any>;
      const action = String(data.action || '').toLowerCase();
      if (
        data.type === 'call' &&
        (action === 'clear' || action === 'ended' || action === 'cancel') &&
        data.callId
      ) {
        void dismissCallNotifications(String(data.callId));
        return;
      }
      markHandled(String(data.notificationId || data.messageId || ''));
      refreshNotifUnread();
      refreshUnread();
    });
    return () => sub.remove();
  }, [markHandled, refreshNotifUnread, refreshUnread]);

  // Tapped — from foreground, background, or a cold start (incl. Accept / Decline / End)
  useEffect(() => {
    const sub = addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data || {}) as Record<
        string,
        any
      >;
      const actionId = String(response.actionIdentifier || '');

      // Direct reply from message shade
      if (
        actionId === CHAT_ACTION_REPLY ||
        actionId === 'REPLY_MESSAGE' ||
        actionId.toLowerCase() === 'reply'
      ) {
        const text = String(
          (response as any).userText ||
            (response as any).notification?.request?.content?.data?.userText ||
            '',
        ).trim();
        const toUserId = String(data.actorId || data.userId || '');
        if (
          text &&
          toUserId &&
          markHandled(
            `reply:${data.messageId || response.notification.request.identifier}`,
          )
        ) {
          void (async () => {
            try {
              const token = await getAuthToken();
              if (!token) return;
              await apiRequest('/api/chat/send', token, {
                method: 'POST',
                body: JSON.stringify({
                  receiverId: toUserId,
                  text,
                  type: 'text',
                }),
              });
              const roomId = data.roomId
                ? String(data.roomId)
                : userRef.current?.id
                  ? [String(userRef.current.id), toUserId].sort().join('_')
                  : '';
              if (roomId) dismissForGroup(`chat:${roomId}`);
              dismissForGroup(`chat:${toUserId}`);
              refreshUnread();
            } catch (err: any) {
              console.warn('[Push] reply failed:', err?.message);
            }
          })();
        }
        return;
      }

      // Ongoing call notification — End call action
      if (
        actionId === CALL_ACTION_END ||
        actionId === 'END_CALL' ||
        actionId.toLowerCase() === 'end call' ||
        actionId.toLowerCase() === 'end'
      ) {
        if (
          !markHandled(
            `end:${data.callId || response.notification.request.identifier}`,
          )
        ) {
          return;
        }
        emitOngoingCallEnd(String(data.callId || ''));
        return;
      }

      // Tap ongoing call notification body → restore call UI
      if (
        data?.action === 'ongoing' ||
        data?.categoryId === 'ongoing_call' ||
        String(response.notification.request.identifier || '').startsWith(
          'ongoing:',
        )
      ) {
        if (
          !markHandled(
            `open-ongoing:${data.callId || response.notification.request.identifier}`,
          )
        ) {
          return;
        }
        emitOngoingCallOpen(String(data.callId || ''));
        return;
      }

      let intent: 'open' | 'accept' | 'decline' = 'open';
      if (
        actionId === CALL_ACTION_ACCEPT ||
        actionId === 'ACCEPT_CALL' ||
        actionId.toLowerCase() === 'accept' ||
        actionId.toLowerCase() === 'answer'
      ) {
        intent = 'accept';
      } else if (
        actionId === CALL_ACTION_DECLINE ||
        actionId === 'DECLINE_CALL' ||
        actionId.toLowerCase() === 'decline'
      ) {
        intent = 'decline';
      }

      if (
        !markHandled(
          `tap:${intent}:${data.notificationId || response.notification.request.identifier}`,
        )
      ) {
        return;
      }
      navigateTo(data, intent);
      refreshNotifUnread();
      // Opening a chat from a message tap clears that conversation tray
      if (data.type === 'chat') {
        const otherId = String(data.actorId || data.userId || '');
        if (data.groupKey) dismissForGroup(String(data.groupKey));
        if (otherId) dismissForGroup(`chat:${otherId}`);
      }
    });
    return () => sub.remove();
  }, [markHandled, navigateTo, refreshNotifUnread, refreshUnread]);

  // Cold start: the app was launched by tapping a notification (incl. Answer/Decline)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await getLastNotificationResponseAsync();
        if (cancelled || !response || !userRef.current) return;
        const data = (response.notification.request.content.data || {}) as Record<
          string,
          any
        >;
        const actionId = String(response.actionIdentifier || '');
        let intent: 'open' | 'accept' | 'decline' = 'open';
        if (
          actionId === CALL_ACTION_ACCEPT ||
          actionId === 'ACCEPT_CALL' ||
          actionId.toLowerCase() === 'accept' ||
          actionId.toLowerCase() === 'answer'
        ) {
          intent = 'accept';
        } else if (
          actionId === CALL_ACTION_DECLINE ||
          actionId === 'DECLINE_CALL' ||
          actionId.toLowerCase() === 'decline'
        ) {
          intent = 'decline';
        }
        const id = `tap:${intent}:${data.notificationId || response.notification.request.identifier}`;
        if (!markHandled(id)) return;
        navigateTo(data, intent);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [markHandled, navigateTo]);

  // Notifee Answer / Decline (Android Instagram-style call tray)
  useEffect(() => {
    if (Platform.OS !== 'android' || isExpoGo) return;
    return bindNotifeeCallEvents((data, intent) => {
      const id = `notifee:${intent}:${data.notificationId || data.callId}`;
      if (!markHandled(id)) return;
      navigateTo(data, intent);
      refreshNotifUnread();
    });
  }, [markHandled, navigateTo, refreshNotifUnread]);

  // Re-sync when the app returns to the foreground (token or count may have changed)
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== 'active' || !userRef.current) return;
      refreshNotifUnread();
      refreshUnread();
      if (Platform.OS === 'android') ensureChannels();
      // Token may have rotated while backgrounded
      register().catch(() => undefined);
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [refreshNotifUnread, refreshUnread, register]);

  // Launcher badge = chat unread (WhatsApp). Notification-center unread is separate.
  useEffect(() => {
    setBadge(unreadCount);
  }, [unreadCount]);

  // Opening a chat clears that conversation from the tray
  useEffect(() => {
    const match = pathname?.match(/\/messages\/([^/?]+)/);
    if (!match) return;
    const otherId = match[1];
    const roomId = userRef.current?.id
      ? [String(userRef.current.id), String(otherId)].sort().join('_')
      : null;
    if (roomId) dismissForGroup(`chat:${roomId}`);
    dismissForGroup(`chat:${otherId}`);
  }, [pathname]);

  const clearConversation = useCallback((otherUserId: string) => {
    const me = userRef.current?.id;
    if (!me) return;
    const roomId = [String(me), String(otherUserId)].sort().join('_');
    dismissForGroup(`chat:${roomId}`);
  }, []);

  // Do NOT dismissAll when notification-center unread is 0 — that wiped chat trays.
  const value = useMemo(
    () => ({
      permissionGranted,
      pushEnabled: !!permissionGranted && !!fcmToken,
      fcmToken,
      register,
      clearConversation,
    }),
    [permissionGranted, fcmToken, register, clearConversation],
  );

  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush() {
  const ctx = useContext(PushContext);
  if (!ctx) throw new Error('usePush must be used within PushProvider');
  return ctx;
}
