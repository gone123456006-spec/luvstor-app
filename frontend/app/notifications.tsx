import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Dimensions,
    FlatList,
    Modal,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppAlert } from "../components/AppAlert";
import { ListRowSkeleton } from "../components/ScreenSkeleton";
import UserProfileModal from "../components/UserProfileModal";
import WhatsAppAvatar, { getDisplayName } from "../components/WhatsAppAvatar";
import { useSocket } from "../contexts/SocketContext";
import { API_BASE } from "../utils/api";
import { getAuthToken } from "../utils/auth";
import { sendLike } from "../utils/friends";
import {
    AppNotification,
    clearAllNotifications,
    deleteNotification,
    fetchNotifications,
    markNotificationsRead,
    markNotificationsUnread,
} from "../utils/notifications";
import { routeForData } from "../utils/push";
import { fetchSubscriptionStatus } from "../utils/subscriptions";

const PAGE_SIZE = 25;

const C = {
  purple: "#370372",
  purpleSoft: "#EFE8F8",
  purpleMid: "#5B2A9E",
  text: "#1C1B1F",
  muted: "#667781",
  preview: "#667781",
  border: "#E9EDEF",
  searchBg: "#E4E6EB",
  pill: "#E4E6EB",
  pillActive: "#111111",
  bg: "#F5F5F7",
  gold: "#F5C518",
};

type FilterKey = "All" | "Unread" | "Profile View";

type ListRow =
  | { kind: "section"; id: string; title: string }
  | { kind: "item"; id: string; item: AppNotification };

function resolvePhoto(photo?: string) {
  if (!photo) return "";
  if (photo.startsWith("http") || photo.startsWith("data:")) return photo;
  return `${API_BASE}${photo}`;
}

function typeMeta(type: AppNotification["type"]) {
  switch (type) {
    case "friend_request":
      return {
        icon: "heart" as const,
        color: "#FF4B6E",
        bg: "#FFE8EE",
        label: "Request",
      };
    case "like":
      return {
        icon: "heart" as const,
        color: "#FF4B6E",
        bg: "#FFE8EE",
        label: "Like",
      };
    case "match":
      return {
        icon: "flame" as const,
        color: "#FF4B6E",
        bg: "#FFE8EE",
        label: "Match",
      };
    case "friends":
      return {
        icon: "people" as const,
        color: C.purple,
        bg: C.purpleSoft,
        label: "Friends",
      };
    case "profile_view":
      return {
        icon: "eye" as const,
        color: C.purple,
        bg: C.purpleSoft,
        label: "Profile View",
      };
    case "chat":
      return {
        icon: "chatbubble" as const,
        color: C.purple,
        bg: C.purpleSoft,
        label: "Message",
      };
    case "call":
      return {
        icon: "call" as const,
        color: "#25D366",
        bg: "#E7F8EF",
        label: "Call",
      };
    case "token":
    case "token_purchase":
      return {
        icon: "diamond" as const,
        color: "#F59E0B",
        bg: "#FFF8E6",
        label: "Tokens",
      };
    case "token_low":
      return {
        icon: "alert-circle" as const,
        color: "#EA4335",
        bg: "#FDECEA",
        label: "Tokens",
      };
    case "spin":
      return {
        icon: "sparkles" as const,
        color: C.purple,
        bg: C.purpleSoft,
        label: "Spin",
      };
    case "subscription":
      return {
        icon: "ribbon" as const,
        color: C.purple,
        bg: C.purpleSoft,
        label: "Plan",
      };
    case "security":
      return {
        icon: "shield-checkmark" as const,
        color: "#EA4335",
        bg: "#FDECEA",
        label: "Security",
      };
    case "promo":
      return {
        icon: "pricetag" as const,
        color: "#F59E0B",
        bg: "#FFF8E6",
        label: "Offer",
      };
    case "suggestion":
      return {
        icon: "compass" as const,
        color: C.purple,
        bg: C.purpleSoft,
        label: "For you",
      };
    default:
      return {
        icon: "notifications" as const,
        color: C.purple,
        bg: C.purpleSoft,
        label: "Update",
      };
  }
}

