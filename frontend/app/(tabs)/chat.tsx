import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import {
    ActivityIndicator,
    FlatList,
    Platform,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppAlert } from "../../components/AppAlert";
import { ListRowSkeleton } from "../../components/ScreenSkeleton";
import UserProfileModal from "../../components/UserProfileModal";
import WhatsAppAvatar, {
    getDisplayName,
} from "../../components/WhatsAppAvatar";
import { useAuth } from "../../contexts/AuthContext";
import { useSocket } from "../../contexts/SocketContext";
import { API_BASE, apiRequest } from "../../utils/api";
import { getAuthToken, getCurrentAuthUser } from "../../utils/auth";
import { uploadMyLocation, fetchUserProfile, NearbyUser } from "../../utils/nearby";
import {
  getChatListCache,
  setChatListCache,
  hydrateChatListCache,
  type ConversationItem,
  type ChatFilterKey,
} from "../../utils/chatListCache";
import {
  patchListsForFriendAction,
  removeConversationFromAllLists,
  removeConversationFromMainLists,
} from "../../utils/friendListPatch";
import { applyChatListPreviewPatch } from "../../utils/chatListPreviewPatch";
import {
  preloadRecentThreads,
  setThreadCacheAccount,
  clearThreadCache,
} from "../../utils/threadCache";
import {
  archiveConversation,
  deleteConversationPermanently,
  fetchArchivedConversations,
  unarchiveConversation,
} from "../../utils/chatActions";
import {
    acceptFriendRequest,
    declineFriendRequest,
    FriendRequest,
    getFriendRequests,
    getFriendsList,
    sendLike,
    unlikeUser,
} from "../../utils/friends";
import { formatChatListTime, useTimeTick } from "../../utils/timeFormat";

/**
 * Convert relative photo URL to absolute URL
 */
function resolvePhotoUrl(photo: string): string {
  if (!photo) return "";
  if (photo.startsWith("http") || photo.startsWith("data:")) return photo;
  return `${API_BASE}${photo}`;
}

