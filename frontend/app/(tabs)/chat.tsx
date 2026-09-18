import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import {
    ActivityIndicator,
    AppState,
    FlatList,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppAlert } from "../../components/AppAlert";
import { ListRowSkeleton } from "../../components/ScreenSkeleton";
import SearchModeOverlay from "../../components/SearchModeOverlay";
import UserProfileModal from "../../components/UserProfileModal";
import WhatsAppAvatar, {
    getDisplayName,
} from "../../components/WhatsAppAvatar";
import { useAuth } from "../../contexts/AuthContext";
import { useSocket } from "../../contexts/SocketContext";
import { apiRequest } from "../../utils/api";
import { resolveMediaUrl } from "../../utils/media";
import { getAuthToken, getCurrentAuthUser } from "../../utils/auth";
import {
    archiveConversation,
    deleteConversationPermanently,
    fetchArchivedConversations,
    unarchiveConversation,
} from "../../utils/chatActions";
import {
    getChatListCache,
    hydrateChatListCache,
    setChatListCache,
    type ChatFilterKey,
    type ConversationItem,
} from "../../utils/chatListCache";
import {
    patchListsForFriendAction,
    removeConversationFromAllLists,
    removeConversationFromMainLists,
} from "../../utils/friendListPatch";
import {
    acceptFriendRequest,
    declineFriendRequest,
    FriendRequest,
    getFriendRequests,
    getFriendsList,
    sendLike,
    unlikeUser,
} from "../../utils/friends";
import {
    fetchUserProfile,
    NearbyUser,
    uploadMyLocation,
} from "../../utils/nearby";
import {
    addRecentSearch,
    clearRecentSearches,
    getRecentSearches,
    RECENT_SEARCH_CHAT,
    type RecentSearchPerson,
} from "../../utils/recentSearches";
import {
    clearThreadCache,
    preloadRecentThreads,
    setThreadCacheAccount,
} from "../../utils/threadCache";
import { formatChatListTime, useTimeTick } from "../../utils/timeFormat";

/** Discover-matched theme — deep purple + black */
const C = {
  purple: "#370372",
  purpleSoft: "#EFE8F8",
  purpleMid: "#EADDFF",
  black: "#1C1B1F",
  bg: "#F5F5F7",
  surface: "#FFFFFF",
  muted: "#79747E",
  border: "#E7E0EC",
  secondary: "#49454F",
  pill: "#E4E6EB",
  pillActive: "#111111",
};

/**
 * Convert relative photo URL to absolute URL.
 * Resolved at call time so physical devices use the LAN host, not localhost.
 */
function resolvePhotoUrl(photo: string): string {
  if (!photo) return "";
  return resolveMediaUrl(photo) || "";
}

type ChatCategory = "friend" | "request" | "stranger";

function archivedApiToItem(c: any, myId: string): ConversationItem | null {
  const fromApi = apiConversationToItem(c, myId);
  if (fromApi) {
    return {
      ...fromApi,
      unread:
        typeof c.unreadCount === "number" ? c.unreadCount : fromApi.unread,
    };
  }
  const other = c.otherUser || {};
  const msg = c.lastMessage;
  let otherId = String(other.id || other._id || "");
  if (!otherId && msg) {
    otherId =
      String(msg.senderId) === myId
        ? String(msg.receiverId)
        : String(msg.senderId);
  }
  if (!otherId) return null;
  return {
    otherId,
    name: other.name || "User",
    photo: resolvePhotoUrl(other.photo || ""),
    gender: other.gender || "",
    isOnline: !!other.isOnline,
    lastMessage:
      msg?.text ||
      (msg?.type === "image"
        ? "📷 Photo"
        : msg?.type === "audio"
          ? "🎵 Voice"
          : "Archived chat"),
    lastMessageAt: new Date(
      msg?.createdAt || c.archivedAt || Date.now(),
    ).getTime(),
    unread: typeof c.unreadCount === "number" ? c.unreadCount : 0,
    category: (c.category as ChatCategory) || "stranger",
    relationshipStatus: c.friendshipStatus || "none",
    areFriends: !!c.areFriends,
    iLiked: !!c.iLiked,
    privacyHidden: !!c.theyBlocked,
    iBlocked: !!c.iBlocked,
    theyBlocked: !!c.theyBlocked,
  };
}

export type { ConversationItem };

type FilterKey = ChatFilterKey;

function apiConversationToItem(c: any, myId: string): ConversationItem | null {
  const msg = c.lastMessage;
  if (!msg) return null;
  const otherId =
    String(msg.senderId) === myId
      ? String(msg.receiverId)
      : String(msg.senderId);

  const other = c.otherUser || {};
  const category: ChatCategory =
    c.category === "friend"
      ? "friend"
      : c.category === "request"
        ? "request"
        : "stranger";

  const privacyHidden = !!c.theyBlocked;
  const blockedEither = !!c.iBlocked || !!c.theyBlocked;

  return {
    otherId,
    name: other.name || "User",
    photo: privacyHidden ? "" : resolvePhotoUrl(other.photo || ""),
    gender: other.gender || "",
    isOnline: blockedEither ? false : !!other.isOnline,
    lastMessage: msg.text || (msg.type === "image" ? "📷 Photo" : "🎵 Voice"),
    lastMessageAt: Number.isFinite(new Date(msg.createdAt).getTime())
      ? new Date(msg.createdAt).getTime()
      : Date.now(),
    unread: c.unreadCount || 0,
    category,
    relationshipStatus: c.friendshipStatus || "none",
    areFriends: !!c.areFriends,
    iLiked: !!c.iLiked || !!c.areFriends,
    privacyHidden,
    iBlocked: !!c.iBlocked,
    theyBlocked: !!c.theyBlocked,
    requestType:
      c.friendshipStatus === "mutual_match"
        ? "mutual_match"
        : c.friendshipStatus === "pending_like" && !c.iLiked
          ? "incoming_like"
          : c.friendshipStatus === "pending_like" && c.iLiked
            ? "outgoing_like"
            : undefined,
  };
}

