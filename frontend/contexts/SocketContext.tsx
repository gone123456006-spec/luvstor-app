import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { io, Socket } from 'socket.io-client';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from './AuthContext';
import { API_BASE, apiRequest } from '../utils/api';
import { getAuthToken } from '../utils/auth';
import { fetchNotificationUnread } from '../utils/notifications';
import { messagePreviewText } from '../utils/chatListPreviewPatch';

type ToastKind = 'message' | 'like' | 'unlike' | 'friends';

type ToastPayload = {
  id: string;
  kind: ToastKind;
  title: string;
  body: string;
  photo?: string;
  fromUserId?: string;
  gender?: string;
};

type ProfileUpdatePayload = {
  userId: string;
  publicId?: string;
  name?: string;
  bio?: string;
  photo?: string;
  photos?: string[];
  age?: number | null;
  gender?: string;
  height?: number | null;
  interests?: string[];
  relationshipGoal?: string;
};

export type FriendUpdatePayload = {
  fromUserId: string;
  fromName?: string;
  fromPhoto?: string;
  fromGender?: string;
  otherUserId?: string;
  action:
    | 'like'
    | 'unlike'
    | 'friends'
    | 'decline'
    | 'block'
    | 'unblock'
    | 'sync';
  status: string;
  silent?: boolean;
  privacyHidden?: boolean;
};

type PresenceUpdatePayload = {
  userId: string;
  isOnline: boolean;
};

export type ConversationDeletedPayload = {
  otherUserId: string;
};

export type ChatListPreviewPayload = {
  otherUserId: string;
  lastMessage: string;
  lastMessageAt?: number;
  incrementUnread?: boolean;
  resetUnread?: boolean;
  fromMe?: boolean;
  name?: string;
  photo?: string;
  gender?: string;
};

type SocketContextValue = {
  socket: Socket | null;
  unreadCount: number;
  refreshUnread: () => Promise<void>;
  notifUnreadCount: number;
  refreshNotifUnread: () => Promise<void>;
  notifTick: number;
  chatListTick: number;
  chatPreviewTick: number;
  lastChatListPreview: ChatListPreviewPayload | null;
  friendTick: number;
  lastFriendUpdate: FriendUpdatePayload | null;
  conversationDeletedTick: number;
  lastConversationDeleted: ConversationDeletedPayload | null;
  profileTick: number;
  lastProfileUpdate: ProfileUpdatePayload | null;
  presenceTick: number;
  lastPresence: PresenceUpdatePayload | null;
  bumpProfileLocal: (payload: ProfileUpdatePayload) => void;
  bumpChatPreview: (payload: ChatListPreviewPayload) => void;
};

const SocketContext = createContext<SocketContextValue | null>(null);

const FALLBACK_BOY = require('../assets/images/boy-image.png');
const FALLBACK_GIRL = require('../assets/images/girls-image.png');

