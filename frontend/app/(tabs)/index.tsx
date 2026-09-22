import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import {
    ActivityIndicator,
    Animated,
    FlatList,
    Keyboard,
    Modal,
    PanResponder,
    Platform,
    Pressable,
    RefreshControl,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
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
import { useStableBottomInset } from "../../hooks/useStableBottomInset";
import { mediaIdentity, resolveMediaUrl } from "../../utils/media";
import {
    getAuthToken,
    getCurrentAuthUser,
    getLocalProfile,
} from "../../utils/auth";
import { fetchForYouPage, loadForYouFeed } from "../../utils/forYou";
import {
    FriendshipStatus,
    getFriendshipStatus,
    sendLike,
    unlikeUser,
} from "../../utils/friends";
import {
    fetchNearbyUsersPage,
    fetchSavedDiscoveryPrefs,
    fetchUserProfile,
    loadNearbyFeed,
    NEARBY_PAGE_SIZE,
    NearbyUser,
    searchUserByPublicId,
    uploadMyLocation,
} from "../../utils/nearby";
import {
    addRecentSearch,
    clearRecentSearches,
    getRecentSearches,
    RECENT_SEARCH_HOME,
    type RecentSearchPerson,
} from "../../utils/recentSearches";
import { getCachedProfile, preloadProfile } from "../../utils/profileCache";
import { apiRequest } from "../../utils/api";

/** Discover theme — deep purple + black */
const D = {
  purple: "#370372",
  purpleSoft: "#EFE8F8",
  purpleTrack: "#E8E0F2",
  black: "#1C1B1F",
  bg: "#F5F5F7",
  surface: "#FFFFFF",
  muted: "#79747E",
  border: "#E7E0EC",
  danger: "#ED4956",
};

const GENDER_OPTIONS = ["All", "Man", "Woman", "Other"];
const DISTANCE_OPTIONS = [
  { label: "All", value: 500 },
  { label: "500m", value: 0.5 },
  { label: "1 km", value: 1 },
  { label: "5 km", value: 5 },
  { label: "50 km", value: 50 },
];
const LOGIN_WITHIN_OPTIONS = [
  { label: "All", minutes: 0 },
  { label: "15 min", minutes: 15 },
  { label: "1 hr", minutes: 60 },
  { label: "1 day", minutes: 1440 },
  { label: "3 days", minutes: 4320 },
];

type DiscoveryPrefs = {
  gender: string;
  radiusKm: number;
  activeWithinMinutes: number;
};

const DEFAULT_PREFS: DiscoveryPrefs = {
  gender: "All",
  radiusKm: 500, // Distance: All
  activeWithinMinutes: 0, // Login within: All
};

/** Build relationship map from nearby API data (no extra requests per user). */
function relationshipsFromUsers(users: NearbyUser[]) {
  return Object.fromEntries(
    users.map((user) => [
      user.id,
      {
        status:
          (user.friendshipStatus as FriendshipStatus["status"]) || "stranger",
        areFriends: !!user.areFriends,
        canSendMedia: false,
        canCall: false,
        iLiked: !!user.iLiked,
        theyLiked: !!user.theyLiked,
      },
    ]),
  ) as Record<string, FriendshipStatus>;
}

function applyRelationships(
  setRelationshipById: React.Dispatch<
    React.SetStateAction<Record<string, FriendshipStatus>>
  >,
  users: NearbyUser[],
) {
  const next = relationshipsFromUsers(users);
  setRelationshipById((prev) => ({ ...prev, ...next }));
}

/** Append only — never remove, refresh, or reorder existing rows. */
function appendNewUsers(
  prev: NearbyUser[],
  incoming: NearbyUser[],
): NearbyUser[] {
  if (!incoming.length) return prev;
  const seen = new Set(prev.map((u) => u.id));
  const newOnes = incoming.filter((u) => !seen.has(u.id));
  return newOnes.length ? [...prev, ...newOnes] : prev;
}

const STAGGER_SLOW_MS = 380;
const STAGGER_STEP_MS = 48;

/** Horizontal Nearby row — slides up from bottom when staggered. */
function NearbyListRowBase({
  item,
  index,
  stagger,
  liked,
  liking,
  feedTab,
  onOpenChat,
  onOpenProfile,
  onToggleLike,
}: {
  item: NearbyUser;
  index: number;
  stagger: boolean;
  liked: boolean;
  liking: boolean;
  feedTab: "nearby" | "for_you";
  onOpenChat: () => void;
  onOpenProfile: () => void;
  onToggleLike: () => void;
}) {
  const anim = React.useRef(new Animated.Value(stagger ? 0 : 1)).current;

  React.useEffect(() => {
    if (!stagger) {
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    const delay = Math.min(index, 18) * STAGGER_STEP_MS;
    const t = setTimeout(() => {
      Animated.timing(anim, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }).start();
    }, delay);
    return () => clearTimeout(t);
  }, [stagger, index, item.id, anim]);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [28, 0],
            }),
          },
        ],
      }}
    >
      <TouchableOpacity
        style={styles.listItem}
        activeOpacity={0.7}
        onPress={onOpenChat}
      >
        <TouchableOpacity
          style={styles.imageContainer}
          activeOpacity={0.8}
          onPress={onOpenProfile}
        >
          <WhatsAppAvatar
            photo={item.photo}
            name={item.name}
            publicId={item.publicId}
            gender={item.gender}
            size={56}
            online={!!item.isOnline}
            badge={item.subscriptionBadge}
            badgeExpiresAt={item.subscriptionExpiresAt}
            photoVerified={!!(item as any).photoVerified}
          />
        </TouchableOpacity>

        <View style={styles.textContainer}>
          <View style={styles.nameRow}>
            <Text style={styles.nameText} numberOfLines={1}>
              {getDisplayName(item.name, item.publicId)}
              {item.age ? `, ${item.age}` : ""}
            </Text>
            {(item as any).photoVerified ? (
              <Ionicons
                name="shield-checkmark"
                size={16}
                color="#22C55E"
                style={{ marginLeft: 4 }}
              />
            ) : null}
            <Text style={styles.metaText}>
              {item.distanceKm && item.distanceKm !== "?"
                ? `${item.distanceKm} km`
                : ""}
            </Text>
          </View>
          <Text style={styles.subtitleText} numberOfLines={1}>
            {item.isOnline
              ? "Active now"
              : feedTab === "for_you"
                ? "Suggested for you"
                : "Nearby"}
            {(item as any).photoVerified ? " · Photo verified" : ""}
            {item.relationshipGoal ? ` · ${item.relationshipGoal}` : ""}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.matchBtn, liked && styles.matchBtnLiked]}
          onPress={onToggleLike}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
          disabled={liking}
        >
          {liking ? (
            <ActivityIndicator size="small" color={liked ? D.black : "#fff"} />
          ) : (
            <Text
              style={[styles.matchBtnText, liked && styles.matchBtnTextLiked]}
            >
              {liked ? "Liked" : "Like"}
            </Text>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

/**
 * Memoized so presence/like ticks only repaint the row whose data changed
 * instead of every visible cell.
 */
const NearbyListRow = React.memo(NearbyListRowBase);

const ItemSeparator = () => <View style={styles.separator} />;

export default function DiscoverScreen() {
  const router = useRouter();
  const { showAlert } = useAppAlert();
  const { sessionVersion, user } = useAuth();
  const {
    profileTick,
    lastProfileUpdate,
    notifUnreadCount,
    presenceTick,
    lastPresence,
    friendTick,
    lastFriendUpdate,
  } = useSocket();

  const [profilePhoto, setProfilePhoto] = React.useState<string | null>(() => {
    const cached = getCachedProfile()?.profile?.photo;
    return resolveMediaUrl(cached) || cached || null;
  });
  const [nearbyUsers, setNearbyUsers] = React.useState<NearbyUser[]>([]);
  const [forYouUsers, setForYouUsers] = React.useState<NearbyUser[]>([]);
  const [feedTab, setFeedTab] = React.useState<"nearby" | "for_you">("nearby");
  const [forYouPage, setForYouPage] = React.useState(1);
  const [forYouHasMore, setForYouHasMore] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [staggerReveal, setStaggerReveal] = React.useState(false);
  const [locationError, setLocationError] = React.useState<string | null>(null);
  const [relationshipById, setRelationshipById] = React.useState<
    Record<string, FriendshipStatus>
  >({});
  const [likingId, setLikingId] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [searchMode, setSearchMode] = React.useState(false);
  const [searchBarY, setSearchBarY] = React.useState(0);
  const searchBarRef = React.useRef<View>(null);
  const [recentSearches, setRecentSearches] = React.useState<
    RecentSearchPerson[]
  >([]);
  const [prefs, setPrefs] = React.useState<DiscoveryPrefs>(DEFAULT_PREFS);
  const [prefsVisible, setPrefsVisible] = React.useState(false);
  // The first feed request waits for the saved filters so a restart doesn't
  // briefly show the unfiltered feed and then reload.
  const [prefsHydrated, setPrefsHydrated] = React.useState(false);
  const [searchedUser, setSearchedUser] = React.useState<NearbyUser | null>(
    null,
  );
  const [searchByIdLoading, setSearchByIdLoading] = React.useState(false);
  const [searchByIdError, setSearchByIdError] = React.useState<string | null>(
    null,
  );
  const [selectedUser, setSelectedUser] = React.useState<NearbyUser | null>(
    null,
  );
  const [profileModalVisible, setProfileModalVisible] = React.useState(false);
  const searchInputRef = React.useRef<TextInput>(null);

  /** Reliable on all Android OEMs — Keyboard.dismiss alone sometimes no-ops */
  const dismissSearchKeyboard = React.useCallback(() => {
    Keyboard.dismiss();
    searchInputRef.current?.blur();
  }, []);

  const closeSearchMode = React.useCallback(() => {
    setSearchMode(false);
    setSearchQuery("");
    setDebouncedSearch("");
    Keyboard.dismiss();
  }, []);

  const rememberPerson = React.useCallback(
    async (person: RecentSearchPerson) => {
      const next = await addRecentSearch(RECENT_SEARCH_HOME, person);
      setRecentSearches(next);
    },
    [],
  );

  React.useEffect(() => {
    void getRecentSearches(RECENT_SEARCH_HOME).then(setRecentSearches);
  }, []);

  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const fetchLockRef = React.useRef(false);
  const nearbyUsersRef = React.useRef<NearbyUser[]>([]);
  const forYouUsersRef = React.useRef<NearbyUser[]>([]);
  const prefsKeyRef = React.useRef("");
  const initialLoadedRef = React.useRef(false);

  React.useEffect(() => {
    nearbyUsersRef.current = nearbyUsers;
  }, [nearbyUsers]);

  React.useEffect(() => {
    forYouUsersRef.current = forYouUsers;
  }, [forYouUsers]);

  const prefsKey = `${prefs.gender}|${prefs.radiusKm}|${prefs.activeWithinMinutes}`;

  // Restore the filters this account last browsed with.
  React.useEffect(() => {
    let cancelled = false;
    // On an account switch, hold the feed until the new account's filters land.
    setPrefsHydrated(false);
    // Also drop the previous account's feed, otherwise the focus effect sees a
    // non-empty list and skips reloading for the new account.
    initialLoadedRef.current = false;
    nearbyUsersRef.current = [];
    forYouUsersRef.current = [];
    setNearbyUsers([]);
    setForYouUsers([]);
    (async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        const saved = await fetchSavedDiscoveryPrefs(token);
        if (cancelled || !saved) return;
        const gender =
          GENDER_OPTIONS.find(
            (g) => g.toLowerCase() === saved.gender.toLowerCase(),
          ) || DEFAULT_PREFS.gender;
        setPrefs({
          gender,
          radiusKm: saved.radiusKm ?? DEFAULT_PREFS.radiusKm,
          activeWithinMinutes: saved.activeWithinMinutes,
        });
      } catch {
        /* defaults are a fine fallback */
      } finally {
        if (!cancelled) setPrefsHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionVersion]);

  // Debounced search for better performance
  React.useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 150); // 150ms debounce for instant feel

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Search by public ID when format matches ABCD1234
  React.useEffect(() => {
    let cancelled = false;

    const searchById = async () => {
      const query = debouncedSearch.trim().toUpperCase();

      // Check if query matches public ID format (ABCD1234)
      if (!/^[A-Z]{4}[0-9]{4}$/.test(query)) {
        setSearchedUser(null);
        setSearchByIdError(null);
        return;
      }

      setSearchByIdLoading(true);
      setSearchByIdError(null);
      setSearchedUser(null);

      try {
        const token = await getAuthToken();
        if (!token) return;

        const { user, error } = await searchUserByPublicId(token, query);

        if (cancelled) return;

        if (error) {
          setSearchByIdError(error);
        } else if (user) {
          setSearchedUser(user);
          void rememberPerson({
            id: user.id,
            name:
              getDisplayName(user.name, user.publicId) || user.name || query,
            photo: user.photo || "",
            query,
          });
          // Also fetch relationship status for the searched user
          try {
            const status = await getFriendshipStatus(token, user.id);
            setRelationshipById((prev) => ({ ...prev, [user.id]: status }));
          } catch {
            /* best effort */
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setSearchByIdError(e?.message || "Search failed");
        }
      } finally {
        if (!cancelled) setSearchByIdLoading(false);
      }
    };

    searchById();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  // ── Load own profile photo for top-nav DP ───────────────────────
  const applyOwnPhoto = React.useCallback((raw?: string | null) => {
    const resolved = resolveMediaUrl(raw) || (raw ? String(raw).trim() : "");
    setProfilePhoto(resolved || null);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const load = async () => {
        try {
          // Instant: in-memory cache from Profile tab
          const cached = getCachedProfile();
          if (cached?.profile?.photo && !cancelled) {
            applyOwnPhoto(cached.profile.photo);
          }

          const authUser = await getCurrentAuthUser();
          if (!authUser?.email || cancelled) return;

          // Disk: local profile (may be relative /uploads/…)
          const local = await getLocalProfile(authUser.email);
          if (local?.photo && !cancelled) {
            applyOwnPhoto(local.photo);
          }

          // Soft network refresh so Discover stays in sync after DP upload
          const token = await getAuthToken();
          if (!token || cancelled) return;
          const snap = await preloadProfile({ force: !cached?.profile?.photo });
          if (cancelled) return;
          if (snap?.profile?.photo) {
            applyOwnPhoto(snap.profile.photo);
            return;
          }
          // Last resort: /me (handles cache miss / empty local)
          try {
            const me: any = await apiRequest("/api/users/me", token);
            if (!cancelled) applyOwnPhoto(me?.photo || null);
          } catch {
            if (!local?.photo && !cancelled) applyOwnPhoto(null);
          }
        } catch (e) {
          console.error("Failed to load profile photo", e);
        }
      };
      void load();
      return () => {
        cancelled = true;
      };
    }, [sessionVersion, applyOwnPhoto]),
  );

  // Live update when Profile tab changes the DP
  React.useEffect(() => {
    if (profileTick === 0 || !lastProfileUpdate) return;
    const myId = String(user?.id || getCachedProfile()?.profile?.userId || "");
    const updatedId = String(lastProfileUpdate.userId || "");
    if (myId && updatedId && myId !== updatedId) return;
    if (lastProfileUpdate.photo !== undefined) {
      applyOwnPhoto(lastProfileUpdate.photo || null);
    }
  }, [profileTick, lastProfileUpdate, applyOwnPhoto, user?.id]);

  // ── Force reload (Retry / pull-to-refresh) ──────────────────────
  const reloadForYou = React.useCallback(async (forceRefresh = false) => {
    const token = await getAuthToken();
    if (!token) return;
    const hadRows = forYouUsersRef.current.length > 0;
    // WhatsApp: keep list on screen — spinner only when empty
    if (!hadRows) setLoading(true);
    else if (forceRefresh) setRefreshing(true);
    setLocationError(null);
    try {
      // GPS in parallel; feed never waits on a Redis reconnect hang
      void uploadMyLocation(token, {
        preferCached: true,
        timeoutMs: 3500,
      });

      const { users, hasMore } = await loadForYouFeed(token, {
        page: 1,
        refreshFast: !!forceRefresh,
        forceRefresh: false,
      });
      // Instant in-place update (no blank / no stagger)
      setStaggerReveal(false);
      setForYouUsers(users);
      setForYouPage(1);
      setForYouHasMore(hasMore);
      applyRelationships(setRelationshipById, users);
    } catch (err: any) {
      if (
        err?.code === "LOCATION_REQUIRED" ||
        /location/i.test(err?.message || "")
      ) {
        // Retry once after a quick location push
        try {
          await uploadMyLocation(token, {
            preferCached: true,
            timeoutMs: 4500,
          });
          const { users, hasMore } = await loadForYouFeed(token, {
            page: 1,
            refreshFast: true,
          });
          setForYouUsers(users);
          setForYouPage(1);
          setForYouHasMore(hasMore);
          applyRelationships(setRelationshipById, users);
          setLocationError(null);
          return;
        } catch {
          setLocationError(err?.message || "Location needed for For You");
        }
      } else {
        setLocationError(err?.message || "Could not load For You suggestions.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMoreForYou = React.useCallback(async () => {
    if (!forYouHasMore || loadingMore || fetchLockRef.current) return;
    const token = await getAuthToken();
    if (!token) return;
    fetchLockRef.current = true;
    setLoadingMore(true);
    try {
      const next = forYouPage + 1;
      const { users, hasMore } = await fetchForYouPage(token, { page: next });
      setForYouUsers((prev) => appendNewUsers(prev, users));
      setForYouPage(next);
      setForYouHasMore(hasMore);
      applyRelationships(setRelationshipById, users);
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
      fetchLockRef.current = false;
    }
  }, [forYouHasMore, loadingMore, forYouPage]);

  const reloadNearby = React.useCallback(async (opts?: { pull?: boolean }) => {
    if (fetchLockRef.current) return;
    fetchLockRef.current = true;
    const hadRows = nearbyUsersRef.current.length > 0;
    // WhatsApp: keep list on screen — spinner only when empty or user pulled
    if (!hadRows) setLoading(true);
    else if (opts?.pull) setRefreshing(true);
    setLocationError(null);
    setHasMore(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        setLocationError("Please sign in to see nearby people.");
        return;
      }

      const {
        users,
        hasMore: more,
        error,
      } = await loadNearbyFeed(token, {
        radiusKm: prefs.radiusKm,
        gender: prefs.gender,
        activeWithinMinutes: prefs.activeWithinMinutes,
        mode: "initial",
        preferCachedLocation: true,
        refreshFast: true,
      });

      if (error) {
        setLocationError(error);
        if (!users.length && !hadRows) setNearbyUsers([]);
        return;
      }

      setLocationError(null);
      // Instant in-place update (no clear / no stagger on refresh)
      setStaggerReveal(false);
      setNearbyUsers(users);
      setHasMore(more && users.length > 0);
      initialLoadedRef.current = true;
      applyRelationships(setRelationshipById, users);
    } catch (e: any) {
      setLocationError(e?.message || "Could not load nearby people.");
    } finally {
      fetchLockRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [prefs]);

  // ── Initial load: 25 nearby. Never reload already-shown list. ──
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      if (!prefsHydrated) {
        return () => {
          cancelled = true;
        };
      }

      const prefsChanged = prefsKeyRef.current !== prefsKey;
      prefsKeyRef.current = prefsKey;

      if (
        initialLoadedRef.current &&
        !prefsChanged &&
        nearbyUsersRef.current.length > 0
      ) {
        return () => {
          cancelled = true;
        };
      }

      const load = async () => {
        if (fetchLockRef.current) return;
        fetchLockRef.current = true;
        const hadRows = nearbyUsersRef.current.length > 0;
        // Skeleton only when nothing to show — never flash over cached rows
        if (!hadRows) {
          setLoading(true);
        }
        setHasMore(true);
        setLocationError(null);
        try {
          const token = await getAuthToken();
          if (!token) {
            setLocationError("Please sign in to see nearby people.");
            return;
          }

          const {
            users,
            hasMore: more,
            error,
          } = await loadNearbyFeed(token, {
            radiusKm: prefs.radiusKm,
            gender: prefs.gender,
            activeWithinMinutes: prefs.activeWithinMinutes,
            mode: "initial",
            // Paint from the last saved location and refresh GPS in parallel
            // instead of blocking first render on a GPS fix.
            refreshFast: true,
          });

          if (cancelled) return;
          if (error) {
            setLocationError(error);
            return;
          }
          setNearbyUsers(users);
          setHasMore(more && users.length > 0);
          initialLoadedRef.current = true;
          applyRelationships(setRelationshipById, users);
        } catch (e: any) {
          if (!cancelled)
            setLocationError(e?.message || "Could not load nearby people.");
        } finally {
          fetchLockRef.current = false;
          if (!cancelled) setLoading(false);
        }
      };

      load();
      return () => {
        cancelled = true;
      };
    }, [sessionVersion, prefsKey, prefs, prefsHydrated]),
  );

  // Instantly apply name / bio / photo changes (in-place only — no reorder)
  React.useEffect(() => {
    if (profileTick === 0 || !lastProfileUpdate?.userId) return;
    const u = lastProfileUpdate;
    const resolve = (photo?: string) => {
      if (!photo) return "";
      return resolveMediaUrl(photo) || "";
    };
    const patch = (user: NearbyUser): NearbyUser => {
      if (user.id !== u.userId) return user;
      const nextPhoto = u.photo ? resolve(u.photo) : user.photo;
      const nextCover =
        u.coverPhoto !== undefined
          ? resolve(u.coverPhoto) || ""
          : user.coverPhoto;
      const nextPhotos = Array.isArray(u.photos)
        ? u.photos.map(resolve).filter(Boolean)
        : user.photos;
      const same = (a?: string | null, b?: string | null) => {
        const ia = mediaIdentity(a);
        const ib = mediaIdentity(b);
        if (ia && ib) return ia === ib;
        return String(a || "") === String(b || "");
      };
      return {
        ...user,
        name: u.name != null && u.name !== "" ? u.name : user.name,
        bio: u.bio != null ? u.bio : user.bio,
        photo: same(user.photo, nextPhoto) ? user.photo : nextPhoto,
        coverPhoto: same(user.coverPhoto, nextCover)
          ? user.coverPhoto
          : nextCover,
        photos: nextPhotos,
        age: u.age != null ? u.age : user.age,
        gender: u.gender || user.gender,
        height: u.height !== undefined ? u.height : user.height,
        interests: Array.isArray(u.interests) ? u.interests : user.interests,
        relationshipGoal:
          u.relationshipGoal !== undefined
            ? u.relationshipGoal
            : user.relationshipGoal,
        publicId: u.publicId || user.publicId,
      };
    };
    setNearbyUsers((prev) => prev.map(patch));
    setSearchedUser((prev) => (prev ? patch(prev) : prev));
    setSelectedUser((prev) => (prev ? patch(prev) : prev));
  }, [profileTick, lastProfileUpdate]);

  // Instant online / offline reflection (Discover list + open profile)
  React.useEffect(() => {
    if (presenceTick === 0 || !lastPresence?.userId) return;
    const uid = String(lastPresence.userId);
    const online = !!lastPresence.isOnline;
    const patch = (user: NearbyUser): NearbyUser =>
      user.id === uid ? { ...user, isOnline: online } : user;
    setNearbyUsers((prev) => {
      let changed = false;
      const next = prev.map((u) => {
        if (u.id !== uid || !!u.isOnline === online) return u;
        changed = true;
        return patch(u);
      });
      return changed ? next : prev;
    });
    setSearchedUser((prev) =>
      prev && prev.id === uid && !!prev.isOnline !== online ? patch(prev) : prev,
    );
    // Only touch the open profile when online status actually changes —
    // otherwise every presence tick rebuilds the modal and blinks Options.
    setSelectedUser((prev) => {
      if (!prev || prev.id !== uid || !!prev.isOnline === online) return prev;
      return { ...prev, isOnline: online };
    });
  }, [presenceTick, lastPresence]);

  // Realtime like / unlike / friends — update hearts without refresh
  React.useEffect(() => {
    if (friendTick === 0 || !lastFriendUpdate) return;

    const payload = lastFriendUpdate;
    const otherId = String(
      payload.silent || payload.action === "sync"
        ? payload.otherUserId || payload.fromUserId
        : payload.fromUserId,
    );
    if (!otherId) return;

    const patchRelationship = (
      prev: FriendshipStatus | undefined,
    ): FriendshipStatus => {
      const base: FriendshipStatus = prev || {
        status: "stranger",
        areFriends: false,
        canSendMedia: false,
        canCall: false,
        iLiked: false,
        theyLiked: false,
      };

      if (payload.action === "like") {
        return {
          ...base,
          status: "pending_like",
          theyLiked: true,
          iLiked: base.iLiked,
        };
      }
      if (payload.action === "friends" || payload.status === "friends") {
        return {
          ...base,
          status: "friends",
          areFriends: true,
          canSendMedia: true,
          canCall: true,
          iLiked: true,
          theyLiked: true,
        };
      }
      if (payload.action === "unlike" || payload.status === "stranger") {
        return {
          status: "stranger",
          areFriends: false,
          canSendMedia: false,
          canCall: false,
          iLiked: false,
          theyLiked: false,
        };
      }
      if (payload.action === "sync") {
        if (payload.status === "pending_like") {
          return { ...base, status: "pending_like", iLiked: true };
        }
        if (payload.status === "friends") {
          return {
            ...base,
            status: "friends",
            areFriends: true,
            canSendMedia: true,
            canCall: true,
            iLiked: true,
            theyLiked: true,
          };
        }
      }
      return base;
    };

    setRelationshipById((prev) => ({
      ...prev,
      [otherId]: patchRelationship(prev[otherId]),
    }));

    const applyUser = (user: NearbyUser): NearbyUser => {
      if (user.id !== otherId) return user;
      const rel = patchRelationship({
        status: (user.friendshipStatus as FriendshipStatus["status"]) || "stranger",
        areFriends: !!user.areFriends,
        canSendMedia: false,
        canCall: false,
        iLiked: !!user.iLiked,
        theyLiked: !!user.theyLiked,
      });
      return {
        ...user,
        iLiked: !!rel.iLiked,
        theyLiked: !!rel.theyLiked,
        areFriends: !!rel.areFriends,
        friendshipStatus: rel.status,
      };
    };
    setNearbyUsers((users) => users.map(applyUser));
    setSearchedUser((u) => (u ? applyUser(u) : u));
    setSelectedUser((u) => (u ? applyUser(u) : u));
  }, [friendTick, lastFriendUpdate]);

  // ── Infinite scroll: append below existing list only ────────────
  const loadMoreNearby = React.useCallback(async () => {
    if (
      fetchLockRef.current ||
      loadingMore ||
      loading ||
      !hasMore ||
      nearbyUsersRef.current.length === 0
    ) {
      return;
    }
    fetchLockRef.current = true;
    setLoadingMore(true);
    try {
      const token = await getAuthToken();
      if (!token) return;

      const excludeIds = nearbyUsersRef.current.map((u) => u.id);
      const {
        users,
        hasMore: more,
        error,
      } = await fetchNearbyUsersPage(token, {
        radiusKm: prefs.radiusKm,
        gender: prefs.gender,
        activeWithinMinutes: prefs.activeWithinMinutes,
        mode: "more",
        limit: NEARBY_PAGE_SIZE,
        excludeIds,
      });

      if (error || !users.length) {
        setHasMore(false);
        return;
      }

      setNearbyUsers((prev) => appendNewUsers(prev, users));
      setHasMore(more);
      applyRelationships(setRelationshipById, users);
    } catch {
      /* ignore */
    } finally {
      fetchLockRef.current = false;
      setLoadingMore(false);
    }
  }, [loadingMore, loading, hasMore, prefs]);

  // ── Toggle like / unlike (server-backed) ───────────────────────
  const toggleLike = async (id: string) => {
    if (likingId) return;
    const fromSelected =
      selectedUser?.id === id
        ? {
            status:
              (selectedUser.friendshipStatus as FriendshipStatus["status"]) ||
              "stranger",
            areFriends: !!selectedUser.areFriends,
            canSendMedia: false,
            canCall: false,
            iLiked: !!selectedUser.iLiked,
            theyLiked: !!selectedUser.theyLiked,
          }
        : null;
    const current = relationshipById[id] || fromSelected || undefined;
    const alreadyLiked = !!(current?.iLiked || current?.areFriends);

    const applyLocal = (
      next: Partial<FriendshipStatus> & { iLiked: boolean },
    ) => {
      setRelationshipById((prev) => ({
        ...prev,
        [id]: {
          status: next.status || prev[id]?.status || "stranger",
          areFriends: !!next.areFriends,
          canSendMedia: !!next.canSendMedia,
          canCall: !!next.canCall,
          iLiked: !!next.iLiked,
          theyLiked: next.theyLiked ?? prev[id]?.theyLiked ?? false,
        },
      }));
      setSelectedUser((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              iLiked: !!next.iLiked,
              areFriends: !!next.areFriends,
              theyLiked: next.theyLiked ?? prev.theyLiked,
              friendshipStatus: next.status || prev.friendshipStatus,
            }
          : prev,
      );
    };

    const runUnlike = async () => {
      // Instant unlike UI
      applyLocal({
        status: "stranger",
        areFriends: false,
        canSendMedia: false,
        canCall: false,
        iLiked: false,
        theyLiked: false,
      });
      setLikingId(id);
      try {
        const token = await getAuthToken();
        if (!token) return;
        await unlikeUser(token, id);
      } catch (e: any) {
        // Revert on failure
        applyLocal({
          status: current?.status || "pending_like",
          areFriends: !!current?.areFriends,
          canSendMedia: !!current?.canSendMedia,
          canCall: !!current?.canCall,
          iLiked: true,
          theyLiked: !!current?.theyLiked,
        });
        showAlert({
          title: "Could not unlike",
          message: e?.message || "Please try again.",
          icon: "alert-circle",
        });
      } finally {
        setLikingId(null);
      }
    };

    if (alreadyLiked) {
      if (current?.areFriends) {
        showAlert({
          title: "Remove friend?",
          message: "This will unlike them and remove the friendship.",
          icon: "heart-dislike",
          buttons: [
            { text: "Cancel", style: "cancel" },
            { text: "Unlike", style: "destructive", onPress: runUnlike },
          ],
        });
        return;
      }
      await runUnlike();
      return;
    }

    // Instant like UI
    const theyLiked = !!current?.theyLiked;
    applyLocal({
      status: theyLiked ? "friends" : "pending_like",
      areFriends: theyLiked,
      canSendMedia: theyLiked,
      canCall: theyLiked,
      iLiked: true,
      theyLiked,
    });

    setLikingId(id);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const result = await sendLike(token, id);
      const status = await getFriendshipStatus(token, id);
      setRelationshipById((prev) => ({ ...prev, [id]: status }));
      setSelectedUser((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              iLiked: !!status.iLiked,
              areFriends: !!status.areFriends,
              theyLiked: !!status.theyLiked,
              friendshipStatus: status.status,
            }
          : prev,
      );
      if (result.status === "friends") {
        showAlert({
          title: "You're friends!",
          message: "This user is now in your Friend section.",
          icon: "heart",
        });
      }
    } catch (e: any) {
      // Revert on failure
      applyLocal({
        status: current?.status || "stranger",
        areFriends: !!current?.areFriends,
        canSendMedia: !!current?.canSendMedia,
        canCall: !!current?.canCall,
        iLiked: false,
        theyLiked: !!current?.theyLiked,
      });
      showAlert({
        title: "Could not send like",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    } finally {
      setLikingId(null);
    }
  };

  // ── Pull to refresh — WhatsApp same technique ───────────────────
  const onRefresh = React.useCallback(async () => {
    // Spinner only; list stays mounted with previous data
    setRefreshing(true);
    try {
      if (feedTab === "for_you") {
        await reloadForYou(true);
      } else {
        await reloadNearby({ pull: true });
      }
    } finally {
      setRefreshing(false);
    }
  }, [feedTab, reloadNearby, reloadForYou]);

  // ── Open profile modal ─────────────────────────────────────────
  const openProfile = async (user: NearbyUser) => {
    dismissSearchKeyboard();
    if (searchMode) closeSearchMode();
    void rememberPerson({
      id: user.id,
      name: getDisplayName(user.name, user.publicId) || user.name || "User",
      photo: user.photo || "",
    });
    const rel = relationshipById[user.id];
    setSelectedUser({
      ...user,
      iLiked: rel?.iLiked ?? user.iLiked,
      areFriends: rel?.areFriends ?? user.areFriends,
      theyLiked: rel?.theyLiked ?? user.theyLiked,
      friendshipStatus: rel?.status ?? user.friendshipStatus,
    });
    setProfileModalVisible(true);
    // Refresh full profile so background photos are up to date
    try {
      const token = await getAuthToken();
      if (!token) return;
      const { user: full } = await fetchUserProfile(token, user.id);
      if (full) {
        const latestRel = relationshipById[user.id] || rel;
        setSelectedUser((prev) => {
          const base = prev?.id === full.id ? prev : user;
          const same = (a?: string | null, b?: string | null) => {
            const ia = mediaIdentity(a);
            const ib = mediaIdentity(b);
            if (ia && ib) return ia === ib;
            return String(a || "") === String(b || "");
          };
          const nextPhotos = Array.isArray(full.photos) ? full.photos : null;
          const prevPhotos = Array.isArray(base.photos) ? base.photos : [];
          let photos = prevPhotos;
          if (nextPhotos) {
            if (
              nextPhotos.length === prevPhotos.length &&
              nextPhotos.every((p, i) => same(p, prevPhotos[i]))
            ) {
              photos = prevPhotos;
            } else {
              // Includes [] — deleted posts must clear for viewers
              photos = nextPhotos;
            }
          }
          return {
            ...base,
            ...full,
            photo: same(base.photo, full.photo) ? base.photo : full.photo,
            coverPhoto: same(base.coverPhoto, full.coverPhoto)
              ? base.coverPhoto
              : full.coverPhoto,
            photos,
            // Prefer list distance; never invent km for non-nearby (random) rows
            distanceKm:
              user.source === "random"
                ? undefined
                : (user.distanceKm && user.distanceKm !== "?"
                    ? user.distanceKm
                    : null) ||
                  (full.distanceKm && full.distanceKm !== "?"
                    ? full.distanceKm
                    : null) ||
                  undefined,
            distance:
              user.source === "random"
                ? undefined
                : (user.distance ?? full.distance),
            friendshipStatus: latestRel?.status || full.friendshipStatus,
            areFriends: latestRel?.areFriends ?? full.areFriends,
            iLiked: latestRel?.iLiked ?? full.iLiked,
            theyLiked: latestRel?.theyLiked ?? full.theyLiked,
          };
        });
      }
    } catch {
      /* keep list data */
    }
  };

  const handleProfileLike = async () => {
    if (!selectedUser) return;
    await toggleLike(selectedUser.id);
  };

  const handleProfileUnlike = async () => {
    if (!selectedUser) return;
    await toggleLike(selectedUser.id);
  };

  const handleProfileMessage = () => {
    if (!selectedUser) return;
    setProfileModalVisible(false);
    const rel = relationshipById[selectedUser.id];
    const matched =
      !!rel?.areFriends ||
      !!selectedUser.areFriends ||
      rel?.status === "friends" ||
      rel?.status === "mutual_match" ||
      selectedUser.friendshipStatus === "friends" ||
      selectedUser.friendshipStatus === "mutual_match";
    router.push({
      pathname: "/messages/[id]",
      params: {
        id: selectedUser.id,
        name: selectedUser.name,
        photo: selectedUser.photo,
        gender: selectedUser.gender,
        isOnline: selectedUser.isOnline ? "true" : "false",
        areFriends: matched ? "true" : "false",
        iLiked: rel?.iLiked || selectedUser.iLiked || matched ? "true" : "false",
        theyLiked:
          rel?.theyLiked || selectedUser.theyLiked || matched ? "true" : "false",
        friendshipStatus:
          rel?.status ||
          selectedUser.friendshipStatus ||
          (matched ? "friends" : ""),
      },
    });
  };

  // ── Render horizontal WhatsApp-style row ───────────────────────
  const renderItem = React.useCallback(
    ({ item, index }: { item: NearbyUser; index: number }) => {
    const liked =
      relationshipById[item.id]?.iLiked ||
      relationshipById[item.id]?.areFriends;
    return (
      <NearbyListRow
        item={item}
        index={index}
        stagger={staggerReveal}
        liked={!!liked}
        liking={likingId === item.id}
        feedTab={feedTab}
        onOpenChat={() => {
          dismissSearchKeyboard();
          const rel = relationshipById[item.id];
          const matched =
            !!rel?.areFriends ||
            !!item.areFriends ||
            rel?.status === "friends" ||
            rel?.status === "mutual_match" ||
            item.friendshipStatus === "friends" ||
            item.friendshipStatus === "mutual_match";
          router.push({
            pathname: "/messages/[id]",
            params: {
              id: item.id,
              name: item.name,
              photo: item.photo,
              gender: item.gender,
              isOnline: item.isOnline ? "true" : "false",
              areFriends: matched ? "true" : "false",
              iLiked: rel?.iLiked || item.iLiked || matched ? "true" : "false",
              theyLiked:
                rel?.theyLiked || item.theyLiked || matched ? "true" : "false",
              friendshipStatus:
                rel?.status ||
                item.friendshipStatus ||
                (matched ? "friends" : ""),
            },
          });
        }}
        onOpenProfile={() => openProfile(item)}
        onToggleLike={() => {
          dismissSearchKeyboard();
          toggleLike(item.id);
        }}
      />
    );
    },
    [
      relationshipById,
      staggerReveal,
      likingId,
      feedTab,
      dismissSearchKeyboard,
      router,
      openProfile,
      toggleLike,
    ],
  );

  const keyExtractUser = React.useCallback((item: NearbyUser) => item.id, []);

  /** Stable identity so the list doesn't repaint on every parent render */
  const listExtraData = React.useMemo(
    () => `${feedTab}:${likingId ?? ""}:${staggerReveal}:${relationshipById}`,
    [feedTab, likingId, staggerReveal, relationshipById],
  );

  const activeUsers = feedTab === "for_you" ? forYouUsers : nearbyUsers;

  // ── Fast search with optimized filtering ──────────────────────
  const filteredUsers = React.useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return activeUsers;

    // If searching by ID format, don't filter nearby users
    if (/^[A-Z]{4}[0-9]{4}$/i.test(q)) {
      return [];
    }

    // Optimized search: early return for better performance
    return activeUsers.filter((u) => {
      // Quick checks with short-circuit evaluation
      const name = u.name?.toLowerCase() || "";
      if (name.includes(q)) return true;

      const bio = u.bio?.toLowerCase() || "";
      if (bio.includes(q)) return true;

      return false;
    });
  }, [activeUsers, debouncedSearch]);

  // Combine searched user with filtered users
  const displayUsers = React.useMemo(() => {
    if (searchedUser) {
      return [searchedUser, ...filteredUsers];
    }
    return filteredUsers;
  }, [searchedUser, filteredUsers]);

  const ListEmpty = () => {
    if (loading && activeUsers.length === 0) {
      return <ListRowSkeleton count={8} />;
    }
    if (searchByIdLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={D.purple} />
          <Text style={styles.emptyTitle}>Searching…</Text>
          <Text style={styles.emptyText}>
            Looking for user ID: {searchQuery.trim()}
          </Text>
        </View>
      );
    }
    if (searchByIdError) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#ED4956" />
          <Text style={styles.emptyTitle}>Search Failed</Text>
          <Text style={styles.emptyText}>{searchByIdError}</Text>
        </View>
      );
    }
    if (locationError) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="location-outline" size={48} color={D.muted} />
          <Text style={styles.emptyTitle}>Location Needed</Text>
          <Text style={styles.emptyText}>{locationError}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              initialLoadedRef.current = false;
              if (feedTab === "for_you") void reloadForYou(true);
              else void reloadNearby();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (searchQuery.trim()) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={48} color={D.muted} />
          <Text style={styles.emptyTitle}>No results</Text>
          <Text style={styles.emptyText}>
            No nearby people match “{searchQuery.trim()}”
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="people-outline" size={48} color={D.muted} />
        <Text style={styles.emptyTitle}>
          {feedTab === "for_you" ? "No suggestions yet" : "No One Nearby"}
        </Text>
        <Text style={styles.emptyText}>
          {feedTab === "for_you"
            ? "Add interests on your profile and pull to refresh for personalized matches."
            : prefs.gender !== "All"
              ? `No ${prefs.gender === "Man" ? "men" : prefs.gender === "Woman" ? "women" : prefs.gender.toLowerCase()} found with your current filters. Try Show me: Everyone or widen distance.`
              : prefs.activeWithinMinutes > 0
                ? "No one matches your activity filter. Try Last active: All in preferences."
                : `No verified users found within ${prefs.radiusKm < 1 ? `${prefs.radiusKm * 1000}m` : `${prefs.radiusKm} km`}. Pull down to refresh.`}
        </Text>
        {prefs.gender !== "All" ? (
          <TouchableOpacity
            style={styles.retryBtn}
            activeOpacity={0.85}
            onPress={() => {
              initialLoadedRef.current = false;
              setPrefs((p) => ({ ...p, gender: "All" }));
            }}
          >
            <Text style={styles.retryBtnText}>Show Everyone</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.retryBtn}
            activeOpacity={0.85}
            onPress={() => {
              initialLoadedRef.current = false;
              if (feedTab === "for_you") void reloadForYou(true);
              else void reloadNearby();
            }}
          >
            <Text style={styles.retryBtnText}>Refresh</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={{ flex: 1, backgroundColor: D.bg }}>
        <StatusBar barStyle="dark-content" backgroundColor={D.bg} />

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <Image
              source={require("../../assets/images/luvstoer logo.png")}
              style={[styles.headerLogo, { tintColor: D.purple }]}
              contentFit="contain"
            />
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.notifBtn}
              onPress={() => router.push("/notifications")}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={
                  notifUnreadCount > 0
                    ? "notifications"
                    : "notifications-outline"
                }
                size={22}
                color={D.black}
              />
              {notifUnreadCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>
                    {notifUnreadCount > 99 ? "99+" : notifUnreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/profile")}
              style={styles.profileBtn}
              activeOpacity={0.85}
              accessibilityLabel="Open profile"
            >
              <WhatsAppAvatar
                photo={profilePhoto || ""}
                name="Me"
                size={28}
                style={styles.headerAvatar}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Search (opens WhatsApp-style search page) ── */}
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
          backgroundColor={D.bg}
          fromY={searchBarY}
          onClearAll={() => {
            void clearRecentSearches(RECENT_SEARCH_HOME).then(
              setRecentSearches,
            );
          }}
          onSelectRecent={(person) => {
            void rememberPerson(person);
            const match =
              activeUsers.find((u) => u.id === person.id) ||
              (searchedUser?.id === person.id ? searchedUser : null);
            if (match) {
              closeSearchMode();
              void openProfile(match);
              return;
            }
            setSearchQuery(person.query || person.name);
          }}
        >
          <FlatList
            data={displayUsers}
            extraData={listExtraData}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.listContent,
              displayUsers.length === 0 ? { flexGrow: 1 } : null,
            ]}
            ListEmptyComponent={
              searchByIdLoading ? (
                <View style={styles.emptyContainer}>
                  <ActivityIndicator color={D.purple} />
                  <Text style={styles.emptyTitle}>Searching…</Text>
                </View>
              ) : searchByIdError ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyTitle}>Search Failed</Text>
                  <Text style={styles.emptyText}>{searchByIdError}</Text>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyTitle}>No results</Text>
                  <Text style={styles.emptyText}>
                    Try a name or public ID (ABCD1234)
                  </Text>
                </View>
              )
            }
          />
        </SearchModeOverlay>

        {/* Sticky section bar while list scrolls */}
        <View
          style={styles.stickySectionHeader}
          onTouchStart={dismissSearchKeyboard}
        >
          <View style={styles.feedTabs}>
            <TouchableOpacity
              style={[
                styles.feedTab,
                feedTab === "nearby" && styles.feedTabActive,
              ]}
              onPress={() => {
                dismissSearchKeyboard();
                setFeedTab("nearby");
              }}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.feedTabText,
                  feedTab === "nearby" && styles.feedTabTextActive,
                ]}
              >
                Nearby
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.feedTab,
                feedTab === "for_you" && styles.feedTabActive,
              ]}
              onPress={() => {
                dismissSearchKeyboard();
                setFeedTab("for_you");
                if (!forYouUsers.length) void reloadForYou();
              }}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.feedTabText,
                  feedTab === "for_you" && styles.feedTabTextActive,
                ]}
              >
                For you
              </Text>
            </TouchableOpacity>
          </View>
          {feedTab === "nearby" && !searchedUser && (
            <Pressable
              style={({ pressed }) => [
                styles.filterBtn,
                pressed && Platform.OS === "ios" && styles.filterBtnPressed,
              ]}
              hitSlop={8}
              android_ripple={{ color: "rgba(0,0,0,0.08)", radius: 14 }}
              onPress={() => {
                dismissSearchKeyboard();
                setPrefsVisible(true);
              }}
            >
              <Ionicons name="options-outline" size={22} color={D.black} />
            </Pressable>
          )}
        </View>

        {/* ── List / horizontal loading rows ── */}
        {loading && displayUsers.length === 0 ? (
          <TouchableWithoutFeedback onPress={dismissSearchKeyboard}>
            <View style={{ flex: 1 }}>
              <ListRowSkeleton count={8} />
            </View>
          </TouchableWithoutFeedback>
        ) : (
          <FlatList
            data={displayUsers}
            extraData={listExtraData}
            renderItem={renderItem}
            keyExtractor={keyExtractUser}
            contentContainerStyle={[
              styles.listContent,
              displayUsers.length === 0 ? { flexGrow: 1 } : null,
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollBeginDrag={dismissSearchKeyboard}
            onTouchStart={dismissSearchKeyboard}
            removeClippedSubviews={true}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
            windowSize={10}
            initialNumToRender={8}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[D.purple]}
                tintColor={D.purple}
              />
            }
            ItemSeparatorComponent={ItemSeparator}
            ListEmptyComponent={ListEmpty}
            ListFooterComponent={
              displayUsers.length ? (
                <>
                  {loadingMore ? (
                    <View style={styles.loadMoreFooter}>
                      <ActivityIndicator size="small" color={D.purple} />
                      <Text style={styles.loadMoreText}>Loading more…</Text>
                    </View>
                  ) : null}
                  <PremiumBanner router={router} />
                </>
              ) : null
            }
            onEndReached={() => {
              if (feedTab === "for_you") void loadMoreForYou();
              else void loadMoreNearby();
            }}
            onEndReachedThreshold={0.4}
          />
        )}
      </View>

      <PreferencesModal
        visible={prefsVisible}
        initial={prefs}
        onClose={() => setPrefsVisible(false)}
        onSearch={(next) => {
          initialLoadedRef.current = false;
          setPrefs(next);
          setPrefsVisible(false);
        }}
      />

      <UserProfileModal
        visible={profileModalVisible}
        user={selectedUser}
        onClose={() => setProfileModalVisible(false)}
        onLike={handleProfileLike}
        onUnlike={handleProfileUnlike}
        onMessage={handleProfileMessage}
        likingInProgress={likingId === selectedUser?.id}
        onBlocked={(userId) => {
          setNearbyUsers((prev) => prev.filter((u) => u.id !== userId));
          setForYouUsers((prev) => prev.filter((u) => u.id !== userId));
          setSearchedUser((prev) => (prev?.id === userId ? null : prev));
          setSelectedUser((prev) => (prev?.id === userId ? null : prev));
          setProfileModalVisible(false);
        }}
      />
    </SafeAreaView>
  );
}