export default function ChatScreen() {
  const router = useRouter();
  const { showAlert } = useAppAlert();
  const { sessionVersion, user } = useAuth();
  const {
    chatListTick,
    chatPreviewTick,
    lastChatListPreview,
    friendTick,
    lastFriendUpdate,
    conversationDeletedTick,
    lastConversationDeleted,
    refreshUnread,
    presenceTick,
    lastPresence,
    profileTick,
    lastProfileUpdate,
    markChatAsRead,
  } = useSocket();
  useTimeTick(60000);

  const cached = getChatListCache(sessionVersion);
  const [conversations, setConversations] = React.useState<ConversationItem[]>(
    cached.conversations,
  );
  const [friendRows, setFriendRows] = React.useState<ConversationItem[]>(
    cached.friendRows,
  );
  const [requestRows, setRequestRows] = React.useState<ConversationItem[]>(
    cached.requestRows,
  );
  const [onlineRows, setOnlineRows] = React.useState<ConversationItem[]>(
    cached.onlineRows,
  );
  const [archiveRows, setArchiveRows] = React.useState<ConversationItem[]>(
    cached.archiveRows || [],
  );
  const [loading, setLoading] = React.useState(!cached.loaded);
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [activeFilter, setActiveFilter] = React.useState<FilterKey>(
    cached.activeFilter,
  );
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchMode, setSearchMode] = React.useState(false);
  const [searchBarY, setSearchBarY] = React.useState(0);
  const [recentSearches, setRecentSearches] = React.useState<
    RecentSearchPerson[]
  >([]);
  const searchInputRef = React.useRef<TextInput>(null);
  const searchBarRef = React.useRef<View>(null);

  const rememberPerson = React.useCallback(
    async (person: RecentSearchPerson) => {
      const next = await addRecentSearch(RECENT_SEARCH_CHAT, person);
      setRecentSearches(next);
    },
    [],
  );

  React.useEffect(() => {
    void getRecentSearches(RECENT_SEARCH_CHAT).then(setRecentSearches);
  }, []);

  const closeSearchMode = React.useCallback(() => {
    setSearchMode(false);
    setSearchQuery("");
  }, []);

  const hasLoadedOnce = React.useRef(cached.loaded);
  const lastLoadTime = React.useRef(cached.at);
  const pendingDeletedRef = React.useRef(new Set<string>());
  /** User explicitly removed these — never restore on API merge. */
  const locallyRemovedIdsRef = React.useRef(new Set<string>());
  /** Chats the user archived — Archive tab is independent of main-list merges. */
  const locallyArchivedIdsRef = React.useRef(new Set<string>());
  const loadGenRef = React.useRef(0);
  const lastFullSyncRef = React.useRef(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [profileModalVisible, setProfileModalVisible] = React.useState(false);
  const [profileUser, setProfileUser] = React.useState<NearbyUser | null>(null);
  const [profileLiking, setProfileLiking] = React.useState(false);
  /** Guards against a slow profile fetch overwriting a newer selection */
  const profileRequestIdRef = React.useRef(0);
  const refreshInterval = React.useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const listSnapshotRef = React.useRef({
    conversations,
    friendRows,
    requestRows,
    onlineRows,
    archiveRows,
  });

  React.useEffect(() => {
    listSnapshotRef.current = {
      conversations,
      friendRows,
      requestRows,
      onlineRows,
      archiveRows,
    };
  }, [conversations, friendRows, requestRows, onlineRows, archiveRows]);

  const applyLocalFriendPatch = React.useCallback(
    (
      otherId: string,
      item: ConversationItem,
      action: Parameters<typeof patchListsForFriendAction>[3],
    ) => {
      if (action === "decline" || action === "unlike") {
        locallyRemovedIdsRef.current.add(otherId);
      }
      if (
        action === "incoming_like" ||
        action === "like_sent" ||
        action === "friends" ||
        action === "like_back"
      ) {
        locallyRemovedIdsRef.current.delete(otherId);
        pendingDeletedRef.current.delete(otherId);
      }
      const next = patchListsForFriendAction(
        listSnapshotRef.current,
        otherId,
        item,
        action,
      );
      listSnapshotRef.current = {
        ...listSnapshotRef.current,
        ...next,
      };
      setConversations(next.conversations);
      setFriendRows(next.friendRows);
      setRequestRows(next.requestRows);
      setOnlineRows(next.onlineRows);
      setChatListCache({ ...next, sessionVersion, loaded: true });
    },
    [sessionVersion],
  );

  const mergeKeepLocalRows = React.useCallback(
    (prev: ConversationItem[], next: ConversationItem[]) => {
      const skip = locallyRemovedIdsRef.current;
      const deleted = pendingDeletedRef.current;
      const prevMap = new Map(prev.map((row) => [row.otherId, row]));
      const map = new Map<string, ConversationItem>();
      for (const row of next) {
        if (skip.has(row.otherId) || deleted.has(row.otherId)) continue;
        const local = prevMap.get(row.otherId);
        if (local && (local.lastMessageAt || 0) > (row.lastMessageAt || 0)) {
          // Socket patch newer than API — keep instant preview + unread badge
          map.set(row.otherId, {
            ...row,
            lastMessage: local.lastMessage || row.lastMessage,
            lastMessageAt: local.lastMessageAt,
            unread: Math.max(local.unread || 0, row.unread || 0),
            name: local.name || row.name,
            photo: local.photo || row.photo,
            gender: local.gender || row.gender,
            isOnline:
              typeof local.isOnline === "boolean"
                ? local.isOnline
                : row.isOnline,
          });
        } else if (local) {
          map.set(row.otherId, {
            ...row,
            // API caught up on time — still never drop a higher live unread
            unread: Math.max(local.unread || 0, row.unread || 0),
          });
        } else {
          map.set(row.otherId, row);
        }
      }
      for (const row of prev) {
        if (skip.has(row.otherId) || deleted.has(row.otherId)) continue;
        if (!map.has(row.otherId)) {
          map.set(row.otherId, row);
        }
      }
      return Array.from(map.values()).sort(
        (a, b) => b.lastMessageAt - a.lastMessageAt,
      );
    },
    [],
  );

  // Restore last chats/friends for this account from disk, then refresh from API
  React.useEffect(() => {
    setThreadCacheAccount(user?.email);
  }, [user?.email]);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const email = user?.email;
      if (!email) return;
      const hydrated = await hydrateChatListCache(email, sessionVersion);
      if (cancelled) return;
      if (hydrated.loaded) {
        setConversations(hydrated.conversations);
        setFriendRows(hydrated.friendRows);
        setRequestRows(hydrated.requestRows);
        setOnlineRows(hydrated.onlineRows);
        setArchiveRows(hydrated.archiveRows || []);
        setActiveFilter(hydrated.activeFilter);
        hasLoadedOnce.current = true;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email, sessionVersion]);

  // ── Load real conversations from backend ────────────────────────
  const loadConversations = React.useCallback(
    async (silent = false) => {
      const showSkeleton = !silent && !hasLoadedOnce.current;
      if (showSkeleton) setLoading(true);
      const loadId = ++loadGenRef.current;
      const prev = listSnapshotRef.current;

    try {
      const token = await getAuthToken();
        if (!token) {
          if (showSkeleton) setLoading(false);
          return;
        }

        // Each source is independent — one failure must not wipe chats/friends.
        const [convRes, reqRes, friendsRes, likesRes, nearbyRes, archivedRes] =
          await Promise.allSettled([
            apiRequest("/api/chat/conversations", token),
            getFriendRequests(token),
            getFriendsList(token),
            apiRequest("/api/friends/likes", token),
            (async () => {
              try {
                await uploadMyLocation(token);
              } catch {
                /* optional for chat */
              }
              return apiRequest(
                "/api/users/nearby?radius=50000&mode=more&limit=30&activeWithin=5&track=0",
                token,
              );
            })(),
            fetchArchivedConversations(token),
          ]);

        if (loadId !== loadGenRef.current) return;

        const dataRaw =
          convRes.status === "fulfilled" ? (convRes.value as any) : null;
        const data: any[] =
          convRes.status === "fulfilled"
            ? Array.isArray(dataRaw)
              ? dataRaw
              : Array.isArray(dataRaw?.conversations)
                ? dataRaw.conversations
                : []
            : null;

        const requests: FriendRequest[] | null =
          reqRes.status === "fulfilled" && Array.isArray(reqRes.value)
            ? reqRes.value
            : null;
        const friends: FriendRequest[] | null =
          friendsRes.status === "fulfilled" && Array.isArray(friendsRes.value)
            ? friendsRes.value
            : null;
        const outgoingLikes: FriendRequest[] | null =
          likesRes.status === "fulfilled"
            ? Array.isArray(likesRes.value)
              ? likesRes.value
              : Array.isArray((likesRes.value as any)?.likes)
                ? (likesRes.value as any).likes
                : null
            : null;

        const nearbyRaw =
          nearbyRes.status === "fulfilled" ? (nearbyRes.value as any) : null;
        const nearby: any[] | null =
          nearbyRes.status === "fulfilled"
            ? Array.isArray(nearbyRaw)
              ? nearbyRaw
              : Array.isArray(nearbyRaw?.users)
                ? nearbyRaw.users
                : []
            : null;

        if (convRes.status === "rejected") {
          console.warn("conversations fetch failed:", convRes.reason);
        }
        if (reqRes.status === "rejected") {
          console.warn("friend requests fetch failed:", reqRes.reason);
        }
        if (friendsRes.status === "rejected") {
          console.warn("friends list fetch failed:", friendsRes.reason);
        }
        if (likesRes.status === "rejected") {
          console.warn("outgoing likes fetch failed:", likesRes.reason);
        }

      const authUser = await getCurrentAuthUser();
        if (loadId !== loadGenRef.current) return;
        const myId = String(authUser?.id || "");

        const items: ConversationItem[] =
          data !== null
            ? (data
                .map((c: any) => apiConversationToItem(c, myId))
                .filter(Boolean) as ConversationItem[])
            : [...prev.conversations];

        const archivedData =
          archivedRes.status === "fulfilled" && Array.isArray(archivedRes.value)
            ? archivedRes.value
            : null;
        const nextArchivedFromApi =
          archivedData !== null
            ? (archivedData
                .map((c: any) => archivedApiToItem(c, myId))
                .filter(Boolean) as ConversationItem[])
            : null;

        // Merge request-only / friend / outgoing likes into All
        const byId = new Map(items.map((item) => [item.otherId, item]));
        const requestList = requests ?? [];
        const friendList = friends ?? [];
        const likesList = outgoingLikes ?? [];

        if (requests !== null) {
          for (const request of requestList) {
            const row = relationshipToRow(request, "request");
            const existing = byId.get(row.otherId);
            if (existing) {
              existing.category = "request";
              existing.requestType = row.requestType;
              existing.relationshipStatus = row.relationshipStatus;
              existing.iLiked = false;
              existing.areFriends = false;
              if (!existing.lastMessage) existing.lastMessage = row.lastMessage;
            } else {
              byId.set(row.otherId, row);
            }
          }
        }
        if (friends !== null) {
          for (const friend of friendList) {
            const row = relationshipToRow(friend, "friend");
            const existing = byId.get(row.otherId);
            if (existing) {
              existing.category = "friend";
              existing.areFriends = true;
              existing.iLiked = true;
              existing.relationshipStatus = "friends";
            } else {
              byId.set(row.otherId, row);
            }
          }
        }
        if (outgoingLikes !== null) {
          for (const like of likesList) {
            const row = relationshipToRow(like, "stranger");
            row.iLiked = true;
            row.requestType = "outgoing_like";
            row.lastMessage = "You liked them";
            const existing = byId.get(row.otherId);
            if (existing) {
              existing.iLiked = true;
              if (!existing.areFriends && existing.category === "stranger") {
                existing.requestType = existing.requestType || "outgoing_like";
              }
            } else {
              byId.set(row.otherId, row);
            }
          }
        }

        // Keep prior All rows if a relationship fetch failed (don't drop likes/requests)
        if (
          requests === null ||
          friends === null ||
          outgoingLikes === null ||
          data === null
        ) {
          for (const row of listSnapshotRef.current.conversations) {
            if (!byId.has(row.otherId)) byId.set(row.otherId, row);
          }
        }

        if (loadId !== loadGenRef.current) return;

        const live = listSnapshotRef.current;
        const removedIds = new Set([
          ...pendingDeletedRef.current,
          ...locallyRemovedIdsRef.current,
        ]);
        // Archived chats are independent — never treat as "removed"
        for (const id of locallyArchivedIdsRef.current) {
          removedIds.delete(id);
        }

        const mergedRaw = Array.from(byId.values()).filter(
          (row) =>
            !removedIds.has(row.otherId) &&
            !locallyArchivedIdsRef.current.has(row.otherId),
        );

        // Archive merge: keep local archived rows; never drop due to main-list skips
        const apiArchiveRows =
          nextArchivedFromApi !== null
            ? nextArchivedFromApi.filter(
                (row) => !pendingDeletedRef.current.has(row.otherId),
              )
            : [];
        let nextArchived = mergeKeepLocalRows(
          (live.archiveRows || []).filter(
            (row) => !pendingDeletedRef.current.has(row.otherId),
          ),
          nextArchivedFromApi !== null
            ? apiArchiveRows
            : (live.archiveRows || []).filter(
                (row) => !pendingDeletedRef.current.has(row.otherId),
              ),
        );
        // Guarantee locally archived IDs survive even if API was empty/raced
        for (const id of locallyArchivedIdsRef.current) {
          if (pendingDeletedRef.current.has(id)) continue;
          if (nextArchived.some((r) => r.otherId === id)) continue;
          const local = (live.archiveRows || []).find((r) => r.otherId === id);
          if (local) nextArchived = [local, ...nextArchived];
        }
        // Sync ref from successful API archive list
        if (nextArchivedFromApi !== null) {
          for (const row of nextArchived) {
            locallyArchivedIdsRef.current.add(row.otherId);
          }
        }

        const archivedIds = new Set([
          ...nextArchived.map((row) => row.otherId),
          ...locallyArchivedIdsRef.current,
        ]);
        const hideArchived = (rows: ConversationItem[]) =>
          rows.filter(
            (row) =>
              !archivedIds.has(row.otherId) && !removedIds.has(row.otherId),
          );

        const apiRequests =
          requests !== null
            ? hideArchived(
                requestList.map((request) =>
                  relationshipToRow(request, "request"),
                ),
              )
            : hideArchived(live.requestRows);
        const apiFriends =
          friends !== null
            ? hideArchived(
                friendList.map((friend) => relationshipToRow(friend, "friend")),
              )
            : hideArchived(live.friendRows);

        // Requests never auto-drop just because the API list is shorter / raced.
        // Only leave Request when THIS user declined/deleted, or they are friends.
        const friendIds = new Set(
          (friends !== null ? apiFriends : live.friendRows).map(
            (r) => r.otherId,
          ),
        );
        let nextRequests = mergeKeepLocalRows(
          hideArchived(live.requestRows),
          apiRequests,
        ).filter((row) => !friendIds.has(row.otherId));

        // Ensure every API request still has category=request after merge
        if (requests !== null) {
          const apiReqIds = new Set(apiRequests.map((r) => r.otherId));
          nextRequests = nextRequests.map((row) =>
            apiReqIds.has(row.otherId) || row.category === "request"
              ? {
                  ...row,
                  category: "request" as ChatCategory,
                  theyLiked: row.theyLiked !== false,
                }
              : row,
          );
        }

        const nextFriends = mergeKeepLocalRows(
          hideArchived(live.friendRows),
          apiFriends,
        );
        const requestIds = new Set(nextRequests.map((r) => r.otherId));
        const nextConversations = mergeKeepLocalRows(
          hideArchived(live.conversations),
          hideArchived(mergedRaw),
        ).map((row) =>
          requestIds.has(row.otherId) && !row.areFriends
            ? {
                ...row,
                category: "request" as ChatCategory,
                theyLiked: true,
                requestType: row.requestType || "incoming_like",
              }
            : row,
        );

        const nextOnline =
          nearby !== null
            ? hideArchived(
                nearby
                  .filter(
                    (person: any) =>
                      !!person.isOnline &&
                      !removedIds.has(String(person.id || person._id)),
                  )
                  .map((person: any): ConversationItem => {
                    const category: ChatCategory = person.areFriends
                      ? "friend"
                      : person.theyLiked
                        ? "request"
                        : "stranger";
        return {
                      otherId: String(person.id || person._id),
                      name: person.name || "User",
                      photo: resolvePhotoUrl(person.photo || ""),
                      gender: person.gender || "",
                      isOnline: true,
                      lastMessage:
                        person.distanceKm && person.distanceKm !== "?"
                          ? `Online · ${person.distanceKm} km away`
                          : "Online now",
                      lastMessageAt: Date.now(),
                      unread: 0,
                      category,
                      relationshipStatus: person.friendshipStatus || "stranger",
                      areFriends: !!person.areFriends,
                      iLiked: !!person.iLiked,
                      theyLiked: !!person.theyLiked,
                      requestType: person.theyLiked
                        ? "incoming_like"
                        : undefined,
                    };
                  }),
              )
            : hideArchived(live.onlineRows);

        if (loadId !== loadGenRef.current) return;

        listSnapshotRef.current = {
          conversations: nextConversations,
          requestRows: nextRequests,
          friendRows: nextFriends,
          onlineRows: nextOnline,
          archiveRows: nextArchived,
        };
        setConversations(nextConversations);
        setRequestRows(nextRequests);
        setFriendRows(nextFriends);
        setOnlineRows(nextOnline);
        setArchiveRows(nextArchived);
        setChatListCache({
          conversations: nextConversations,
          requestRows: nextRequests,
          friendRows: nextFriends,
          onlineRows: nextOnline,
          archiveRows: nextArchived,
          sessionVersion,
          loaded: true,
        });

        if (user?.email) {
          void preloadRecentThreads(
            user.email,
            nextConversations.map((c) => c.otherId),
            token,
            8,
          );
        }
    } catch (e) {
        console.error("Failed to load conversations", e);
    } finally {
        if (loadId === loadGenRef.current) {
          hasLoadedOnce.current = true;
          lastLoadTime.current = Date.now();
      setLoading(false);
    }
      }
    },
    [sessionVersion, user?.email, mergeKeepLocalRows],
  );

  const onPullRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await loadConversations(true);
      refreshUnread();
    } finally {
      setRefreshing(false);
    }
  }, [loadConversations, refreshUnread]);

  const relationshipToRow = (
    relationship: FriendRequest,
    category: "friend" | "request" | "stranger",
  ): ConversationItem => ({
    otherId: relationship.otherId,
    name: relationship.otherUser?.name || "User",
    photo: resolvePhotoUrl(relationship.otherUser?.photo || ""),
    gender: relationship.otherUser?.gender || "",
    isOnline: !!relationship.otherUser?.isOnline,
    lastMessage:
      category === "friend"
        ? "Friend"
        : relationship.requestType === "incoming_like"
          ? "Liked you"
          : relationship.requestType === "outgoing_like"
            ? "You liked them"
            : category === "request"
              ? "Mutual match"
              : "You liked them",
    lastMessageAt: new Date(
      relationship.friendsSince ||
        relationship.matchedAt ||
        relationship.likedAt ||
        relationship.updatedAt ||
        Date.now(),
    ).getTime(),
    unread: 0,
    category,
    relationshipStatus: relationship.status,
    requestType: relationship.requestType,
    areFriends: category === "friend",
    theyLiked:
      category === "request" ||
      relationship.requestType === "incoming_like" ||
      relationship.status === "mutual_match" ||
      category === "friend",
    iLiked:
      category === "friend" ||
      relationship.status === "mutual_match" ||
      relationship.requestType === "outgoing_like" ||
      !!relationship.iLiked,
  });

  useFocusEffect(
    React.useCallback(() => {
      // Pull latest socket patches from cache the moment Chat tab opens
      const cached = getChatListCache(sessionVersion);
      if (cached.loaded) {
        listSnapshotRef.current = {
          conversations: cached.conversations,
          friendRows: cached.friendRows,
          requestRows: cached.requestRows,
          onlineRows: cached.onlineRows,
          archiveRows: cached.archiveRows || [],
        };
        for (const row of cached.archiveRows || []) {
          locallyArchivedIdsRef.current.add(row.otherId);
        }
        setConversations(cached.conversations);
        setFriendRows(cached.friendRows);
        setRequestRows(cached.requestRows);
        setOnlineRows(cached.onlineRows);
        setArchiveRows(cached.archiveRows || []);
        hasLoadedOnce.current = true;
        setLoading(false);
      }

      // WhatsApp-style: show cached list instantly; only refetch if stale
      const stale = Date.now() - lastLoadTime.current > 30000;
      if (!hasLoadedOnce.current || stale) {
        loadConversations(hasLoadedOnce.current);
      }
      refreshUnread();

      // Rare safety net only — realtime comes from sockets
      refreshInterval.current = setInterval(() => {
        loadConversations(true);
        refreshUnread();
      }, 90000);

      return () => {
        if (refreshInterval.current) {
          clearInterval(refreshInterval.current);
          refreshInterval.current = null;
        }
      };
    }, [loadConversations, refreshUnread, sessionVersion]),
  );

  // App returned to foreground while Chat tab may still be focused — force sync
  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      loadConversations(true);
      refreshUnread();
    });
    return () => sub.remove();
  }, [loadConversations, refreshUnread]);

  React.useEffect(() => {
    setChatListCache({ activeFilter, searchQuery, sessionVersion });
  }, [activeFilter, searchQuery, sessionVersion]);

  // Instant patch on like / unlike / request — then silent sync
  React.useEffect(() => {
    if (friendTick === 0 || !lastFriendUpdate) return;

    const payload = lastFriendUpdate;
    const otherId = String(
      payload.silent || payload.action === "sync"
        ? payload.otherUserId || payload.fromUserId
        : payload.fromUserId,
    );
    if (!otherId) return;

    const existing =
      listSnapshotRef.current.conversations.find(
        (c) => c.otherId === otherId,
      ) ||
      listSnapshotRef.current.requestRows.find((c) => c.otherId === otherId) ||
      listSnapshotRef.current.friendRows.find((c) => c.otherId === otherId) ||
      ({
        otherId,
        name: payload.fromName || "User",
        photo: resolvePhotoUrl(payload.fromPhoto || ""),
        gender: payload.fromGender || "",
        isOnline: false,
        lastMessage: "",
        lastMessageAt: Date.now(),
        unread: 0,
        category: "stranger" as ChatCategory,
      } satisfies ConversationItem);

    let action: Parameters<typeof patchListsForFriendAction>[3] | null = null;
    if (payload.action === "like") action = "incoming_like";
    else if (payload.action === "friends") action = "friends";
    else if (payload.action === "unlike" || payload.action === "decline") {
      // Soft remote withdraw — keep rows until THIS user deletes / declines / archives
      action = "soft_withdraw";
    } else if (payload.action === "sync") {
      if (payload.status === "friends") action = "friends";
      else if (payload.status === "pending_like") {
        // Do NOT map all pending_like → like_sent (that wiped Request rows).
        const alreadyIncoming =
          existing.category === "request" ||
          existing.requestType === "incoming_like" ||
          !!existing.theyLiked;
        const iLiked = !!(payload as any).iLiked || !!existing.iLiked;
        if (alreadyIncoming && !iLiked) action = "incoming_like";
        else if (alreadyIncoming && iLiked) action = "like_back";
        else if (iLiked && (existing.theyLiked || alreadyIncoming))
          action = "like_back";
        else if (iLiked) action = "like_sent";
        else action = "incoming_like";
      } else if (
        payload.status === "stranger" ||
        payload.status === "declined"
      ) {
        action = "soft_withdraw";
      }
    }

    if (action) {
      applyLocalFriendPatch(otherId, existing, action);
    }

    // Soft remote withdraw: keep local rows — no refetch race.
    if (action === "soft_withdraw") return;

    // Light delayed reconcile only (list already patched instantly)
    const t = setTimeout(() => {
      loadConversations(true);
      refreshUnread();
    }, 4000);
    return () => clearTimeout(t);
  }, [
    friendTick,
    lastFriendUpdate,
    applyLocalFriendPatch,
    loadConversations,
    refreshUnread,
  ]);

  // Instant preview/unread — hydrate from cache (already patched in SocketContext).
  // Do NOT re-apply lastChatListPreview: batched events left only the last patch
  // (often chat:notification with incrementUnread:false) and wiped badges.
  React.useEffect(() => {
    if (chatPreviewTick === 0) return;
    const otherId = String(lastChatListPreview?.otherUserId || "");
    if (otherId) {
      pendingDeletedRef.current.delete(otherId);
      locallyRemovedIdsRef.current.delete(otherId);
    }
    const cached = getChatListCache(sessionVersion);
    if (!cached.loaded) return;
    listSnapshotRef.current = {
      conversations: cached.conversations,
      friendRows: cached.friendRows,
      requestRows: cached.requestRows,
      onlineRows: cached.onlineRows,
      archiveRows: cached.archiveRows || [],
    };
    setConversations(cached.conversations);
    setFriendRows(cached.friendRows);
    setRequestRows(cached.requestRows);
    setOnlineRows(cached.onlineRows);
    setArchiveRows(cached.archiveRows || []);
  }, [chatPreviewTick, lastChatListPreview, sessionVersion]);

  // Rare background reconcile only (realtime is socket patches)
  React.useEffect(() => {
    if (chatListTick === 0) return;
    const now = Date.now();
    if (now - lastFullSyncRef.current < 60000) return;
    lastFullSyncRef.current = now;
    loadConversations(true);
    refreshUnread();
  }, [chatListTick, loadConversations, refreshUnread]);

  // Instant DP / name updates across All · Unread · Friend · Request · Online · Archive
  React.useEffect(() => {
    if (profileTick === 0 || !lastProfileUpdate?.userId) return;
    const uid = String(lastProfileUpdate.userId);
    const patch = (item: ConversationItem): ConversationItem => {
      if (item.otherId !== uid) return item;
      return {
        ...item,
        name: lastProfileUpdate.name || item.name,
        photo:
          lastProfileUpdate.photo != null
            ? lastProfileUpdate.photo
              ? resolvePhotoUrl(lastProfileUpdate.photo)
              : ""
            : item.photo,
        gender: lastProfileUpdate.gender || item.gender,
      };
    };
    const snap = listSnapshotRef.current;
    const next = {
      conversations: snap.conversations.map(patch),
      friendRows: snap.friendRows.map(patch),
      requestRows: snap.requestRows.map(patch),
      onlineRows: snap.onlineRows.map(patch),
      archiveRows: (snap.archiveRows || []).map(patch),
    };
    listSnapshotRef.current = { ...snap, ...next };
    setConversations(next.conversations);
    setFriendRows(next.friendRows);
    setRequestRows(next.requestRows);
    setOnlineRows(next.onlineRows);
    setArchiveRows(next.archiveRows);
    setChatListCache({ ...next, sessionVersion, loaded: true });
  }, [profileTick, lastProfileUpdate, sessionVersion]);

  // Chat deleted on this or another device — remove instantly
  React.useEffect(() => {
    if (
      conversationDeletedTick === 0 ||
      !lastConversationDeleted?.otherUserId
    ) {
      return;
    }
    removeUserFromLists(lastConversationDeleted.otherUserId);
    void clearThreadCache(user?.email, lastConversationDeleted.otherUserId);
    refreshUnread();
  }, [
    conversationDeletedTick,
    lastConversationDeleted,
    user?.email,
    refreshUnread,
  ]);

  // Instant online / offline across every category + Online tab
  React.useEffect(() => {
    if (presenceTick === 0 || !lastPresence?.userId) return;
    const uid = String(lastPresence.userId);
    const online = !!lastPresence.isOnline;
    const patch = (item: ConversationItem): ConversationItem =>
      item.otherId === uid
        ? {
            ...item,
            isOnline:
              item.privacyHidden || item.theyBlocked || item.iBlocked
                ? false
                : online,
          }
        : item;

    const snap = listSnapshotRef.current;
    let nextOnline = snap.onlineRows.map(patch);
    if (!online) {
      nextOnline = nextOnline.filter((r) => r.otherId !== uid);
    } else if (!nextOnline.some((r) => r.otherId === uid)) {
      const seed =
        snap.conversations.find((c) => c.otherId === uid) ||
        snap.friendRows.find((c) => c.otherId === uid) ||
        snap.requestRows.find((c) => c.otherId === uid) ||
        (snap.archiveRows || []).find((c) => c.otherId === uid);
      if (seed && !seed.privacyHidden && !seed.theyBlocked && !seed.iBlocked) {
        nextOnline = [
          {
            ...seed,
            isOnline: true,
            lastMessage: seed.lastMessage || "Online now",
            lastMessageAt: Date.now(),
          },
          ...nextOnline,
        ];
      }
    }

    const next = {
      conversations: snap.conversations.map(patch),
      friendRows: snap.friendRows.map(patch),
      requestRows: snap.requestRows.map(patch),
      archiveRows: (snap.archiveRows || []).map(patch),
      onlineRows: nextOnline,
    };
    listSnapshotRef.current = { ...snap, ...next };
    setConversations(next.conversations);
    setFriendRows(next.friendRows);
    setRequestRows(next.requestRows);
    setArchiveRows(next.archiveRows);
    setOnlineRows(next.onlineRows);
    setChatListCache({ ...next, sessionVersion, loaded: true });
  }, [presenceTick, lastPresence, sessionVersion]);

  const goToChat = (
    otherId: string,
    name: string,
    photo: string,
    gender: string,
    isOnline: boolean,
    privacyHidden = false,
    friendship?: {
      areFriends?: boolean;
      iLiked?: boolean;
      theyLiked?: boolean;
      relationshipStatus?: string;
    },
  ) => {
    void rememberPerson({
      id: otherId,
      name: name || "User",
      photo: privacyHidden ? "" : photo || "",
    });
    // WhatsApp: badge clears the instant you open the chat
    markChatAsRead(otherId);
    closeSearchMode();
    const matched =
      !!friendship?.areFriends ||
      friendship?.relationshipStatus === "friends" ||
      friendship?.relationshipStatus === "mutual_match";
    router.push({
      pathname: "/messages/[id]",
      params: {
        id: otherId,
        name,
        photo: privacyHidden ? "" : photo,
        gender,
        isOnline: privacyHidden ? "false" : isOnline ? "true" : "false",
        privacyHidden: privacyHidden ? "true" : "false",
        areFriends: matched ? "true" : "false",
        iLiked: friendship?.iLiked || matched ? "true" : "false",
        theyLiked: friendship?.theyLiked || matched ? "true" : "false",
        friendshipStatus:
          friendship?.relationshipStatus || (matched ? "friends" : ""),
      },
    });
  };

  const openUserProfile = async (item: ConversationItem) => {
    const seedPhoto = item.photo || "";
    // Only the most recent open may apply its late fetch result
    const requestId = ++profileRequestIdRef.current;
    setProfileUser({
      id: item.otherId,
      name: item.name,
      age: 0,
      bio: "",
      photo: seedPhoto,
      coverPhoto: "",
      photos: seedPhoto ? [seedPhoto] : [],
      gender: item.gender,
      interests: [],
      isOnline: item.isOnline,
      areFriends: item.areFriends,
      iLiked: item.iLiked,
      theyLiked: item.theyLiked,
      friendshipStatus: item.relationshipStatus,
    });
    setProfileModalVisible(true);

    try {
      const token = await getAuthToken();
      if (!token) return;
      const { user } = await fetchUserProfile(token, item.otherId);
      if (user && requestId === profileRequestIdRef.current) {
        setProfileUser({
          ...user,
          isOnline: item.isOnline,
          areFriends: item.areFriends ?? user.areFriends,
          iLiked: item.iLiked ?? user.iLiked,
          theyLiked: item.theyLiked ?? user.theyLiked,
          friendshipStatus: item.relationshipStatus ?? user.friendshipStatus,
        });
      }
    } catch {
      /* keep list data */
    }
  };

  const handleProfileMessage = () => {
    if (!profileUser) return;
    setProfileModalVisible(false);
    goToChat(
      profileUser.id,
      profileUser.name,
      profileUser.photo,
      profileUser.gender,
      !!profileUser.isOnline,
      false,
      {
        areFriends: profileUser.areFriends,
        iLiked: profileUser.iLiked,
        theyLiked: profileUser.theyLiked,
        relationshipStatus: profileUser.friendshipStatus,
      },
    );
  };

  const handleProfileLikeToggle = async () => {
    if (!profileUser || profileLiking) return;
    setProfileLiking(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const liked =
        profileUser.areFriends ||
        profileUser.iLiked ||
        profileUser.friendshipStatus === "friends" ||
        profileUser.friendshipStatus === "mutual_match";
      if (liked) {
        await unlikeUser(token, profileUser.id);
        setProfileUser((prev) =>
          prev
            ? {
                ...prev,
                areFriends: false,
                iLiked: false,
                friendshipStatus: "stranger",
              }
            : prev,
        );
      } else {
        await sendLike(token, profileUser.id);
        setProfileUser((prev) =>
          prev
            ? {
                ...prev,
                iLiked: true,
                friendshipStatus: prev.theyLiked
                  ? "mutual_match"
                  : "pending_like",
              }
            : prev,
        );
      }
      loadConversations(true);
    } catch (e: any) {
      showAlert({
        title: "Could not update",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    } finally {
      setProfileLiking(false);
    }
  };

  const friendCount = friendRows.length;
  const requestCount = requestRows.length;
  const unreadRows = conversations.filter((row) => (row.unread || 0) > 0);
  const unreadCount = unreadRows.reduce(
    (sum, row) => sum + (row.unread > 0 ? row.unread : 0),
    0,
  );
  const archiveUnread = archiveRows.reduce(
    (sum, row) => sum + (row.unread > 0 ? row.unread : 0),
    0,
  );
  const archiveCount = archiveUnread > 0 ? archiveUnread : 0;

  const removeUserFromLists = (otherId: string) => {
    pendingDeletedRef.current.add(otherId);
    locallyRemovedIdsRef.current.add(otherId);
    locallyArchivedIdsRef.current.delete(otherId);
    const next = removeConversationFromAllLists(
      listSnapshotRef.current,
      otherId,
    );
    listSnapshotRef.current = {
      ...listSnapshotRef.current,
      ...next,
    };
    setConversations(next.conversations);
    setFriendRows(next.friendRows);
    setRequestRows(next.requestRows);
    setOnlineRows(next.onlineRows);
    setArchiveRows(next.archiveRows);
    setChatListCache({ ...next, sessionVersion, loaded: true });
  };

  const removeUserFromMainLists = (otherId: string) => {
    // Do NOT mark as locallyRemoved — that wiped Archive on the next sync.
    const next = removeConversationFromMainLists(
      listSnapshotRef.current,
      otherId,
    );
    listSnapshotRef.current = {
      ...listSnapshotRef.current,
      ...next,
    };
    setConversations(next.conversations);
    setFriendRows(next.friendRows);
    setRequestRows(next.requestRows);
    setOnlineRows(next.onlineRows);
    setChatListCache({
      ...listSnapshotRef.current,
      sessionVersion,
      loaded: true,
    });
  };

  const confirmDeleteChat = (item: ConversationItem) => {
    showAlert({
      title: `Delete chat with ${getDisplayName(item.name)} ?`,
      message: "All messages will be permanently removed.",
      icon: "trash",
      actionsLayout: "horizontal",
      buttons: [
        {
          text: "Delete",
          icon: "trash-outline",
          style: "destructive",
          onPress: () => void handleDeleteChat(item),
        },
        { text: "Cancel", icon: "close-circle-outline" },
      ],
    });
  };

  const showChatActions = (item: ConversationItem) => {
    const inArchive = activeFilter === "Archive";
    showAlert({
      title: `Delete chat with ${getDisplayName(item.name)} ?`,
      icon: "chatbubbles",
      actionsLayout: "horizontal",
      buttons: [
        {
          text: "Delete",
          icon: "trash-outline",
          style: "destructive",
          onPress: () => confirmDeleteChat(item),
        },
        inArchive
          ? {
              text: "Unarchive",
              icon: "archive",
              onPress: () => void handleUnarchive(item),
            }
          : {
              text: "Archive",
              icon: "archive-outline",
              onPress: () => void handleArchive(item),
            },
        { text: "Cancel", style: "cancel" },
      ],
    });
  };

  const handleArchive = async (item: ConversationItem) => {
    const otherId = item.otherId;
    locallyArchivedIdsRef.current.add(otherId);
    locallyRemovedIdsRef.current.delete(otherId);
    pendingDeletedRef.current.delete(otherId);

    removeUserFromMainLists(otherId);

    const archivedItem: ConversationItem = {
      ...item,
      lastMessage: item.lastMessage || "Archived chat",
      lastMessageAt: item.lastMessageAt || Date.now(),
    };
    const nextArchive = [
      archivedItem,
      ...(listSnapshotRef.current.archiveRows || []).filter(
        (row) => row.otherId !== otherId,
      ),
    ];
    listSnapshotRef.current = {
      ...listSnapshotRef.current,
      archiveRows: nextArchive,
    };
    setArchiveRows(nextArchive);
    setChatListCache({
      ...listSnapshotRef.current,
      sessionVersion,
      loaded: true,
    });
    // Jump to Archive so the user sees it stayed (WhatsApp-style confirmation)
    setActiveFilter("Archive");

    try {
      const token = await getAuthToken();
      if (!token) return;
      await archiveConversation(token, otherId);
      // No full reload — Archive is independent; reload was wiping the row
    } catch (e: any) {
      locallyArchivedIdsRef.current.delete(otherId);
      loadConversations(true);
      showAlert({
        title: "Could not archive",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    }
  };

  const handleUnarchive = async (item: ConversationItem) => {
    const otherId = item.otherId;
    locallyArchivedIdsRef.current.delete(otherId);

    const nextArchive = (listSnapshotRef.current.archiveRows || []).filter(
      (row) => row.otherId !== otherId,
    );
    const restored: ConversationItem = {
      ...item,
      lastMessage: item.lastMessage || "Chat",
    };
    const nextConversations = [
      restored,
      ...listSnapshotRef.current.conversations.filter(
        (row) => row.otherId !== otherId,
      ),
    ];
    listSnapshotRef.current = {
      ...listSnapshotRef.current,
      archiveRows: nextArchive,
      conversations: nextConversations,
    };
    setArchiveRows(nextArchive);
    setConversations(nextConversations);
    setChatListCache({
      ...listSnapshotRef.current,
      sessionVersion,
      loaded: true,
    });
    setActiveFilter("All");

    try {
      const token = await getAuthToken();
      if (!token) return;
      await unarchiveConversation(token, otherId);
    } catch (e: any) {
      locallyArchivedIdsRef.current.add(otherId);
      loadConversations(true);
      showAlert({
        title: "Could not unarchive",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    }
  };

  const handleDeleteChat = async (item: ConversationItem) => {
    removeUserFromLists(item.otherId);
    void clearThreadCache(user?.email, item.otherId);
    try {
      const token = await getAuthToken();
      if (!token) {
        pendingDeletedRef.current.delete(item.otherId);
        loadConversations(true);
        return;
      }
      await deleteConversationPermanently(token, item.otherId);
      pendingDeletedRef.current.delete(item.otherId);
      refreshUnread();
    } catch (e: any) {
      pendingDeletedRef.current.delete(item.otherId);
      loadConversations(true);
      showAlert({
        title: "Could not delete",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    }
  };

  const source =
    activeFilter === "Friend"
      ? friendRows
      : activeFilter === "Request"
        ? requestRows
        : activeFilter === "Online"
          ? onlineRows
          : activeFilter === "Unread"
            ? unreadRows
            : activeFilter === "Archive"
              ? archiveRows
              : conversations;

  const filtered = source.filter((c) => {
    const matchSearch = c.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    if (!matchSearch) return false;
    return true; // All
  });

  const emptyCopy = () => {
    if (searchQuery) return { title: "No results", text: "" };
    if (activeFilter === "Online") return { title: "No one online", text: "" };
    if (activeFilter === "Unread") {
      return {
        title: "No unread chats",
        text: "You're all caught up.",
      };
    }
    if (activeFilter === "Archive") {
      return {
        title: "No archived chats",
        text: "Long-press a chat to archive it.",
      };
    }
    if (activeFilter === "Friend") {
      return {
        title: "No friends yet",
        text: "Like someone back from Requests to add them here.",
      };
    }
    if (activeFilter === "Request") {
      return {
        title: "No requests",
        text: "People who liked you will show here.",
      };
    }
    return {
      title: "No conversations yet",
      text: "Find someone nearby and start chatting!",
    };
  };

  const handleRequestAction = async (item: ConversationItem) => {
    if (updatingId) return;
    setUpdatingId(item.otherId);
    applyLocalFriendPatch(item.otherId, item, "friends");
    try {
      const token = await getAuthToken();
      if (!token) return;
      if (item.requestType === "mutual_match") {
        await acceptFriendRequest(token, item.otherId);
      } else {
        await sendLike(token, item.otherId);
      }
      loadConversations(true);
      showAlert({
        title: "You're friends!",
        message: "Moved to the Friend section.",
        icon: "heart",
      });
    } catch (e: any) {
      loadConversations(true);
      showAlert({
        title: "Could not update request",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDecline = async (item: ConversationItem) => {
    if (updatingId) return;
    setUpdatingId(item.otherId);
    applyLocalFriendPatch(item.otherId, item, "decline");
    try {
      const token = await getAuthToken();
      if (!token) return;
      await declineFriendRequest(token, item.otherId);
      loadConversations(true);
    } catch (e: any) {
      loadConversations(true);
      showAlert({
        title: "Could not decline request",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const renderRequestActions = (item: ConversationItem) => (
    <View style={styles.requestActions}>
    <TouchableOpacity
        style={styles.declineButton}
        onPress={() => handleDecline(item)}
        disabled={updatingId === item.otherId}
      activeOpacity={0.7}
      >
        <Ionicons name="close" size={16} color={C.muted} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.likeBackButton}
        onPress={() => handleRequestAction(item)}
        disabled={updatingId === item.otherId}
        activeOpacity={0.75}
      >
        {updatingId === item.otherId ? (
          <ActivityIndicator size="small" color={C.purple} />
        ) : (
          <>
            <Ionicons name="heart-outline" size={14} color={C.purple} />
            <Text style={styles.likeBackText}>
              {item.requestType === "mutual_match" ? "Accept" : "Like back"}
            </Text>
          </>
        )}
      </TouchableOpacity>
      </View>
  );

  const renderUnreadBadge = (item: ConversationItem) => {
    if (!item.unread || item.unread <= 0) return null;
    return (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>
          {item.unread > 99 ? "99+" : item.unread}
        </Text>
      </View>
    );
  };

  const renderTrailing = (item: ConversationItem) => {
    if (activeFilter === "Request") {
      return renderRequestActions(item);
    }
    if (activeFilter === "Archive") {
      return (
        <View style={styles.trailingMeta}>
          {renderUnreadBadge(item) || (
            <Ionicons name="archive-outline" size={16} color={C.muted} />
          )}
        </View>
      );
    }
    return renderUnreadBadge(item);
  };

  const renderConversation = React.useCallback(
    (item: ConversationItem) => (
    <TouchableOpacity
      style={styles.chatItem}
      activeOpacity={0.55}
      onPress={() =>
        goToChat(
          item.otherId,
          item.name,
          item.photo,
          item.gender,
          item.isOnline,
          !!item.privacyHidden || !!item.theyBlocked,
          {
            areFriends: item.areFriends,
            iLiked: item.iLiked,
            theyLiked: item.theyLiked,
            relationshipStatus: item.relationshipStatus,
          },
        )
      }
      onLongPress={() => showChatActions(item)}
      delayLongPress={320}
    >
      <TouchableOpacity
        style={styles.avatarWrap}
        activeOpacity={0.85}
        onPress={() => openUserProfile(item)}
      >
        <WhatsAppAvatar
          photo={item.photo}
          name={item.name}
          gender={item.gender}
          size={52}
          online={
            !!item.isOnline &&
            !item.privacyHidden &&
            !item.theyBlocked &&
            !item.iBlocked
          }
          privacyHidden={!!item.privacyHidden || !!item.theyBlocked}
        />
      </TouchableOpacity>

      <View style={styles.chatInfo}>
        <View style={styles.chatRow}>
          <View style={styles.nameRow}>
            <Text style={styles.chatName} numberOfLines={1}>
              {getDisplayName(item.name)}
            </Text>
            {item.category === "request" && activeFilter !== "Request" && (
              <View style={styles.requestTag}>
                <Text style={styles.requestTagText}>Request</Text>
              </View>
            )}
          </View>
          {activeFilter !== "Request" ? (
            <Text
              style={[
                styles.chatTime,
                item.unread > 0 && styles.chatTimeUnread,
              ]}
            >
            {formatChatListTime(item.lastMessageAt)}
          </Text>
          ) : null}
        </View>
        <View style={styles.chatRow}>
          <Text
            style={[
              styles.lastMessage,
              item.unread > 0 && styles.lastMessageUnread,
            ]}
            numberOfLines={1}
          >
            {item.lastMessage}
          </Text>
          {activeFilter !== "Request" ? renderTrailing(item) : null}
            </View>
        </View>

      {activeFilter === "Request" ? (
        <View style={styles.requestActionsCenter}>
          {renderRequestActions(item)}
      </View>
      ) : null}
    </TouchableOpacity>
    ),
    [
      activeFilter,
      goToChat,
      showChatActions,
      openUserProfile,
      renderTrailing,
      renderRequestActions,
    ],
  );

  const renderConversationItem = React.useCallback(
    ({ item }: { item: ConversationItem }) => renderConversation(item),
    [renderConversation],
  );

  /** Memoized so the unread sum isn't recomputed over the whole list each render */
  const listExtraData = React.useMemo(
    () =>
      `${activeFilter}:${filtered.length}:${chatPreviewTick}:${presenceTick}:${friendTick}:${archiveUnread}:${filtered.reduce(
        (s, r) => s + (r.unread || 0),
        0,
      )}:${filtered[0]?.otherId || ""}:${filtered[0]?.lastMessageAt || 0}`,
    [
      activeFilter,
      filtered,
      chatPreviewTick,
      presenceTick,
      friendTick,
      archiveUnread,
    ],
  );

  const keyExtractConversation = React.useCallback(
    (item: ConversationItem) => item.otherId,
    [],
  );

  const empty = emptyCopy();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Chats</Text>
        </View>
      <View style={styles.container}>
        {/* ── Search (opens search page) ── */}
        <View ref={searchBarRef} collapsable={false}>
          <TouchableOpacity
            style={[
              styles.searchContainer,
              searchMode && styles.searchContainerHidden,
            ]}
            activeOpacity={0.85}
            onPress={() => {
              setSearchQuery("");
              searchBarRef.current?.measureInWindow((_x, y) => {
                if (typeof y === "number" && y > 0) setSearchBarY(y);
                setSearchMode(true);
              });
            }}
          >
            <Ionicons
              name="search"
              size={18}
              color="#65676B"
              style={styles.searchIcon}
            />
            <Text style={styles.searchPlaceholder}>Search</Text>
          </TouchableOpacity>
        </View>

        <SearchModeOverlay
          visible={searchMode}
          query={searchQuery}
          onChangeQuery={setSearchQuery}
          onClose={closeSearchMode}
          placeholder="Search"
          recent={recentSearches}
          backgroundColor={C.bg}
          fromY={searchBarY}
          onClearAll={() => {
            void clearRecentSearches(RECENT_SEARCH_CHAT).then(
              setRecentSearches,
            );
          }}
          onSelectRecent={(person) => {
            const match =
              conversations.find((c) => c.otherId === person.id) ||
              friendRows.find((c) => c.otherId === person.id) ||
              onlineRows.find((c) => c.otherId === person.id) ||
              archiveRows.find((c) => c.otherId === person.id) ||
              requestRows.find((c) => c.otherId === person.id);
            if (match) {
              goToChat(
                match.otherId,
                match.name,
                match.photo,
                match.gender,
                !!match.isOnline,
                !!match.privacyHidden || !!match.theyBlocked,
                {
                  areFriends: match.areFriends,
                  iLiked: match.iLiked,
                  theyLiked: match.theyLiked,
                  relationshipStatus: match.relationshipStatus,
                },
              );
              return;
            }
            setSearchQuery(person.query || person.name);
          }}
        >
          {filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No results</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.otherId}
              renderItem={({ item }) => renderConversation(item)}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </SearchModeOverlay>

        {/* ── Filter tabs (same size as Notifications) ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersRow}
          style={styles.filtersScroll}
        >
          {(
            [
              "All",
              "Unread",
              "Friend",
              "Request",
              "Online",
              "Archive",
            ] as const
          ).map((f) => {
            const active = activeFilter === f;
            const count =
              f === "Friend"
                ? friendCount
                : f === "Request"
                  ? requestCount
                  : f === "Online"
                    ? onlineRows.length
                    : f === "Unread"
                      ? unreadCount
                      : f === "Archive"
                        ? archiveCount
                        : 0;
            const showCount =
              f === "Archive"
                ? archiveUnread > 0
                : f === "Unread"
                  ? unreadCount > 0
                  : f === "Friend" || f === "Request" || f === "Online"
                    ? count > 0
                    : false;
            return (
              <TouchableOpacity
                key={f}
                style={[styles.filterPill, active && styles.filterPillActive]}
                onPress={() => setActiveFilter(f)}
                activeOpacity={1}
              >
                <Text
                  style={[styles.filterText, active && styles.filterTextActive]}
                  numberOfLines={1}
                >
                  {f}
                </Text>
                {showCount ? (
                  <View
                    style={[
                      styles.filterCount,
                      active && styles.filterCountActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterCountText,
                        active && styles.filterCountTextActive,
                      ]}
                    >
                      {count > 99 ? "99+" : count}
                    </Text>
          </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── Content ── */}
        {loading &&
        conversations.length === 0 &&
        friendRows.length === 0 &&
        requestRows.length === 0 ? (
          <ListRowSkeleton count={7} />
        ) : filtered.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons
              name={
                activeFilter === "Request"
                  ? "mail-unread-outline"
                  : activeFilter === "Friend"
                    ? "people-outline"
                    : activeFilter === "Unread"
                      ? "chatbubble-ellipses-outline"
                      : activeFilter === "Archive"
                        ? "archive-outline"
                        : "chatbubbles-outline"
              }
              size={48}
              color={C.muted}
            />
            <Text style={styles.emptyTitle}>{empty.title}</Text>
            {!!empty.text && <Text style={styles.emptyText}>{empty.text}</Text>}
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={keyExtractConversation}
            extraData={listExtraData}
            renderItem={renderConversationItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 110 }}
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={9}
            removeClippedSubviews={Platform.OS === "android"}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onPullRefresh}
                tintColor={C.purple}
                colors={[C.purple]}
              />
            }
          />
        )}
      </View>

      <UserProfileModal
        visible={profileModalVisible}
        user={profileUser}
        onClose={() => {
          setProfileModalVisible(false);
          setProfileUser(null);
        }}
        onLike={handleProfileLikeToggle}
        onUnlike={handleProfileLikeToggle}
        onMessage={handleProfileMessage}
        likingInProgress={profileLiking}
        onBlocked={() => {
          setProfileModalVisible(false);
          setProfileUser(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: C.bg,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: C.black,
    letterSpacing: -0.3,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E4E6EB",
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 10,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 20,
  },
  searchContainerHidden: {
    opacity: 0,
  },
  searchIcon: { marginRight: 10 },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#050505",
    paddingVertical: 0,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 16,
    color: "#65676B",
  },
  filtersScroll: {
    flexGrow: 0,
  },
  filtersRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 8,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: C.pill,
    flexShrink: 0,
  },
  filterPillActive: {
    backgroundColor: C.pillActive,
  },
  filterText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.muted,
    includeFontPadding: false,
  },
  filterTextActive: {
    color: "#FFFFFF",
  },
  filterCount: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: C.purple,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  filterCountActive: {
    backgroundColor: "#FFFFFF",
  },
  filterCountText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    includeFontPadding: false,
  },
  filterCountTextActive: {
    color: "#111111",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 60,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 48,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: C.secondary,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 13.5,
    color: C.muted,
    textAlign: "center",
    paddingHorizontal: 40,
    lineHeight: 18,
  },
  chatItem: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.purpleSoft,
  },
  onlineStatusDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#4CAF50",
    borderWidth: 2,
    borderColor: "#fff",
  },
  chatInfo: {
    flex: 1,
    marginLeft: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    minHeight: 52,
    justifyContent: "center",
    gap: 2,
  },
  chatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
    marginRight: 8,
  },
  chatName: {
    fontSize: 16,
    fontWeight: "500",
    color: C.black,
    flexShrink: 1,
  },
  chatNameUnread: {
    fontWeight: "700",
  },
  requestTag: {
    backgroundColor: C.purpleSoft,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  requestTagText: {
    fontSize: 9.5,
    fontWeight: "600",
    color: C.purple,
  },
  friendTag: {
    backgroundColor: C.purpleSoft,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  friendTagText: {
    fontSize: 9.5,
    fontWeight: "600",
    color: C.purple,
  },
  trailingMeta: {
    minWidth: 22,
    alignItems: "flex-end",
    justifyContent: "center",
    marginLeft: 8,
  },
  likeBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  requestActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  requestActionsCenter: {
    marginLeft: 8,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "stretch",
  },
  declineButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.purpleSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  likeBackButton: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: C.purpleMid,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  likeBackText: {
    color: C.purple,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  unlikeButton: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#FFF0F3",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  unlikeText: {
    color: "#FF4B6E",
    fontSize: 12,
    fontWeight: "600",
  },
  chatTime: {
    fontSize: 11.5,
    color: C.muted,
    fontWeight: "400",
  },
  chatTimeUnread: {
    color: C.purple,
    fontWeight: "600",
  },
  lastMessage: {
    fontSize: 13.5,
    color: C.muted,
    flex: 1,
    marginRight: 10,
  },
  lastMessageUnread: {
    color: C.black,
    fontWeight: "500",
  },
  badge: {
    backgroundColor: C.purple,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 5,
    marginLeft: 8,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10.5,
    fontWeight: "700",
  },
});
