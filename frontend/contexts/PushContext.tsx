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
  configureForegroundHandler,
  dismissAll,
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
} from '../utils/push';

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
  const { refreshNotifUnread, notifUnreadCount } = useSocket();

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [fcmToken, setFcmToken] = useState<string | null>(null);

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const handledIds = useRef<string[]>([]);
  const userRef = useRef(user);
  userRef.current = user;

  const isChatVisible = useCallback((senderId?: string) => {
    if (!senderId) return false;
    return !!pathnameRef.current?.includes(`/messages/${senderId}`);
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
    (data: Record<string, any>) => {
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
      return false;
    }

    try {
      await ensureChannels();

      const permission = await requestPermission();
      setPermissionGranted(permission.granted);
      if (!permission.granted) return false;

      const token = await getFcmToken();
      if (!token) return false;
      setFcmToken(token);

      const authToken = await getAuthToken();
      if (!authToken) return false;

      return await syncToken(authToken, token);
    } catch (err: any) {
      console.warn('[Push] register failed:', err?.message);
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
      markHandled(String(data.notificationId || ''));
      refreshNotifUnread();
    });
    return () => sub.remove();
  }, [markHandled, refreshNotifUnread]);

  // Tapped — from foreground, background, or a cold start
  useEffect(() => {
    const sub = addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data || {}) as Record<
        string,
        any
      >;
      if (!markHandled(`tap:${data.notificationId || response.notification.request.identifier}`)) {
        return;
      }
      navigateTo(data);
      refreshNotifUnread();
    });
    return () => sub.remove();
  }, [markHandled, navigateTo, refreshNotifUnread]);

  // Cold start: the app was launched by tapping a notification
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
        const id = `tap:${data.notificationId || response.notification.request.identifier}`;
        if (!markHandled(id)) return;
        navigateTo(data);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [markHandled, navigateTo]);

  // Re-sync when the app returns to the foreground (token or count may have changed)
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== 'active' || !userRef.current) return;
      refreshNotifUnread();
      if (Platform.OS === 'android') ensureChannels();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [refreshNotifUnread]);

  // Keep the launcher badge in step with the backend unread count
  useEffect(() => {
    setBadge(notifUnreadCount);
  }, [notifUnreadCount]);

  // Opening a chat clears that conversation from the tray
  useEffect(() => {
    const match = pathname?.match(/\/messages\/([^/?]+)/);
    if (!match) return;
    const otherId = match[1];
    const roomId = userRef.current?.id
      ? [String(userRef.current.id), String(otherId)].sort().join('_')
      : null;
    if (roomId) dismissForGroup(`chat:${roomId}`);
  }, [pathname]);

  const clearConversation = useCallback((otherUserId: string) => {
    const me = userRef.current?.id;
    if (!me) return;
    const roomId = [String(me), String(otherUserId)].sort().join('_');
    dismissForGroup(`chat:${roomId}`);
  }, []);

  // Nothing unread → nothing should be left in the tray
  useEffect(() => {
    if (notifUnreadCount === 0) dismissAll();
  }, [notifUnreadCount]);

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