function PremiumBanner({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <View style={styles.premiumWrap}>
      <LinearGradient
        colors={[D.purple, D.black]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.premiumCard}
      >
        <Ionicons name="diamond-outline" size={18} color="#FFD700" />
        <View style={styles.premiumTextWrap}>
          <Text style={styles.premiumTitle}>Unlock Premium Features</Text>
          <Text style={styles.premiumSubtitle}>
            Longer chats, bonus tokens, extra spins & Discover boost
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => router.push("/subscription" as any)}
        >
          <View style={styles.premiumBtn}>
            <Text style={styles.premiumBtnText}>Get Premium</Text>
          </View>
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
}

function PreferencesModal({
  visible,
  initial,
  onClose,
  onSearch,
}: {
  visible: boolean;
  initial: DiscoveryPrefs;
  onClose: () => void;
  onSearch: (next: DiscoveryPrefs) => void;
}) {
  const bottomInset = useStableBottomInset();
  const [gender, setGender] = React.useState(initial.gender);
  const [radiusKm, setRadiusKm] = React.useState(initial.radiusKm);
  const [activeWithinMinutes, setActiveWithinMinutes] = React.useState(
    initial.activeWithinMinutes,
  );

  React.useEffect(() => {
    if (!visible) return;
    setGender(initial.gender);
    setRadiusKm(initial.radiusKm);
    setActiveWithinMinutes(initial.activeWithinMinutes);
  }, [visible, initial]);

  const showMeChips = [
    { label: "All", value: "All" },
    { label: "Men", value: "Man" },
    { label: "Women", value: "Woman" },
    { label: "Other", value: "Other" },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.prefsOverlay}>
        <Pressable style={styles.prefsDismissArea} onPress={onClose} />
        <View
          style={[
            styles.prefsSheet,
            { paddingBottom: Math.max(24, bottomInset + 16) },
          ]}
        >
          <View style={styles.prefsHandle} />
          <Text style={styles.prefsTitle}>Preferences</Text>
          <Text style={styles.prefsSub}>Who you want to see nearby</Text>

          <Text style={styles.prefsSectionLabel}>Show me</Text>
          <View style={styles.prefsChipRow}>
            {showMeChips.map((opt) => {
              const on = gender === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  activeOpacity={0.8}
                  onPress={() => setGender(opt.value)}
                  style={[styles.prefsChip, on && styles.prefsChipOn]}
                >
                  <Text
                    style={[styles.prefsChipText, on && styles.prefsChipTextOn]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <PrefSliderRow
            title="Distance"
            valueLabel={
              DISTANCE_OPTIONS.find((o) => o.value === radiusKm)?.label ||
              `${radiusKm} km`
            }
            index={Math.max(
              0,
              DISTANCE_OPTIONS.findIndex((o) => o.value === radiusKm),
            )}
            steps={DISTANCE_OPTIONS.length}
            onIndexChange={(i) =>
              setRadiusKm(DISTANCE_OPTIONS[i]?.value ?? 500)
            }
          />

          <PrefSliderRow
            title="Last active"
            valueLabel={
              LOGIN_WITHIN_OPTIONS.find(
                (o) => o.minutes === activeWithinMinutes,
              )?.label || "All"
            }
            index={Math.max(
              0,
              LOGIN_WITHIN_OPTIONS.findIndex(
                (o) => o.minutes === activeWithinMinutes,
              ),
            )}
            steps={LOGIN_WITHIN_OPTIONS.length}
            onIndexChange={(i) =>
              setActiveWithinMinutes(LOGIN_WITHIN_OPTIONS[i]?.minutes ?? 0)
            }
          />

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => onSearch({ gender, radiusKm, activeWithinMinutes })}
          >
            <LinearGradient
              colors={[D.purple, D.black]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.prefsSaveBtn}
            >
              <Text style={styles.prefsSaveBtnText}>Save</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/** Smooth slider: continuous drag + snap to nearest step on release. */
function PrefSliderRow({
  title,
  valueLabel,
  index,
  steps,
  onIndexChange,
}: {
  title: string;
  valueLabel: string;
  index: number;
  steps: number;
  onIndexChange: (index: number) => void;
}) {
  const trackRef = React.useRef<View>(null);
  const trackWidth = React.useRef(1);
  const trackPageX = React.useRef(0);
  const safeSteps = Math.max(2, steps);
  const maxIndex = safeSteps - 1;

  const anim = React.useRef(
    new Animated.Value(clampedRatio(index, maxIndex)),
  ).current;
  const dragRatio = React.useRef(clampedRatio(index, maxIndex));
  const lastEmitted = React.useRef(Math.min(Math.max(index, 0), maxIndex));

  const measureTrack = React.useCallback(() => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      trackPageX.current = x;
      trackWidth.current = Math.max(1, width);
    });
  }, []);

  React.useEffect(() => {
    const next = clampedRatio(index, maxIndex);
    dragRatio.current = next;
    lastEmitted.current = Math.min(Math.max(index, 0), maxIndex);
    Animated.spring(anim, {
      toValue: next,
      useNativeDriver: false,
      friction: 8,
      tension: 80,
    }).start();
  }, [index, maxIndex, anim]);

  const emitNearest = React.useCallback(
    (ratio: number, force = false) => {
      const next = Math.round(Math.min(1, Math.max(0, ratio)) * maxIndex);
      if (force || next !== lastEmitted.current) {
        lastEmitted.current = next;
        onIndexChange(next);
      }
    },
    [maxIndex, onIndexChange],
  );

  const setFromPageX = React.useCallback(
    (pageX: number) => {
      const ratio = Math.min(
        1,
        Math.max(0, (pageX - trackPageX.current) / (trackWidth.current || 1)),
      );
      dragRatio.current = ratio;
      anim.setValue(ratio);
      emitNearest(ratio, false);
    },
    [anim, emitNearest],
  );

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          measureTrack();
          setFromPageX(e.nativeEvent.pageX);
        },
        onPanResponderMove: (e) => {
          setFromPageX(e.nativeEvent.pageX);
        },
        onPanResponderRelease: () => {
          const snapped = Math.round(dragRatio.current * maxIndex) / maxIndex;
          Animated.spring(anim, {
            toValue: snapped,
            useNativeDriver: false,
            friction: 7,
            tension: 90,
          }).start();
          emitNearest(dragRatio.current, true);
        },
        onPanResponderTerminate: () => {
          const snapped = Math.round(dragRatio.current * maxIndex) / maxIndex;
          Animated.spring(anim, {
            toValue: snapped,
            useNativeDriver: false,
            friction: 7,
            tension: 90,
          }).start();
          emitNearest(dragRatio.current, true);
        },
      }),
    [anim, emitNearest, maxIndex, measureTrack, setFromPageX],
  );

  const fillWidth = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });
  const thumbLeft = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={styles.prefsSliderSection}>
      <View style={styles.prefsSliderHeader}>
        <Text style={styles.prefsSliderTitle}>{title}</Text>
        <Text style={styles.prefsSliderValue}>{valueLabel}</Text>
      </View>
      <View
        ref={trackRef}
        style={styles.prefsSliderTrackHit}
        onLayout={measureTrack}
        {...pan.panHandlers}
      >
        <View style={styles.prefsSliderTrack}>
          <Animated.View
            style={[styles.prefsSliderFill, { width: fillWidth }]}
          />
        </View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.prefsSliderThumb,
            {
              left: thumbLeft,
              transform: [{ translateX: -11 }],
            },
          ]}
        />
      </View>
    </View>
  );
}

