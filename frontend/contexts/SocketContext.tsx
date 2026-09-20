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
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { io, Socket } from 'socket.io-client';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from './AuthContext';
import { apiRequest, getApiBase } from '../utils/api';
import { getAuthToken } from '../utils/auth';
import { fetchNotificationUnread } from '../utils/notifications';
import {
  getChatListCache,
  setChatListCache,
} from '../utils/chatListCache';
import {
  applyChatListPreviewPatch,
  isArchivedInChatCache,
  messagePreviewText,
} from '../utils/chatListPreviewPatch';
import WhatsAppAvatar from '../components/WhatsAppAvatar';
import { isPushTrayReady, presentChatMessageNotification } from '../utils/push';
import { isCallSessionActive } from '../utils/callSession';

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
  coverPhoto?: string;
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
  lastMessage?: string;
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
  /** WhatsApp: clear row + tab badge the moment a chat is opened / read */
  markChatAsRead: (otherUserId: string) => void;
};

const SocketContext = createContext<SocketContextValue | null>(null);

function socketBaseUrl() {
  // Resolved at connect time — an import-time snapshot can still be localhost on device
  const base = getApiBase();
  return base.replace(/\/api\/?$/, '') || base;
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
  const lastPresenceRef = useRef<PresenceUpdatePayload | null>(null);
  const presenceMapRef = useRef(new Map<string, boolean>());
  const [toast, setToast] = useState<ToastPayload | null>(null);

  const toastAnim = useRef(new Animated.Value(-120)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const bumpChatList = useCallback(() => {
    setChatListTick((n) => n + 1);
  }, []);

  const bumpChatPreview = useCallback(
    (payload: ChatListPreviewPayload) => {
      // Persist into chat cache immediately (even if Chat tab is not focused)
      try {
        const current = getChatListCache(sessionVersion);
        const next = applyChatListPreviewPatch(current, payload);
        setChatListCache({ ...next, sessionVersion, loaded: true });
      } catch {
        /* ignore cache write errors */
      }
      setLastChatListPreview(payload);
      setChatPreviewTick((n) => n + 1);
    },
    [sessionVersion],
  );

  const markChatAsRead = useCallback(
    (otherUserId: string) => {
      const id = String(otherUserId || '');
      if (!id) return;
      const snap = getChatListCache(sessionVersion);
      const row =
        snap.conversations.find((r) => r.otherId === id) ||
        snap.friendRows.find((r) => r.otherId === id) ||
        snap.requestRows.find((r) => r.otherId === id) ||
        (snap.archiveRows || []).find((r) => r.otherId === id) ||
        snap.onlineRows.find((r) => r.otherId === id);
      const cleared = Math.max(0, Number(row?.unread) || 0);

      bumpChatPreview({
        otherUserId: id,
        resetUnread: true,
        name: row?.name,
        photo: row?.photo,
        gender: row?.gender,
      });

      if (cleared > 0) {
        setUnreadCount((n) => Math.max(0, n - cleared));
      }
    },
    [sessionVersion, bumpChatPreview],
  );

  const bumpFriends = useCallback(() => {
    setFriendTick((n) => n + 1);
  }, []);

  const applyProfileUpdate = useCallback((payload: ProfileUpdatePayload) => {
    if (!payload?.userId) return;
    setLastProfileUpdate(payload);
    setProfileTick((n) => n + 1);
    // Chat list patches locally from profileTick — no full reload
  }, []);

  const bumpProfileLocal = useCallback(
    (payload: ProfileUpdatePayload) => {
      applyProfileUpdate(payload);
    },
    [applyProfileUpdate],
  );

  const unreadGateRef = useRef({ at: 0, inflight: false });
  const notifGateRef = useRef({ at: 0, inflight: false });

  const refreshUnread = useCallback(async () => {
    const g = unreadGateRef.current;
    if (g.inflight) return;
    if (Date.now() - g.at < 10_000) return;
    g.inflight = true;
    g.at = Date.now();
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
    } finally {
      g.inflight = false;
    }
  }, []);

  const refreshNotifUnread = useCallback(async () => {
    const g = notifGateRef.current;
    if (g.inflight) return;
    if (Date.now() - g.at < 8_000) return;
    g.inflight = true;
    g.at = Date.now();
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
    } finally {
      g.inflight = false;
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

  /**
   * Only the id matters for the socket session. Depending on the whole user
   * object tore down and reconnected the socket on unrelated profile/token
   * updates, which delayed messages and duplicated listeners.
   */
  const authUserId = user?.id ? String(user.id) : null;

  // Keep global authenticated socket alive
  useEffect(() => {
    let cancelled = false;
    let active: Socket | null = null;

    (async () => {
      if (!authUserId) {
        presenceMapRef.current.clear();
        setSocket(null);
        setUnreadCount(0);
        setNotifUnreadCount(0);
        return;
      }
      presenceMapRef.current.clear();
      const token = await getAuthToken();
      if (!token || cancelled) return;

      active = io(socketBaseUrl(), {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 800,
        // Don't stay "online" after the OS backgrounds the app — we disconnect
        // explicitly on AppState change below.
        autoConnect: AppState.currentState === 'active',
      });

      active.on('connect', () => {
        refreshUnread();
        refreshNotifUnread();
        try {
          active.emit('presence:ping');
        } catch {
          /* ignore */
        }
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

        // Archived: message may not be in main lists — patch archive unread here
        if (isArchivedInChatCache(sessionVersion, fromId)) {
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
          return;
        }

        // Main chats: chat:message owns preview + unread badge (avoids race that
        // wiped badges when this event arrived last with incrementUnread:false)
        if (onThatChat) return;

        // WhatsApp: while app is open + notifications allowed, post to the
        // system panel (local). FCM covers background / killed / locked.
        if (AppState.currentState === 'active' && isPushTrayReady()) {
          void presentChatMessageNotification({
            senderId: fromId,
            senderName: payload.fromName || 'New message',
            body: preview,
            senderPhoto: payload.fromPhoto || '',
            senderGender: payload.fromGender || '',
            roomId: payload.roomId ? String(payload.roomId) : undefined,
            messageId: payload.messageId
              ? String(payload.messageId)
              : undefined,
          });
          return;
        }

        // Fallback in-app toast when notification permission isn't granted
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
        if (msg?.undelivered && String(msg.receiverId) === authUserId) {
          return;
        }
        const myId = authUserId;
        const senderId = String(msg.senderId || '');
        const receiverId = String(msg.receiverId || '');
        const otherId = senderId === myId ? receiverId : senderId;
        const fromMe = senderId === myId;
        const onThatChat =
          pathnameRef.current === `/messages/${otherId}` ||
          pathnameRef.current?.includes(`/messages/${otherId}`);
        const archived = isArchivedInChatCache(sessionVersion, otherId);
        // CRITICAL: fromName/fromPhoto are always the SENDER.
        // When fromMe, that is MY profile — never write it onto the peer row.
        const peerProfile = fromMe
          ? {}
          : {
              name: msg.fromName || msg.senderName,
              photo: msg.fromPhoto || msg.senderPhoto,
              gender: msg.fromGender || msg.senderGender,
            };
        bumpChatPreview({
          otherUserId: otherId,
          lastMessage: messagePreviewText(msg),
          lastMessageAt: msg.createdAt
            ? new Date(msg.createdAt).getTime()
            : Date.now(),
          incrementUnread: !fromMe && !onThatChat,
          resetUnread: fromMe || onThatChat,
          fromMe,
          ...peerProfile,
        });
        // Archived unread stays under Archive badge — not the main chat badge
        if (
          !archived &&
          !fromMe &&
          String(msg.receiverId) === myId &&
          !onThatChat
        ) {
          setUnreadCount((n) => n + 1);
        }
      });

      active.on('friend:update', (payload: FriendUpdatePayload) => {
        setLastFriendUpdate(payload);
        bumpFriends();
        // Instant friend/request patch via friendTick — skip full chatList reload

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
        const uid = String(payload.userId || '');
        if (!uid) return;
        applyProfileUpdate({
          userId: uid,
          publicId: payload.publicId || '',
          // Only pass fields that were actually present — avoid wiping DP with ''
          ...(payload.name != null ? { name: String(payload.name) } : {}),
          ...(payload.bio != null ? { bio: String(payload.bio) } : {}),
          ...(payload.photo !== undefined
            ? { photo: payload.photo ? String(payload.photo) : '' }
            : {}),
          ...(Array.isArray(payload.photos) ? { photos: payload.photos } : {}),
          ...(payload.age !== undefined ? { age: payload.age ?? null } : {}),
          ...(payload.gender != null ? { gender: String(payload.gender) } : {}),
          ...(payload.height !== undefined
            ? { height: payload.height ?? null }
            : {}),
        });
      });

      const applyPresence = (userId: any, isOnline: boolean) => {
        const id = String(userId || '');
        if (!id) return;
        const online = !!isOnline;
        if (presenceMapRef.current.get(id) === online) return;
        presenceMapRef.current.set(id, online);
        const next = { userId: id, isOnline: online };
        lastPresenceRef.current = next;
        setLastPresence(next);
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
    authUserId,
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
    let presenceIv: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (iv) return;
      iv = setInterval(() => {
        refreshUnread();
        refreshNotifUnread();
      }, 90_000);
    };
    const stop = () => {
      if (!iv) return;
      clearInterval(iv);
      iv = null;
    };

    const startPresence = () => {
      if (presenceIv) return;
      const sock = socket;
      if (sock?.connected) {
        try {
          sock.emit('presence:ping');
        } catch {
          /* ignore */
        }
      }
      presenceIv = setInterval(() => {
        const s = socket;
        if (s?.connected) {
          try {
            s.emit('presence:ping');
          } catch {
            /* ignore */
          }
        }
      }, 35_000);
    };
    const stopPresence = () => {
      if (!presenceIv) return;
      clearInterval(presenceIv);
      presenceIv = null;
    };

    /** Online = app open in foreground only — except during an active call */
    const goOffline = () => {
      // WhatsApp: keep socket + call heartbeats while on a voice/video call
      if (isCallSessionActive()) {
        const s = socket;
        if (s?.connected) {
          try {
            s.emit('chat:leave', {});
          } catch {
            /* ignore */
          }
        }
        return;
      }
      stop();
      stopPresence();
      const s = socket;
      if (s?.connected) {
        try {
          // Clear push-suppress BEFORE disconnect so FCM can fire immediately
          s.emit('chat:leave', {});
          s.disconnect();
        } catch {
          /* ignore */
        }
      }
    };

    const goOnline = () => {
      refreshUnread();
      refreshNotifUnread();
      // Don't bump chatListTick every resume — Chat uses its own 60s TTL sync
      start();
      const s = socket;
      if (s && !s.connected) {
        try {
          s.connect();
        } catch {
          /* ignore */
        }
      }
      startPresence();
    };

    if (AppState.currentState === 'active') {
      goOnline();
    } else if (AppState.currentState === 'background') {
      goOffline();
    }

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        goOnline();
      } else if (state === 'background') {
        // Home / switch apps — mark offline. Ignore brief "inactive" (control center).
        goOffline();
      }
    });

    return () => {
      stop();
      stopPresence();
      sub.remove();
    };
  }, [user, sessionVersion, socket, refreshUnread, refreshNotifUnread]);

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
    markChatAsRead(id);
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
      markChatAsRead,
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
      markChatAsRead,
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
              <WhatsAppAvatar
                photo={toast.photo}
                name={toast.title}
                gender={toast.gender}
                size={44}
              />
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