type ChatCategory = "friend" | "request" | "stranger";

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
    lastMessage:
      msg.text || (msg.type === "image" ? "📷 Photo" : "🎵 Voice"),
    lastMessageAt: new Date(msg.createdAt).getTime(),
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
  const { chatListTick, chatPreviewTick, lastChatListPreview, friendTick, lastFriendUpdate, conversationDeletedTick, lastConversationDeleted, refreshUnread, presenceTick, lastPresence } =
    useSocket();
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
  const [searchQuery, setSearchQuery] = React.useState(cached.searchQuery);

  const hasLoadedOnce = React.useRef(cached.loaded);
  const lastLoadTime = React.useRef(cached.at);
  const pendingDeletedRef = React.useRef(new Set<string>());
  const lastFullSyncRef = React.useRef(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [profileModalVisible, setProfileModalVisible] = React.useState(false);
  const [profileUser, setProfileUser] = React.useState<NearbyUser | null>(null);
  const [profileLiking, setProfileLiking] = React.useState(false);
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
      const next = patchListsForFriendAction(
        listSnapshotRef.current,
        otherId,
        item,
        action,
      );
      setConversations(next.conversations);
      setFriendRows(next.friendRows);
      setRequestRows(next.requestRows);
      setOnlineRows(next.onlineRows);
      setChatListCache({ ...next, sessionVersion, loaded: true });
    },
    [sessionVersion],
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
        setSearchQuery(hydrated.searchQuery);
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
            // Online strip needs GPS too — upload first; ignore failures
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

        const dataRaw =
          convRes.status === "fulfilled" ? (convRes.value as any) : null;
        const data: any[] = Array.isArray(dataRaw)
          ? dataRaw
          : Array.isArray(dataRaw?.conversations)
            ? dataRaw.conversations
            : [];

        const requests: FriendRequest[] =
          reqRes.status === "fulfilled" && Array.isArray(reqRes.value)
            ? reqRes.value
            : [];
        const friends: FriendRequest[] =
          friendsRes.status === "fulfilled" && Array.isArray(friendsRes.value)
            ? friendsRes.value
            : [];
        const outgoingLikes: FriendRequest[] =
          likesRes.status === "fulfilled" && Array.isArray(likesRes.value)
            ? likesRes.value
            : [];

        const nearbyRaw =
          nearbyRes.status === "fulfilled" ? (nearbyRes.value as any) : null;
        const nearby: any[] = Array.isArray(nearbyRaw)
          ? nearbyRaw
          : Array.isArray(nearbyRaw?.users)
            ? nearbyRaw.users
            : [];

        if (convRes.status === "rejected") {
          console.warn("conversations fetch failed:", convRes.reason);
        }
        if (reqRes.status === "rejected") {
          console.warn("friend requests fetch failed:", reqRes.reason);
        }
        if (friendsRes.status === "rejected") {
          console.warn("friends list fetch failed:", friendsRes.reason);
        }

        const authUser = await getCurrentAuthUser();
        const myId = String(authUser?.id || "");

        const items: ConversationItem[] = data
          .map((c: any) => apiConversationToItem(c, myId))
          .filter(Boolean) as ConversationItem[];

        const archivedData =
          archivedRes.status === "fulfilled" && Array.isArray(archivedRes.value)
            ? archivedRes.value
            : [];
        const nextArchived = archivedData
          .map((c: any) => apiConversationToItem(c, myId))
          .filter(Boolean)
          .filter((row) => !pendingDeletedRef.current.has(row.otherId)) as ConversationItem[];

        // Merge request-only users into All if they have no chat yet
        const byId = new Map(items.map((item) => [item.otherId, item]));
        for (const request of requests) {
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
        for (const friend of friends) {
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
        // People I liked (outgoing) — restore likes even without a chat yet
        for (const like of outgoingLikes) {
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

        const merged = Array.from(byId.values())
          .filter((row) => !pendingDeletedRef.current.has(row.otherId))
          .sort((a, b) => b.lastMessageAt - a.lastMessageAt);

        const archivedIds = new Set(nextArchived.map((row) => row.otherId));
        const hideArchived = (rows: ConversationItem[]) =>
          rows.filter(
            (row) =>
              !archivedIds.has(row.otherId) &&
              !pendingDeletedRef.current.has(row.otherId),
          );

        const nextRequests = hideArchived(
          requests.map((request) => relationshipToRow(request, "request")),
        );
        const nextFriends = hideArchived(
          friends.map((friend) => relationshipToRow(friend, "friend")),
        );
        const nextOnline = nearby
          .filter(
            (person: any) =>
              !!person.isOnline &&
              !pendingDeletedRef.current.has(String(person.id || person._id)),
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
              requestType: person.theyLiked ? "incoming_like" : undefined,
            };
          });

        setConversations(hideArchived(merged));
        setRequestRows(nextRequests);
        setFriendRows(nextFriends);
        setOnlineRows(hideArchived(nextOnline));
        setArchiveRows(nextArchived);
        setChatListCache({
          conversations: hideArchived(merged),
          requestRows: nextRequests,
          friendRows: nextFriends,
          onlineRows: hideArchived(nextOnline),
          archiveRows: nextArchived,
          sessionVersion,
          loaded: true,
        });

        if (user?.email) {
          void preloadRecentThreads(
            user.email,
            merged.map((c) => c.otherId),
            token,
            8,
          );
        }
      } catch (e) {
        console.error("Failed to load conversations", e);
      } finally {
        hasLoadedOnce.current = true;
        lastLoadTime.current = Date.now();
        setLoading(false);
      }
    },
    [sessionVersion, user?.email],
  );

  const applyChatPreview = React.useCallback(
    (patch: Parameters<typeof applyChatListPreviewPatch>[1]) => {
      const next = applyChatListPreviewPatch(listSnapshotRef.current, patch);
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
    },
    [sessionVersion],
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
    iLiked:
      category === "friend" ||
      relationship.status === "mutual_match" ||
      relationship.requestType === "outgoing_like" ||
      !!relationship.iLiked,
  });

  useFocusEffect(
    React.useCallback(() => {
      loadConversations(hasLoadedOnce.current);
      refreshUnread();

      refreshInterval.current = setInterval(() => {
        loadConversations(true);
        refreshUnread();
      }, 45000);

      return () => {
        if (refreshInterval.current) {
          clearInterval(refreshInterval.current);
          refreshInterval.current = null;
        }
      };
    }, [loadConversations, refreshUnread]),
  );

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
      listSnapshotRef.current.conversations.find((c) => c.otherId === otherId) ||
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
    else if (payload.action === "unlike") action = "unlike";
    else if (payload.action === "decline") action = "decline";
    else if (payload.action === "sync") {
      if (payload.status === "pending_like") action = "like_sent";
      else if (payload.status === "friends") action = "friends";
      else if (payload.status === "stranger" || payload.status === "declined")
        action = "unlike";
    }

    if (action) {
      applyLocalFriendPatch(otherId, existing, action);
    }

    loadConversations(true);
    refreshUnread();
  }, [
    friendTick,
    lastFriendUpdate,
    applyLocalFriendPatch,
    loadConversations,
    refreshUnread,
  ]);

  // Instant preview bump — no full API reload (WhatsApp-style)
  React.useEffect(() => {
    if (chatPreviewTick === 0 || !lastChatListPreview) return;
    applyChatPreview(lastChatListPreview);
  }, [chatPreviewTick, lastChatListPreview, applyChatPreview]);

  // Background full sync — throttled so list stays smooth
  React.useEffect(() => {
    if (chatListTick === 0) return;
    const now = Date.now();
    if (now - lastFullSyncRef.current < 20000) return;
    lastFullSyncRef.current = now;
    loadConversations(true);
    refreshUnread();
  }, [chatListTick, loadConversations, refreshUnread]);

  // Chat deleted on this or another device — remove instantly
  React.useEffect(() => {
    if (conversationDeletedTick === 0 || !lastConversationDeleted?.otherUserId) {
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

  // Instant online / offline dots without full list reload
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

    setConversations((prev) => prev.map(patch));
    setFriendRows((prev) => prev.map(patch));
    setRequestRows((prev) => prev.map(patch));
    setOnlineRows((prev) => {
      const next = prev.map(patch);
      if (online) {
        // If they just came online and aren't in Online tab yet, leave loadConversations to refill
        return next;
      }
      return next.filter((r) => r.otherId !== uid || r.isOnline);
    });
  }, [presenceTick, lastPresence]);

  const goToChat = (
    otherId: string,
    name: string,
    photo: string,
    gender: string,
    isOnline: boolean,
    privacyHidden = false,
  ) => {
    router.push({
      pathname: "/messages/[id]",
      params: {
        id: otherId,
        name,
        photo: privacyHidden ? "" : photo,
        gender,
        isOnline: privacyHidden ? "false" : isOnline ? "true" : "false",
        privacyHidden: privacyHidden ? "true" : "false",
      },
    });
  };

  const openUserProfile = async (item: ConversationItem) => {
    const seedPhoto = item.photo || "";
    setProfileUser({
      id: item.otherId,
      name: item.name,
      age: 0,
      bio: "",
      photo: seedPhoto,
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
      if (user) {
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
      profileUser.isOnline,
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
                friendshipStatus: prev.theyLiked ? "mutual_match" : "pending_like",
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
  const archiveCount = archiveRows.length;

  const removeUserFromLists = (otherId: string) => {
    pendingDeletedRef.current.add(otherId);
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
    removeUserFromMainLists(item.otherId);
    const archivedItem = {
      ...item,
      lastMessage: item.lastMessage || "Archived",
    };
    setArchiveRows((prev) => {
      const nextArchive = [
        archivedItem,
        ...prev.filter((row) => row.otherId !== item.otherId),
      ];
      listSnapshotRef.current = {
        ...listSnapshotRef.current,
        archiveRows: nextArchive,
      };
      setChatListCache({
        ...listSnapshotRef.current,
        sessionVersion,
        loaded: true,
      });
      return nextArchive;
    });
    try {
      const token = await getAuthToken();
      if (!token) return;
      await archiveConversation(token, item.otherId);
      loadConversations(true);
    } catch (e: any) {
      loadConversations(true);
      showAlert({
        title: "Could not archive",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    }
  };

  const handleUnarchive = async (item: ConversationItem) => {
    setArchiveRows((prev) => prev.filter((row) => row.otherId !== item.otherId));
    try {
      const token = await getAuthToken();
      if (!token) return;
      await unarchiveConversation(token, item.otherId);
      loadConversations(true);
    } catch (e: any) {
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
      >
        <Ionicons name="close" size={13} color="#666" />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.likeBackButton}
        onPress={() => handleRequestAction(item)}
        disabled={updatingId === item.otherId}
      >
        {updatingId === item.otherId ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name="heart" size={11} color="#fff" />
            <Text style={styles.likeBackText}>
              {item.requestType === "mutual_match" ? "Accept" : "Like Back"}
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
          <Ionicons name="archive-outline" size={16} color="#AAA" />
        </View>
      );
    }
    return renderUnreadBadge(item);
  };

  const renderConversation = (item: ConversationItem) => (
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
          <Text
            style={[styles.chatTime, item.unread > 0 && styles.chatTimeUnread]}
          >
            {formatChatListTime(item.lastMessageAt)}
          </Text>
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
          {renderTrailing(item)}
        </View>
      </View>
    </TouchableOpacity>
  );

  const empty = emptyCopy();

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={{ flex: 1 }}>
        {/* ── Header (WhatsApp-style) ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Chats</Text>
        </View>

        {/* ── Search ── */}
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={18}
            color="#888"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search"
            placeholderTextColor="#888"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* ── Filter tabs ── */}
        <View style={styles.filtersRow}>
          {(["All"] as const).map((f) => {
            const active = activeFilter === f;
            return (
              <TouchableOpacity
                key={f}
                style={[
                  styles.filterPill,
                  styles.filterPillAll,
                  active && styles.filterPillActive,
                ]}
                onPress={() => setActiveFilter(f)}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.filterText, active && styles.filterTextActive]}
                  numberOfLines={1}
                >
                  {f}
                </Text>
              </TouchableOpacity>
            );
          })}
          <View style={styles.filtersGroup}>
            {(["Friend", "Request", "Online", "Archive"] as const).map((f) => {
              const active = activeFilter === f;
              const count =
                f === "Friend"
                  ? friendCount
                  : f === "Request"
                    ? requestCount
                    : archiveCount;
              const showCount = count > 0;
              return (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.filterPill,
                    styles.filterPillEqual,
                    active && styles.filterPillActive,
                  ]}
                  onPress={() => setActiveFilter(f)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.filterText,
                      styles.filterTextEqual,
                      active && styles.filterTextActive,
                    ]}
                    numberOfLines={1}
                    {...(Platform.OS === "android"
                      ? {
                          adjustsFontSizeToFit: true,
                          minimumFontScale: 0.85,
                        }
                      : {})}
                  >
                    {f}
                  </Text>
                  {showCount ? (
                    <View
                      style={[
                        styles.filterCount,
                        active && styles.filterCountActive,
                        f === "Request" &&
                          requestCount > 0 &&
                          !active &&
                          styles.filterCountAlert,
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
          </View>
        </View>

        {/* ── Content ── */}
        {loading && conversations.length === 0 && friendRows.length === 0 && requestRows.length === 0 ? (
          <ListRowSkeleton count={7} />
        ) : filtered.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons
              name={
                activeFilter === "Request"
                  ? "mail-unread-outline"
                  : activeFilter === "Friend"
                    ? "people-outline"
                    : activeFilter === "Archive"
                      ? "archive-outline"
                      : "chatbubbles-outline"
              }
              size={48}
              color="#DDD"
            />
            <Text style={styles.emptyTitle}>{empty.title}</Text>
            {!!empty.text && <Text style={styles.emptyText}>{empty.text}</Text>}
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.otherId}
            renderItem={({ item }) => renderConversation(item)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 110 }}
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={9}
            removeClippedSubviews
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onPullRefresh}
                tintColor="#25D366"
                colors={["#25D366"]}
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
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1a1a1a",
    letterSpacing: -0.3,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
    marginHorizontal: 12,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    marginBottom: 10,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#333",
    paddingVertical: 0,
  },
  filtersRow: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 6,
  },
  filtersGroup: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: "#F5F5F5",
  },
  filterPillAll: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 12,
  },
  filterPillEqual: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 4,
  },
  filterPillActive: {
    backgroundColor: "#F3E5F5",
  },
  filterText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    includeFontPadding: false,
  },
  filterTextEqual: {
    fontSize: 11,
    textAlign: "center",
  },
  filterTextActive: {
    color: "#8E2DE2",
  },
  filterCount: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    marginLeft: 1,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  filterCountActive: {
    backgroundColor: "#111",
  },
  filterCountAlert: {
    backgroundColor: "#111",
  },
  filterCountText: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "#fff",
  },
  filterCountTextActive: {
    color: "#fff",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 60,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#666",
    marginTop: 8,
  },
  emptyText: {
    fontSize: 13.5,
    color: "#AAA",
    textAlign: "center",
    paddingHorizontal: 40,
    lineHeight: 18,
  },
  chatItem: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#f5f5f5",
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
    borderBottomColor: "#ECECEC",
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
    color: "#1a1a1a",
    flexShrink: 1,
  },
  requestTag: {
    backgroundColor: "#F3E5F5",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  requestTagText: {
    fontSize: 9.5,
    fontWeight: "600",
    color: "#8E2DE2",
  },
  friendTag: {
    backgroundColor: "#EDE7F6",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  friendTagText: {
    fontSize: 9.5,
    fontWeight: "600",
    color: "#8E2DE2",
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
    gap: 5,
  },
  declineButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#F1F1F1",
    alignItems: "center",
    justifyContent: "center",
  },
  likeBackButton: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: "#8E2DE2",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  likeBackText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  unlikeButton: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: "#FFF0F3",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  unlikeText: {
    color: "#FF4B6E",
    fontSize: 10,
    fontWeight: "700",
  },
  chatTime: {
    fontSize: 11.5,
    color: "#bbb",
    fontWeight: "400",
  },
  chatTimeUnread: {
    color: "#8E2DE2",
    fontWeight: "600",
  },
  lastMessage: {
    fontSize: 13.5,
    color: "#888",
    flex: 1,
    marginRight: 10,
  },
  lastMessageUnread: {
    color: "#333",
    fontWeight: "500",
  },
  badge: {
    backgroundColor: "#111",
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