function socketBaseUrl() {
  return API_BASE.replace(/\/api\/?$/, '') || API_BASE;
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { user, sessionVersion } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const [notifTick, setNotifTick] = useState(0);
  const [chatListTick, setChatListTick] = useState(0);
  const [chatPreviewTick, setChatPreviewTick] = useState(0);
  const [lastChatListPreview, setLastChatListPreview] =
    useState<ChatListPreviewPayload | null>(null);
  const [friendTick, setFriendTick] = useState(0);
  const [lastFriendUpdate, setLastFriendUpdate] =
    useState<FriendUpdatePayload | null>(null);
  const [conversationDeletedTick, setConversationDeletedTick] = useState(0);
  const [lastConversationDeleted, setLastConversationDeleted] =
    useState<ConversationDeletedPayload | null>(null);
  const [profileTick, setProfileTick] = useState(0);
  const [lastProfileUpdate, setLastProfileUpdate] =
    useState<ProfileUpdatePayload | null>(null);
  const [presenceTick, setPresenceTick] = useState(0);
  const [lastPresence, setLastPresence] =
    useState<PresenceUpdatePayload | null>(null);
  const [toast, setToast] = useState<ToastPayload | null>(null);

  const toastAnim = useRef(new Animated.Value(-120)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const bumpChatList = useCallback(() => {
    setChatListTick((n) => n + 1);
  }, []);

  const bumpChatPreview = useCallback((payload: ChatListPreviewPayload) => {
    setLastChatListPreview(payload);
    setChatPreviewTick((n) => n + 1);
  }, []);

  const bumpFriends = useCallback(() => {
    setFriendTick((n) => n + 1);
  }, []);

  const applyProfileUpdate = useCallback((payload: ProfileUpdatePayload) => {
    if (!payload?.userId) return;
    setLastProfileUpdate(payload);
    setProfileTick((n) => n + 1);
    bumpChatList();
  }, [bumpChatList]);

  const bumpProfileLocal = useCallback(
    (payload: ProfileUpdatePayload) => {
      applyProfileUpdate(payload);
    },
    [applyProfileUpdate],
  );

  const refreshUnread = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        setUnreadCount(0);
        return;
      }
      const data: any = await apiRequest('/api/chat/unread-count', token);
      if (typeof data?.unread === 'number') setUnreadCount(data.unread);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshNotifUnread = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        setNotifUnreadCount(0);
        return;
      }
      const count = await fetchNotificationUnread(token);
      setNotifUnreadCount(count);
    } catch {
      /* ignore */
    }
  }, []);

  const hideToast = useCallback(() => {
    Animated.timing(toastAnim, {
      toValue: -120,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setToast(null));
  }, [toastAnim]);

  const showToast = useCallback(
    (payload: Omit<ToastPayload, 'id'>) => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      const next = { ...payload, id: `${Date.now()}` };
      setToast(next);
      toastAnim.setValue(-120);
      Animated.spring(toastAnim, {
        toValue: 0,
        useNativeDriver: true,
        friction: 9,
        tension: 80,
      }).start();
      toastTimer.current = setTimeout(hideToast, 3500);
    },
    [hideToast, toastAnim],
  );

  // Keep global authenticated socket alive
  useEffect(() => {
    let cancelled = false;
    let active: Socket | null = null;

    (async () => {
      if (!user) {
        setSocket(null);
        setUnreadCount(0);
        setNotifUnreadCount(0);
        return;
      }
      const token = await getAuthToken();
      if (!token || cancelled) return;

      active = io(socketBaseUrl(), {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 800,
      });

      active.on('connect', () => {
        refreshUnread();
        refreshNotifUnread();
      });

      active.on('notification:new', () => {
        setNotifTick((n) => n + 1);
        refreshNotifUnread();
      });

      // Server-side read state changed (e.g. a chat was opened elsewhere)
      active.on('notification:sync', () => {
        setNotifTick((n) => n + 1);
        refreshNotifUnread();
      });

      active.on('chat:notification', (payload: any) => {
        const fromId = String(payload.from || '');
        const preview =
          payload.type === 'image'
            ? '📷 Photo'
            : payload.type === 'audio'
              ? '🎵 Voice message'
              : payload.text || 'New message';
        const onThatChat =
          pathnameRef.current === `/messages/${fromId}` ||
          pathnameRef.current?.includes(`/messages/${fromId}`);
        bumpChatPreview({
          otherUserId: fromId,
          lastMessage: preview,
          lastMessageAt: Date.now(),
          incrementUnread: !onThatChat,
          fromMe: false,
          name: payload.fromName,
          photo: payload.fromPhoto,
          gender: payload.fromGender,
        });
        bumpChatList();
        setUnreadCount((n) => n + 1);

        if (onThatChat) {
          refreshUnread();
          return;
        }

        showToast({
          kind: 'message',
          title: payload.fromName || 'New message',
          body: preview,
          photo: payload.fromPhoto || '',
          fromUserId: String(payload.from || ''),
          gender: payload.fromGender || '',
        });
      });

      active.on('chat:message', (msg: any) => {
        // Blocked / undelivered messages must not bump unread for the recipient
        if (msg?.undelivered && String(msg.receiverId) === String(user.id)) {
          return;
        }
        const myId = String(user.id);
        const senderId = String(msg.senderId || '');
        const receiverId = String(msg.receiverId || '');
        const otherId = senderId === myId ? receiverId : senderId;
        const fromMe = senderId === myId;
        const onThatChat =
          pathnameRef.current === `/messages/${otherId}` ||
          pathnameRef.current?.includes(`/messages/${otherId}`);
        bumpChatPreview({
          otherUserId: otherId,
          lastMessage: messagePreviewText(msg),
          lastMessageAt: msg.createdAt
            ? new Date(msg.createdAt).getTime()
            : Date.now(),
          incrementUnread: !fromMe && !onThatChat,
          resetUnread: fromMe || onThatChat,
          fromMe,
        });
        bumpChatList();
        if (String(msg.receiverId) === myId) {
          refreshUnread();
        }
      });

      active.on('friend:update', (payload: FriendUpdatePayload) => {
        setLastFriendUpdate(payload);
        bumpFriends();
        bumpChatList();

        if (payload.silent || payload.action === 'sync') {
          return;
        }

        const openChatPath = `/messages/${payload.fromUserId}`;
        const onThatChat =
          pathnameRef.current === openChatPath ||
          pathnameRef.current?.includes(`/messages/${payload.fromUserId}`);

        if (onThatChat && payload.action === 'unlike') {
          // still toast lightly for unlike? skip if in that chat
        }

        if (payload.action === 'like') {
          showToast({
            kind: 'like',
            title: payload.fromName || 'Someone',
            body: 'liked you',
            photo: payload.fromPhoto || '',
            fromUserId: String(payload.fromUserId || ''),
            gender: payload.fromGender || '',
          });
        } else if (payload.action === 'unlike') {
          showToast({
            kind: 'unlike',
            title: payload.fromName || 'Someone',
            body: 'unliked you',
            photo: payload.fromPhoto || '',
            fromUserId: String(payload.fromUserId || ''),
            gender: payload.fromGender || '',
          });
        } else if (payload.action === 'friends') {
          showToast({
            kind: 'friends',
            title: payload.fromName || 'Someone',
            body: 'You are now friends!',
            photo: payload.fromPhoto || '',
            fromUserId: String(payload.fromUserId || ''),
            gender: payload.fromGender || '',
          });
        }
      });

      active.on('conversation:deleted', (payload: ConversationDeletedPayload) => {
        const otherUserId = String(payload?.otherUserId || '');
        if (!otherUserId) return;
        setLastConversationDeleted({ otherUserId });
        setConversationDeletedTick((n) => n + 1);
        refreshUnread();
      });

      active.on('profile:update', (payload: any) => {
        applyProfileUpdate({
          userId: String(payload.userId || ''),
          publicId: payload.publicId || '',
          name: payload.name || '',
          bio: payload.bio || '',
          photo: payload.photo || '',
          photos: Array.isArray(payload.photos) ? payload.photos : [],
          age: payload.age ?? null,
          gender: payload.gender || '',
          height: payload.height ?? null,
        });
      });

      const applyPresence = (userId: any, isOnline: boolean) => {
        const id = String(userId || '');
        if (!id) return;
        setLastPresence({ userId: id, isOnline: !!isOnline });
        setPresenceTick((n) => n + 1);
      };

      active.on('user:online', (payload: any) => {
        applyPresence(payload?.userId, true);
      });

      active.on('user:offline', (payload: any) => {
        applyPresence(payload?.userId, false);
      });

      if (!cancelled) setSocket(active);
      refreshUnread();
      refreshNotifUnread();
    })();

    return () => {
      cancelled = true;
      if (toastTimer.current) clearTimeout(toastTimer.current);
      active?.disconnect();
      setSocket(null);
    };
  }, [
    user,
    sessionVersion,
    bumpChatList,
    bumpChatPreview,
    bumpFriends,
    applyProfileUpdate,
    refreshUnread,
    refreshNotifUnread,
    showToast,
  ]);

  // Badge safety net. Sockets drive updates in real time, so this only needs
  // to cover missed events — polling every second would drain the battery.
  useEffect(() => {
    if (!user) return;

    refreshUnread();
    refreshNotifUnread();

    let iv: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (iv) return;
      iv = setInterval(() => {
        refreshUnread();
        refreshNotifUnread();
      }, 30000);
    };
    const stop = () => {
      if (!iv) return;
      clearInterval(iv);
      iv = null;
    };

    start();

    // Pause while backgrounded; refresh once on return
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshUnread();
        refreshNotifUnread();
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [user, sessionVersion, refreshUnread, refreshNotifUnread]);

  const openToast = () => {
    if (!toast?.fromUserId) {
      hideToast();
      return;
    }
    const id = toast.fromUserId;
    const name = toast.title;
    const photo = toast.photo || '';
    const gender = toast.gender || '';
    hideToast();
    router.push({
      pathname: '/messages/[id]',
      params: {
        id,
        name,
        photo,
        gender,
        isOnline: 'false',
      },
    });
  };

  const value = useMemo(
    () => ({
      socket,
      unreadCount,
      refreshUnread,
      notifUnreadCount,
      refreshNotifUnread,
      notifTick,
      chatListTick,
      chatPreviewTick,
      lastChatListPreview,
      friendTick,
      lastFriendUpdate,
      conversationDeletedTick,
      lastConversationDeleted,
      profileTick,
      lastProfileUpdate,
      presenceTick,
      lastPresence,
      bumpProfileLocal,
      bumpChatPreview,
    }),
    [
      socket,
      unreadCount,
      refreshUnread,
      notifUnreadCount,
      refreshNotifUnread,
      notifTick,
      chatListTick,
      chatPreviewTick,
      lastChatListPreview,
      friendTick,
      lastFriendUpdate,
      conversationDeletedTick,
      lastConversationDeleted,
      profileTick,
      lastProfileUpdate,
      presenceTick,
      lastPresence,
      bumpProfileLocal,
      bumpChatPreview,
    ],
  );

  return (
    <SocketContext.Provider value={value}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.toastWrap,
            { paddingTop: Math.max(insets.top, 8), transform: [{ translateY: toastAnim }] },
          ]}
        >
          <Pressable style={styles.toastCard} onPress={openToast}>
            <View style={styles.toastAvatarWrap}>
              {toast.photo ? (
                <Image source={{ uri: toast.photo }} style={styles.toastAvatar} contentFit="cover" />
              ) : (
                <Image
                  source={toast.gender === 'Female' ? FALLBACK_GIRL : FALLBACK_BOY}
                  style={styles.toastAvatar}
                  contentFit="cover"
                />
              )}
              {toast.kind === 'like' || toast.kind === 'friends' ? (
                <View style={styles.toastBadge}>
                  <Ionicons name="heart" size={10} color="#fff" />
                </View>
              ) : toast.kind === 'unlike' ? (
                <View style={[styles.toastBadge, { backgroundColor: '#999' }]}>
                  <Ionicons name="heart-dislike" size={10} color="#fff" />
                </View>
              ) : null}
            </View>
            <View style={styles.toastTextWrap}>
              <Text style={styles.toastTitle} numberOfLines={1}>
                {toast.title}
              </Text>
              <Text style={styles.toastBody} numberOfLines={1}>
                {toast.body}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#BBB" />
          </Pressable>
        </Animated.View>
      )}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
}

const styles = StyleSheet.create({
  toastWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 10,
  },
  toastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EEE',
  },
  toastAvatarWrap: { position: 'relative' },
  toastAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F0F0F0',
  },
  toastBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FF4B6E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  toastTextWrap: { flex: 1, minWidth: 0 },
  toastTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
  },
  toastBody: {
    fontSize: 13,
    color: '#666',
    marginTop: 1,
  },
});