function clampedRatio(index: number, maxIndex: number) {
  return Math.min(Math.max(index, 0), maxIndex) / maxIndex;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: D.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 8,
    backgroundColor: D.bg,
  },
  headerTitleContainer: { flex: 1 },
  headerLogo: { width: 100, height: 34, marginLeft: -2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  notifBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  notifBadge: {
    position: "absolute",
    top: 0,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: D.purple,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  notifBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },
  profileBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#DFE5E7",
  },
  headerAvatar: { width: 28, height: 28, borderRadius: 14 },
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
  listContent: { paddingBottom: 100 },
  loadMoreFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  loadMoreText: {
    fontSize: 13,
    color: D.muted,
  },
  premiumWrap: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  premiumCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: "hidden",
  },
  premiumIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DBDBDB",
    alignItems: "center",
    justifyContent: "center",
  },
  premiumTextWrap: { flex: 1, minWidth: 0 },
  premiumTitle: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 1,
  },
  premiumSubtitle: {
    fontSize: 10,
    color: "rgba(255,255,255,0.7)",
    fontWeight: "400",
    lineHeight: 14,
  },
  premiumBtn: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  premiumBtnText: {
    color: D.purple,
    fontSize: 10.5,
    fontWeight: "700",
  },
  stickySectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingTop: 4,
    backgroundColor: D.bg,
    zIndex: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: D.border,
  },
  feedTabs: {
    flex: 1,
    flexDirection: "row",
  },
  feedTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
  },
  feedTabActive: {
    borderBottomColor: D.purple,
  },
  feedTabText: {
    fontSize: 14,
    fontWeight: "600",
    color: D.muted,
  },
  feedTabTextActive: {
    color: D.purple,
  },
  sectionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: D.black,
  },
  filterBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBtnPressed: {
    opacity: 0.55,
  },
  listItem: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  imageContainer: { position: "relative" },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: D.purpleSoft,
  },
  onlineStatus: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#78DE45",
    borderWidth: 2,
    borderColor: "#fff",
  },
  textContainer: {
    flex: 1,
    marginLeft: 12,
    justifyContent: "center",
    minWidth: 0,
    marginRight: 10,
  },
  nameRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  nameText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: D.black,
  },
  metaText: {
    fontSize: 12,
    color: D.muted,
    fontWeight: "500",
  },
  subtitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
    gap: 8,
  },
  subtitleText: {
    fontSize: 13,
    color: D.muted,
    marginTop: 1,
  },
  onlineNowText: {
    color: D.black,
    fontWeight: "600",
  },
  matchBtn: {
    minWidth: 48,
    height: 28,
    paddingHorizontal: 7,
    borderRadius: 7,
    backgroundColor: D.purple,
    justifyContent: "center",
    alignItems: "center",
  },
  matchBtnLiked: {
    backgroundColor: D.purpleSoft,
  },
  matchBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  matchBtnTextLiked: {
    color: D.purple,
  },
  separator: {
    height: 0,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: D.black,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: D.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: D.purple,
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  prefsOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  prefsDismissArea: {
    flex: 1,
  },
  prefsSheet: {
    backgroundColor: "#E4E6EB",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    // paddingBottom set dynamically via useStableBottomInset (nav bar safe area)
  },
  prefsHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D0D0D0",
    marginBottom: 14,
  },
  prefsTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1C1B1F",
    letterSpacing: -0.3,
  },
  prefsSub: {
    marginTop: 4,
    marginBottom: 16,
    fontSize: 14,
    color: "#49454F",
  },
  prefsSectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#79747E",
    marginBottom: 10,
  },
  prefsChipRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    marginBottom: 22,
    width: "100%",
  },
  prefsChip: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 20,
    backgroundColor: "#EFE8F8",
    alignItems: "center",
    justifyContent: "center",
  },
  prefsChipOn: {
    backgroundColor: "#370372",
  },
  prefsChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1C1B1F",
    textAlign: "center",
  },
  prefsChipTextOn: {
    color: "#fff",
  },
  prefsSliderSection: {
    marginBottom: Platform.OS === "android" ? 10 : 16,
  },
  prefsSliderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Platform.OS === "android" ? 6 : 10,
  },
  prefsSliderTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#79747E",
  },
  prefsSliderValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1C1B1F",
  },
  prefsSliderTrackHit: {
    height: Platform.OS === "android" ? 28 : 36,
    justifyContent: "center",
    marginLeft: 10,
  },
  prefsSliderTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#D0D0D0",
    overflow: "hidden",
  },
  prefsSliderFill: {
    height: "100%",
    backgroundColor: "#1C1B1F",
    borderRadius: 4,
  },
  prefsSliderThumb: {
    position: "absolute",
    top: "50%",
    marginTop: -11,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#1C1B1F",
    ...Platform.select({
      ios: {
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.25,
        shadowRadius: 2.5,
      },
      android: { elevation: 3 },
    }),
  },
  prefsSaveBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 8,
  },
  prefsSaveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