const PERSON_TYPES = new Set([
  "chat",
  "call",
  "friend_request",
  "friends",
  "like",
  "match",
  "profile_view",
]);

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function sectionTitle(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const diff = today - day;
  if (diff === 0) return "Today";
  if (diff === 86400000) return "Yesterday";
  return "Earlier";
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 7 * 86400_000) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function displayTitle(
  n: AppNotification,
  profileViewsUnlocked = true,
) {
  if (n.type === "profile_view") {
    if (n.locked || !profileViewsUnlocked) {
      return "Someone";
    }
    if (n.actorName) {
      return getDisplayName(n.actorName);
    }
    return "Someone";
  }
  if (PERSON_TYPES.has(n.type) && n.actorName) {
    return getDisplayName(n.actorName);
  }
  return n.title;
}

function displayBody(
  n: AppNotification,
  profileViewsUnlocked = true,
) {
  if (n.type === "friend_request") return n.body || "Liked you";
  if (n.type === "friends") return n.body || "You're now friends";
  if (n.type === "chat") return n.body || "New message";
  if (n.type === "match") return n.body || "It's a match!";
  if (n.type === "call") return n.body || "Incoming call";
  if (n.type === "profile_view") {
    return n.locked || !profileViewsUnlocked
      ? "Viewed your profile · Subscribe to unlock"
      : "Viewed your profile";
  }
  return n.body || n.title;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { notifTick, refreshNotifUnread, notifUnreadCount } = useSocket();
  const { showAlert } = useAppAlert();

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("All");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 56, right: 12 });
  const [selected, setSelected] = useState<AppNotification | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [likedActors, setLikedActors] = useState<Record<string, boolean>>({});
  const [profileViewsUnlocked, setProfileViewsUnlocked] = useState(false);
  const [viewerModalVisible, setViewerModalVisible] = useState(false);
  const [viewerProfile, setViewerProfile] = useState<{
    id: string;
    name: string;
    age: number;
    bio: string;
    photo: string;
    gender: string;
    interests: string[];
  } | null>(null);

  const cursor = useRef<string | null>(null);
  const hasMore = useRef(true);
  const loadingRef = useRef(false);
  const moreBtnRef = useRef<View>(null);

  /** Anchor the overflow menu under the ⋮ button on any screen size. */
  const openMenu = useCallback(() => {
    const node = moreBtnRef.current;
    if (!node || typeof (node as any).measureInWindow !== "function") {
      setMenuPos({ top: 56, right: 12 });
      setMenuOpen(true);
      return;
    }

    (node as any).measureInWindow(
      (x: number, y: number, width: number, height: number) => {
        const { width: winW, height: winH } = Dimensions.get("window");
        const menuWidth = 220;
        const gap = 4;
        const edge = 8;

        // Prefer right-aligned under the button (WhatsApp style)
        let right = Math.max(edge, winW - (x + width) - 2);
        // Keep the card fully on screen if the button is near the left edge
        if (winW - right - menuWidth < edge) {
          right = Math.max(edge, winW - menuWidth - edge);
        }

        let top = y + height + gap;
        // Flip upward if there isn't room below (short screens / landscape)
        const estimatedMenuH = 112;
        if (top + estimatedMenuH > winH - edge) {
          top = Math.max(edge, y - estimatedMenuH - gap);
        }

        setMenuPos({ top, right });
        setMenuOpen(true);
      },
    );
  }, []);

  /** Load the first page, replacing whatever is on screen. */
  const load = useCallback(
    async (soft = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        if (!soft) setLoading(true);
        const token = await getAuthToken();
        if (!token) return;

        const page = await fetchNotifications(token, {
          limit: PAGE_SIZE,
          filter: filter === "Unread" ? "unread" : "all",
          type: filter === "Profile View" ? "profile_view" : undefined,
        });

        const unlockedFlag = !!page.profileViewsUnlocked;
        setProfileViewsUnlocked(unlockedFlag);
        setItems(
          (page.notifications || []).map((n) =>
            n.type === "profile_view" && !unlockedFlag
              ? { ...n, locked: true }
              : n,
          ),
        );
        cursor.current = page.nextCursor;
        hasMore.current = page.hasMore;
        await refreshNotifUnread();

        // Double-check subscription in case list payload is stale
        try {
          const sub = await fetchSubscriptionStatus(token);
          const unlocked = !!(
            sub?.profileViews ||
            (sub?.isActive &&
              ["gold", "platinum", "black"].includes(String(sub?.plan || "")))
          );
          setProfileViewsUnlocked(unlocked);
          if (unlocked && !unlockedFlag) {
            // Just subscribed — reload to reveal viewer identities
            const fresh = await fetchNotifications(token, {
              limit: PAGE_SIZE,
              filter: filter === "Unread" ? "unread" : "all",
              type: filter === "Profile View" ? "profile_view" : undefined,
            });
            setItems(fresh.notifications || []);
            cursor.current = fresh.nextCursor;
            hasMore.current = fresh.hasMore;
          } else if (!unlocked) {
            setItems((prev) =>
              prev.map((n) =>
                n.type === "profile_view" ? { ...n, locked: true } : n,
              ),
            );
          }
        } catch {
          /* keep list flag */
        }
      } catch {
        /* keep whatever is already rendered */
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter, refreshNotifUnread],
  );

  /** Append the next page — drives infinite scrolling. */
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore.current || !cursor.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const token = await getAuthToken();
      if (!token) return;

      const page = await fetchNotifications(token, {
        limit: PAGE_SIZE,
        cursor: cursor.current,
        filter: filter === "Unread" ? "unread" : "all",
        type: filter === "Profile View" ? "profile_view" : undefined,
      });

      setItems((prev) => {
        const seen = new Set(prev.map((n) => n._id));
        const incoming = page.notifications
          .filter((n) => !seen.has(n._id))
          .map((n) =>
            n.type === "profile_view" && !profileViewsUnlocked
              ? { ...n, locked: true }
              : n,
          );
        return [...prev, ...incoming];
      });
      if (typeof page.profileViewsUnlocked === "boolean") {
        setProfileViewsUnlocked(page.profileViewsUnlocked);
      }
      cursor.current = page.nextCursor;
      hasMore.current = page.hasMore;
    } catch {
      /* stop silently; pull-to-refresh can recover */
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [filter, profileViewsUnlocked]);

  useFocusEffect(
    useCallback(() => {
      load(items.length > 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [notifTick, filter]),
  );

  // Filtering by read state happens server-side; hide personal chats + search
  const filtered = useMemo(() => {
    // Profile View is its own tab — never mix into All / Unread
    const scoped =
      filter === "Profile View"
        ? items.filter((n) => n.type === "profile_view")
        : items.filter((n) => n.type !== "chat" && n.type !== "profile_view");
    const q = searchQuery.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        (n.body || "").toLowerCase().includes(q) ||
        (n.actorName || "").toLowerCase().includes(q),
    );
  }, [items, searchQuery, filter]);

  const rows: ListRow[] = useMemo(() => {
    const out: ListRow[] = [];
    let lastSection = "";
    for (const item of filtered) {
      const section = sectionTitle(item.createdAt);
      if (section !== lastSection) {
        out.push({ kind: "section", id: `sec-${section}`, title: section });
        lastSection = section;
      }
      out.push({ kind: "item", id: item._id, item });
    }
    return out;
  }, [filtered]);

  const openNotification = async (n: AppNotification) => {
    // Locked profile views → subscription upsell
    if (n.type === "profile_view" && (n.locked || !profileViewsUnlocked)) {
      router.push("/subscription" as any);
      return;
    }

    try {
      const token = await getAuthToken();
      if (token && !n.read) {
        await markNotificationsRead(token, { ids: [n._id] });
        setItems((prev) =>
          prev.map((x) => (x._id === n._id ? { ...x, read: true } : x)),
        );
        refreshNotifUnread();
      }
    } catch {
      /* navigation should still happen */
    }

    // Same resolver the push handler uses, so taps land identically
    const route = routeForData({
      ...(n.data || {}),
      type: n.type,
      deepLink: n.deepLink,
      actorId: n.actorId,
    });

    if (route.startsWith("/messages/")) {
      router.push({
        pathname: "/messages/[id]",
        params: {
          id: route.split("/messages/")[1],
          name: n.actorName || "User",
          photo: resolvePhoto(n.actorPhoto) || "",
          gender: n.actorGender || "",
          isOnline: "false",
        },
      });
      return;
    }

    // Profile views → open viewer profile (not a message thread)
    if (n.type === "profile_view" && n.actorId) {
      setViewerProfile({
        id: String(n.actorId),
        name: n.actorName || "User",
        age: 0,
        bio: "",
        photo: resolvePhoto(n.actorPhoto) || "",
        gender: n.actorGender || "",
        interests: [],
      });
      setViewerModalVisible(true);
      return;
    }

    router.push(route as any);
  };

  const markProfileViewRead = async (n: AppNotification) => {
    if (n.read) return;
    try {
      const token = await getAuthToken();
      if (!token) return;
      await markNotificationsRead(token, { ids: [n._id] });
      setItems((prev) =>
        prev.map((x) => (x._id === n._id ? { ...x, read: true } : x)),
      );
      refreshNotifUnread();
    } catch {
      /* ignore */
    }
  };

  const onProfileViewLike = async (n: AppNotification) => {
    if (!n.actorId || actionBusyId) return;
    const actorKey = String(n.actorId);
    if (likedActors[actorKey]) return;

    setActionBusyId(n._id);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await sendLike(token, actorKey);
      setLikedActors((prev) => ({ ...prev, [actorKey]: true }));
      await markProfileViewRead(n);
      showAlert({
        title: "Liked",
        message: `You liked ${n.actorName || "them"}.`,
        icon: "heart",
      });
    } catch (e: any) {
      showAlert({
        title: "Couldn't like",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    } finally {
      setActionBusyId(null);
    }
  };

  const onProfileViewChat = async (n: AppNotification) => {
    if (!n.actorId) return;
    await markProfileViewRead(n);
    router.push({
      pathname: "/messages/[id]",
      params: {
        id: String(n.actorId),
        name: n.actorName || "User",
        photo: resolvePhoto(n.actorPhoto) || "",
        gender: n.actorGender || "",
        isOnline: "false",
      },
    });
  };

  const markAll = async () => {
    setMenuOpen(false);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await markNotificationsRead(token, { all: true });
      setItems((prev) => prev.map((x) => ({ ...x, read: true })));
      refreshNotifUnread();
      if (filter === "Unread") load(true);
    } catch {
      /* ignore */
    }
  };

  const clearAll = () => {
    setMenuOpen(false);
    if (!items.length) return;
    showAlert({
      title: "Clear all notifications?",
      message:
        "This removes your entire notification history. It cannot be undone.",
      buttons: [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear all",
          style: "destructive",
          onPress: async () => {
            try {
              const token = await getAuthToken();
              if (!token) return;
              await clearAllNotifications(token);
              setItems([]);
              cursor.current = null;
              hasMore.current = false;
              refreshNotifUnread();
            } catch {
              showAlert({
                title: "Could not clear",
                message: "Please try again.",
              });
            }
          },
        },
      ],
    });
  };

  const removeOne = async (n: AppNotification) => {
    setSelected(null);
    // Optimistic — the row disappears immediately
    setItems((prev) => prev.filter((x) => x._id !== n._id));
    try {
      const token = await getAuthToken();
      if (!token) return;
      await deleteNotification(token, n._id);
      refreshNotifUnread();
    } catch {
      load(true);
    }
  };

  const toggleRead = async (n: AppNotification) => {
    setSelected(null);
    const nextRead = !n.read;
    setItems((prev) =>
      prev.map((x) => (x._id === n._id ? { ...x, read: nextRead } : x)),
    );
    try {
      const token = await getAuthToken();
      if (!token) return;
      if (nextRead) {
        await markNotificationsRead(token, { ids: [n._id] });
      } else {
        await markNotificationsUnread(token, [n._id]);
      }
      refreshNotifUnread();
    } catch {
      load(true);
    }
  };

  const renderRow = ({ item: row }: { item: ListRow }) => {
    if (row.kind === "section") {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{row.title}</Text>
        </View>
      );
    }

    const item = row.item;
    const meta = typeMeta(item.type);
    const isLockedProfileView =
      item.type === "profile_view" &&
      (!!item.locked || !profileViewsUnlocked);
    const isPerson =
      PERSON_TYPES.has(item.type) &&
      (!!item.actorId || isLockedProfileView);
    const unread = !item.read;

    return (
      <TouchableOpacity
        style={styles.chatItem}
        activeOpacity={0.55}
        onPress={() => openNotification(item)}
        onLongPress={() => setSelected(item)}
        delayLongPress={280}
      >
        <View style={styles.avatarWrap}>
          <View style={styles.avatarClip}>
            {isLockedProfileView ? (
              <View style={styles.lockedAvatarWrap}>
                {resolvePhoto(item.actorPhoto || item.imageUrl) ? (
                  <Image
                    source={{
                      uri: resolvePhoto(item.actorPhoto || item.imageUrl),
                    }}
                    style={styles.lockedAvatarImage}
                    contentFit="cover"
                    blurRadius={32}
                    recyclingKey={`locked-pv-${item._id}`}
                  />
                ) : (
                  <View style={styles.lockedAvatarPlaceholder}>
                    <Ionicons name="person" size={28} color="#B0B8BE" />
                  </View>
                )}
                <View style={styles.lockedAvatarFrost} />
              </View>
            ) : isPerson ? (
              <WhatsAppAvatar
                photo={resolvePhoto(item.actorPhoto || item.imageUrl)}
                name={item.actorName || item.title || "User"}
                size={52}
              />
            ) : (
              <View style={[styles.iconCircle, { backgroundColor: meta.bg }]}>
                <Ionicons name={meta.icon} size={24} color={meta.color} />
              </View>
            )}
          </View>
          {isPerson && item.type !== "profile_view" && (
            <View style={[styles.typeBadge, { backgroundColor: meta.color }]}>
              <Ionicons name={meta.icon} size={11} color="#fff" />
            </View>
          )}
          {item.type === "profile_view" && (
            <View style={[styles.typeBadge, { backgroundColor: meta.color }]}>
              <Ionicons name="eye" size={11} color="#fff" />
            </View>
          )}
        </View>

        <View style={styles.chatInfo}>
          <View style={styles.chatRow}>
            <View style={styles.nameRow}>
              <Text
                style={[
                  styles.chatName,
                  unread && styles.chatNameUnread,
                  isLockedProfileView && styles.lockedText,
                ]}
                numberOfLines={1}
              >
                {displayTitle(item, profileViewsUnlocked)}
              </Text>
              {!isPerson && item.type !== "profile_view" && (
                <View style={styles.typeTag}>
                  <Text style={styles.typeTagText}>{meta.label}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.chatTime, unread && styles.chatTimeUnread]}>
              {formatWhen(item.createdAt)}
            </Text>
          </View>

          <View style={styles.messageRow}>
            <Text
              style={[
                styles.lastMessage,
                unread && styles.lastMessageUnread,
                isLockedProfileView && styles.lockedText,
              ]}
              numberOfLines={1}
            >
              {displayBody(item, profileViewsUnlocked)}
            </Text>
            {unread && item.type !== "profile_view" ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>1</Text>
              </View>
            ) : null}
          </View>

          {item.type === "profile_view" &&
          item.actorId &&
          !isLockedProfileView ? (
            <View style={styles.quickActions}>
              <TouchableOpacity
                style={[
                  styles.quickBtn,
                  styles.quickBtnLike,
                  (likedActors[String(item.actorId)] ||
                    actionBusyId === item._id) &&
                    styles.quickBtnDisabled,
                ]}
                activeOpacity={0.75}
                disabled={
                  !!likedActors[String(item.actorId)] ||
                  actionBusyId === item._id
                }
                onPress={(e) => {
                  e.stopPropagation?.();
                  void onProfileViewLike(item);
                }}
              >
                {actionBusyId === item._id ? (
                  <ActivityIndicator size="small" color="#FF4B6E" />
                ) : (
                  <>
                    <Ionicons
                      name={
                        likedActors[String(item.actorId)]
                          ? "heart"
                          : "heart-outline"
                      }
                      size={15}
                      color="#FF4B6E"
                    />
                    <Text style={styles.quickBtnLikeText}>
                      {likedActors[String(item.actorId)] ? "Liked" : "Like"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickBtn, styles.quickBtnChat]}
                activeOpacity={0.75}
                onPress={(e) => {
                  e.stopPropagation?.();
                  void onProfileViewChat(item);
                }}
              >
                <Ionicons
                  name="chatbubble-outline"
                  size={15}
                  color={C.purple}
                />
                <Text style={styles.quickBtnChatText}>Chat</Text>
              </TouchableOpacity>

              {unread ? <View style={styles.unreadDot} /> : null}
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const goSubscribe = useCallback(() => {
    router.push("/subscription" as any);
  }, [router]);

  const unlockBanner = (
    <TouchableOpacity
      style={styles.unlockBanner}
      activeOpacity={0.92}
      onPress={goSubscribe}
      accessibilityRole="button"
      accessibilityLabel="Subscribe to unlock profile views"
    >
      <View style={styles.unlockBannerTextWrap}>
        <Text style={styles.unlockBannerText} numberOfLines={2}>
          Unlock your profile views{"\n"}and Crush today!
        </Text>
      </View>
      <View style={styles.unlockSubscribePill}>
        <Text style={styles.unlockSubscribeText}>Subscribe</Text>
        <Ionicons name="chevron-forward" size={16} color={C.purple} />
      </View>
    </TouchableOpacity>
  );

  const unlockFooter =
    !profileViewsUnlocked && filter === "Profile View" ? (
      <View style={styles.unlockBannerWrap}>{unlockBanner}</View>
    ) : null;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* WhatsApp-style header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>

          <Text style={styles.headerTitle} numberOfLines={1}>
            Notifications
          </Text>

          {/* WhatsApp-style ⋮ — measured so the popup stays under it on every device */}
          <View ref={moreBtnRef} collapsable={false} style={styles.moreBtnWrap}>
            <TouchableOpacity
              onPress={openMenu}
              style={styles.moreBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.55}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <Ionicons name="ellipsis-vertical" size={22} color={C.text} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons
          name="search"
          size={18}
          color={C.muted}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor={C.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {!!searchQuery && (
          <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={C.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filters */}
      <View style={styles.filtersRow}>
        {(["All", "Unread", "Profile View"] as FilterKey[]).map((key) => {
          const active = filter === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.filterPill, active && styles.filterPillActive]}
              onPress={() => setFilter(key)}
              activeOpacity={1}
            >
              <Text
                style={[styles.filterText, active && styles.filterTextActive]}
                numberOfLines={1}
              >
                {key}
              </Text>
              {key === "Unread" && notifUnreadCount > 0 && (
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
                    {notifUnreadCount > 99 ? "99+" : notifUnreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ListRowSkeleton count={9} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          renderItem={renderRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            rows.length ? styles.listContent : styles.emptyWrap
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(true);
              }}
              tintColor={C.purple}
              colors={[C.purple]}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          ListFooterComponent={
            <>
              {loadingMore ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator size="small" color={C.purple} />
                </View>
              ) : null}
              {unlockFooter}
            </>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              {filter === "Profile View" && !profileViewsUnlocked ? (
                <>
                  <Ionicons name="eye-off-outline" size={56} color={C.muted} />
                  <Text style={styles.emptyTitle}>Profile views are locked</Text>
                  <Text style={styles.emptySub}>
                    See who checked you out with Gold, Platinum, or Black.
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons
                    name="notifications-outline"
                    size={56}
                    color={C.muted}
                  />
                  <Text style={styles.emptyTitle}>
                    {filter === "Unread"
                      ? "No unread notifications"
                      : filter === "Profile View"
                        ? "No profile views yet"
                        : "No notifications yet"}
                  </Text>
                </>
              )}
            </View>
          }
        />
      )}

      {/* Header overflow menu */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          style={styles.menuBackdrop}
          onPress={() => setMenuOpen(false)}
        >
          <View
            style={[
              styles.menuCard,
              { top: menuPos.top, right: menuPos.right },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <TouchableOpacity
              style={styles.menuItem}
              onPress={markAll}
              activeOpacity={0.65}
            >
              <Text style={styles.menuText}>Mark all as read</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={clearAll}
              activeOpacity={0.65}
            >
              <Text style={[styles.menuText, styles.menuTextDanger]}>
                Clear all
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Per-notification actions (long press) */}
      <Modal
        visible={!!selected}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setSelected(null)}
        >
          <View
            style={styles.sheetWrap}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.sheet}>
              <TouchableOpacity
                style={styles.sheetItem}
                onPress={() => selected && toggleRead(selected)}
                activeOpacity={0.65}
              >
                <Text style={styles.sheetText}>
                  {selected?.read ? "Mark as unread" : "Mark as read"}
                </Text>
              </TouchableOpacity>
              <View style={styles.sheetDivider} />
              <TouchableOpacity
                style={styles.sheetItem}
                onPress={() => selected && removeOne(selected)}
                activeOpacity={0.65}
              >
                <Text style={[styles.sheetText, styles.menuTextDanger]}>
                  Delete
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={() => setSelected(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <UserProfileModal
        visible={viewerModalVisible}
        user={viewerProfile}
        onClose={() => {
          setViewerModalVisible(false);
          setViewerProfile(null);
        }}
        onMessage={() => {
          if (!viewerProfile) return;
          setViewerModalVisible(false);
          router.push({
            pathname: "/messages/[id]",
            params: {
              id: viewerProfile.id,
              name: viewerProfile.name,
              photo: viewerProfile.photo || "",
              gender: viewerProfile.gender || "",
              isOnline: "false",
            },
          });
        }}
        onLike={() => {
          if (!viewerProfile || actionBusyId) return;
          void (async () => {
            try {
              const token = await getAuthToken();
              if (!token) return;
              await sendLike(token, viewerProfile.id);
              setLikedActors((prev) => ({
                ...prev,
                [viewerProfile.id]: true,
              }));
              setViewerProfile((prev) =>
                prev ? { ...prev, iLiked: true } as any : prev,
              );
            } catch (e: any) {
              showAlert({
                title: "Couldn't like",
                message: e?.message || "Please try again.",
                icon: "alert-circle",
              });
            }
          })();
        }}
        likingInProgress={!!actionBusyId}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 4,
    paddingTop: 2,
    paddingBottom: 4,
    backgroundColor: C.bg,
    zIndex: 20,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: "700",
    color: C.text,
    letterSpacing: -0.3,
    marginLeft: 2,
    marginRight: 8,
  },
  moreBtnWrap: {
    flexShrink: 0,
    marginRight: 2,
  },
  moreBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.searchBg,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 10,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 20,
  },
  searchIcon: { marginRight: 10 },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: C.text,
    paddingVertical: 0,
  },
  filtersRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    marginBottom: 4,
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
  },
  filterPillActive: {
    backgroundColor: C.pillActive,
  },
  filterText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.muted,
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
  },
  filterCountActive: {
    backgroundColor: "#FFFFFF",
  },
  filterCountText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
  },
  filterCountTextActive: {
    color: "#111111",
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    backgroundColor: C.bg,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: C.muted,
  },
  listContent: {
    paddingBottom: 28,
  },
  chatItem: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: C.bg,
    overflow: "hidden",
  },
  avatarWrap: {
    width: 52,
    height: 52,
    marginRight: 12,
    overflow: "visible",
  },
  avatarClip: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: "hidden",
  },
  lockedAvatarWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: "hidden",
    backgroundColor: "#DFE5E7",
  },
  lockedAvatarImage: {
    width: 52,
    height: 52,
  },
  lockedAvatarPlaceholder: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DFE5E7",
  },
  lockedAvatarFrost: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.32)",
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  typeBadge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.bg,
    zIndex: 3,
    elevation: 3,
  },
  chatInfo: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    paddingBottom: 12,
  },
  chatRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginTop: 2,
  },
  nameRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 8,
    minWidth: 0,
  },
  chatName: {
    fontSize: 16,
    fontWeight: "500",
    color: C.text,
    flexShrink: 1,
    lineHeight: 22,
  },
  chatNameUnread: {
    fontWeight: "700",
  },
  typeTag: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: C.purpleSoft,
  },
  typeTagText: {
    fontSize: 10,
    fontWeight: "700",
    color: C.purple,
  },
  chatTime: {
    fontSize: 12,
    color: C.muted,
    flexShrink: 0,
    marginLeft: 8,
    marginTop: 2,
  },
  chatTimeUnread: {
    color: C.purple,
    fontWeight: "600",
  },
  lastMessage: {
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    color: C.preview,
    marginRight: 8,
    lineHeight: 20,
  },
  lastMessageUnread: {
    color: "#3B4A54",
    fontWeight: "600",
  },
  quickActions: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 8,
  },
  quickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
  },
  quickBtnLike: {
    backgroundColor: "#FFE8EE",
  },
  quickBtnChat: {
    backgroundColor: C.purpleSoft,
  },
  quickBtnDisabled: {
    opacity: 0.65,
  },
  quickBtnLikeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FF4B6E",
  },
  quickBtnChatText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.purple,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.purple,
    marginLeft: 4,
  },
  lockedText: {
    color: "#9AA3A9",
  },
  unlockBannerWrap: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 28,
  },
  unlockBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.purple,
    borderRadius: 28,
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 10,
    minHeight: 72,
    gap: 10,
  },
  unlockBannerTextWrap: {
    flex: 1,
    paddingRight: 4,
  },
  unlockBannerText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  unlockSubscribePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 12,
    gap: 2,
  },
  unlockSubscribeText: {
    color: C.purple,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.1,
  },
  emptySub: {
    marginTop: 8,
    fontSize: 14,
    color: C.muted,
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 20,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: C.purple,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  unreadBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  footerLoader: {
    paddingVertical: 18,
    alignItems: "center",
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  menuCard: {
    position: "absolute",
    width: 210,
    maxWidth: "86%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 4,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: "center",
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#DBDBDB",
    marginHorizontal: 0,
  },
  menuText: {
    fontSize: 15,
    color: "#262626",
    fontWeight: "400",
    textAlign: "left",
  },
  menuTextDanger: {
    color: "#ED4956",
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  sheetWrap: {
    gap: 8,
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    overflow: "hidden",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#DBDBDB",
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#8E8E8E",
    textAlign: "center",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  sheetItem: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    minHeight: 52,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#DBDBDB",
  },
  sheetText: {
    fontSize: 16,
    color: "#262626",
    fontWeight: "500",
    textAlign: "center",
  },
  sheetCancel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    minHeight: 52,
  },
  sheetCancelText: {
    fontSize: 16,
    color: "#262626",
    fontWeight: "700",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyWrap: { flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingBottom: 80,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: C.muted,
    marginTop: 8,
  },
});
