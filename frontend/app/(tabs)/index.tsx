import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppAlert } from "../../components/AppAlert";
import { CardGridSkeleton } from "../../components/ScreenSkeleton";
import UserProfileModal from "../../components/UserProfileModal";
import WhatsAppAvatar, {
    getDisplayName,
} from "../../components/WhatsAppAvatar";
import { useAuth } from "../../contexts/AuthContext";
import { useSocket } from "../../contexts/SocketContext";
import { API_BASE } from "../../utils/api";
import {
    getAuthToken,
    getCurrentAuthUser,
    getLocalProfile,
} from "../../utils/auth";
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
} from "../../utils/nearby";
import { isLiveSubscriptionBadge } from "../../utils/subscriptions";

const FALLBACK_AVATAR = require("../../assets/images/boy-image.png");

function WhatsAppFilterIcon({
  color = "#8696A0",
  size = 14,
}: {
  color?: string;
  size?: number;
}) {
  const lineHeight = 2;
  const dotSize = 3.5;
  const rowHeight = dotSize;
  const rowGap = 1.2;
  const rows = [
    { dotLeft: size * 0.66 },
    { dotLeft: size * 0.2 },
    { dotLeft: size * 0.5 },
  ];

  return (
    <View style={{ width: size, height: size, justifyContent: "center" }}>
      {rows.map((row, index) => (
        <View
          key={index}
          style={{
            height: rowHeight,
            justifyContent: "center",
            marginBottom: index < rows.length - 1 ? rowGap : 0,
          }}
        >
          <View
            style={{
              width: size,
              height: lineHeight,
              borderRadius: lineHeight / 2,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: row.dotLeft,
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: color,
            }}
          />
        </View>
      ))}
    </View>
  );
}

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

export default function DiscoverScreen() {
  const router = useRouter();
  const { showAlert } = useAppAlert();
  const { sessionVersion } = useAuth();
  const {
    profileTick,
    lastProfileUpdate,
    notifUnreadCount,
    presenceTick,
    lastPresence,
    friendTick,
    lastFriendUpdate,
  } = useSocket();

  const [profilePhoto, setProfilePhoto] = React.useState<string | null>(null);
  const [nearbyUsers, setNearbyUsers] = React.useState<NearbyUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [locationError, setLocationError] = React.useState<string | null>(null);
  const [relationshipById, setRelationshipById] = React.useState<
    Record<string, FriendshipStatus>
  >({});
  const [likingId, setLikingId] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
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

  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const fetchLockRef = React.useRef(false);
  const nearbyUsersRef = React.useRef<NearbyUser[]>([]);
  const prefsKeyRef = React.useRef("");
  const initialLoadedRef = React.useRef(false);

  React.useEffect(() => {
    nearbyUsersRef.current = nearbyUsers;
  }, [nearbyUsers]);

  const prefsKey = `${prefs.gender}|${prefs.radiusKm}|${prefs.activeWithinMinutes}`;

  // Restore the filters this account last browsed with.
  React.useEffect(() => {
    let cancelled = false;
    // On an account switch, hold the feed until the new account's filters land.
    setPrefsHydrated(false);
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

  // ── Load own profile photo ──────────────────────────────────────
  useFocusEffect(
    React.useCallback(() => {
      const load = async () => {
        try {
          const authUser = await getCurrentAuthUser();
          if (!authUser?.email) return;
          const parsed = await getLocalProfile(authUser.email);
          setProfilePhoto(parsed?.photo || null);
        } catch (e) {
          console.error("Failed to load profile", e);
        }
      };
      load();
    }, [sessionVersion]),
  );

  // ── Force reload (Retry / pull-to-refresh) ──────────────────────
  const reloadNearby = React.useCallback(async () => {
    fetchLockRef.current = true;
    setLoading(true);
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
      });

      if (error) {
        setLocationError(error);
        if (!users.length) setNearbyUsers([]);
        return;
      }

      setLocationError(null);
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

  // ── Initial load: 25 nearby + 25 random. Never reload already-shown list. ──
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
        setLoading(true);
        setHasMore(true);
        setLocationError(null);
        if (prefsChanged || nearbyUsersRef.current.length === 0) {
          setNearbyUsers([]);
        }
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
      if (photo.startsWith("http") || photo.startsWith("data:")) return photo;
      return `${API_BASE}${photo}`;
    };
    const patch = (user: NearbyUser): NearbyUser => {
      if (user.id !== u.userId) return user;
      return {
        ...user,
        name: u.name != null && u.name !== "" ? u.name : user.name,
        bio: u.bio != null ? u.bio : user.bio,
        photo: u.photo ? resolve(u.photo) : user.photo,
        photos: Array.isArray(u.photos)
          ? u.photos.map(resolve).filter(Boolean)
          : user.photos,
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
    setNearbyUsers((prev) => prev.map(patch));
    setSearchedUser((prev) => (prev ? patch(prev) : prev));
    setSelectedUser((prev) => (prev ? patch(prev) : prev));
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

    setRelationshipById((prev) => {
      const rel = patchRelationship(prev[otherId]);

      const patchUser = (user: NearbyUser): NearbyUser => {
        if (user.id !== otherId) return user;
        return {
          ...user,
          iLiked: !!rel.iLiked,
          theyLiked: !!rel.theyLiked,
          areFriends: !!rel.areFriends,
          friendshipStatus: rel.status,
        };
      };

      setNearbyUsers((users) => users.map(patchUser));
      setSearchedUser((u) => (u ? patchUser(u) : u));
      setSelectedUser((u) => (u ? patchUser(u) : u));

      return { ...prev, [otherId]: rel };
    });
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

  // ── Pull to refresh ─────────────────────────────────────────────
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    initialLoadedRef.current = false;
    await reloadNearby();
  }, [reloadNearby]);

  // ── Open profile modal ─────────────────────────────────────────
  const openProfile = async (user: NearbyUser) => {
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
        setSelectedUser({
          ...user,
          ...full,
          // Prefer real distance from list or refreshed profile — never keep "?"
          distanceKm:
            (user.distanceKm && user.distanceKm !== "?"
              ? user.distanceKm
              : null) ||
            (full.distanceKm && full.distanceKm !== "?"
              ? full.distanceKm
              : null) ||
            undefined,
          distance: user.distance ?? full.distance,
          friendshipStatus: latestRel?.status || full.friendshipStatus,
          areFriends: latestRel?.areFriends ?? full.areFriends,
          iLiked: latestRel?.iLiked ?? full.iLiked,
          theyLiked: latestRel?.theyLiked ?? full.theyLiked,
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
    router.push({
      pathname: "/messages/[id]",
      params: {
        id: selectedUser.id,
        name: selectedUser.name,
        photo: selectedUser.photo,
        gender: selectedUser.gender,
        isOnline: selectedUser.isOnline ? "true" : "false",
      },
    });
  };

  // ── Render a compact WhatsApp-style row ─────────────────────────
  const renderItem = ({ item }: { item: NearbyUser }) => (
    <TouchableOpacity
      style={styles.listItem}
      activeOpacity={0.65}
      onPress={() =>
        router.push({
          pathname: "/messages/[id]",
          params: {
            id: item.id,
            name: item.name,
            photo: item.photo,
            gender: item.gender,
            isOnline: item.isOnline ? "true" : "false",
          },
        })
      }
    >
      <TouchableOpacity
        style={styles.imageContainer}
        activeOpacity={0.8}
        onPress={() => openProfile(item)}
      >
        <WhatsAppAvatar
          photo={item.photo}
          name={item.name}
          publicId={item.publicId}
          size={52}
          online={!!item.isOnline}
          badge={item.subscriptionBadge}
          badgeExpiresAt={item.subscriptionExpiresAt}
        />
      </TouchableOpacity>

      <View style={styles.textContainer}>
        <View style={styles.nameRow}>
          <Text style={styles.nameText} numberOfLines={1}>
            {getDisplayName(item.name, item.publicId)}
            {item.age ? `, ${item.age}` : ""}
          </Text>
          <Text style={styles.metaText}>
            {item.distanceKm && item.distanceKm !== "?"
              ? `${item.distanceKm} km`
              : ""}
          </Text>
        </View>
        <View style={styles.subtitleRow}>
          <Text style={styles.subtitleText} numberOfLines={1}>
            <Text
              style={
                item.isOnline &&
                isLiveSubscriptionBadge(
                  item.subscriptionBadge,
                  item.subscriptionExpiresAt,
                )
                  ? styles.onlineNowText
                  : undefined
              }
            >
              {item.isOnline ? "Online now" : "Nearby"}
            </Text>
            {item.relationshipGoal ? ` · ${item.relationshipGoal}` : ""}
          </Text>
          <TouchableOpacity
            style={styles.matchBtn}
            onPress={() => toggleLike(item.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
            disabled={likingId === item.id}
          >
            {likingId === item.id ? (
              <ActivityIndicator size="small" color="#8E2DE2" />
            ) : (
              <Ionicons
                name={
                  relationshipById[item.id]?.iLiked ||
                  relationshipById[item.id]?.areFriends
                    ? "heart"
                    : "heart-outline"
                }
                size={20}
                color="#FF4B6E"
              />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  // ── Fast search with optimized filtering ──────────────────────
  const filteredUsers = React.useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return nearbyUsers;

    // If searching by ID format, don't filter nearby users
    if (/^[A-Z]{4}[0-9]{4}$/i.test(q)) {
      return [];
    }

    // Optimized search: early return for better performance
    return nearbyUsers.filter((u) => {
      // Quick checks with short-circuit evaluation
      const name = u.name?.toLowerCase() || "";
      if (name.includes(q)) return true;

      const bio = u.bio?.toLowerCase() || "";
      if (bio.includes(q)) return true;

      return false;
    });
  }, [nearbyUsers, debouncedSearch]);

  // Combine searched user with filtered users
  const displayUsers = React.useMemo(() => {
    if (searchedUser) {
      return [searchedUser, ...filteredUsers];
    }
    return filteredUsers;
  }, [searchedUser, filteredUsers]);

  const ListEmpty = () => {
    if (loading && nearbyUsers.length === 0) {
      return <CardGridSkeleton count={6} />;
    }
    if (searchByIdLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#8E2DE2" />
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
          <Ionicons name="alert-circle-outline" size={48} color="#FF4B6E" />
          <Text style={styles.emptyTitle}>Search Failed</Text>
          <Text style={styles.emptyText}>{searchByIdError}</Text>
        </View>
      );
    }
    if (locationError) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="location-outline" size={48} color="#CCC" />
          <Text style={styles.emptyTitle}>Location Needed</Text>
          <Text style={styles.emptyText}>{locationError}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              initialLoadedRef.current = false;
              void reloadNearby();
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
          <Ionicons name="search-outline" size={48} color="#CCC" />
          <Text style={styles.emptyTitle}>No results</Text>
          <Text style={styles.emptyText}>
            No nearby people match “{searchQuery.trim()}”
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="people-outline" size={48} color="#CCC" />
        <Text style={styles.emptyTitle}>No One Nearby</Text>
        <Text style={styles.emptyText}>
          {prefs.gender !== "All"
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
              void reloadNearby();
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
      <View style={{ flex: 1 }}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />

        <LinearGradient
          colors={["#FFFFFF", "#FDF8FF", "#F5E6FF"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <Image
              source={require("../../assets/images/luvstoer logo.png")}
              style={[styles.headerLogo, { tintColor: "#6750A4" }]}
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
                color="#333"
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
            >
              {profilePhoto ? (
                <Image
                  source={{ uri: profilePhoto }}
                  style={styles.headerAvatar}
                  contentFit="cover"
                />
              ) : (
                <Image
                  source={FALLBACK_AVATAR}
                  style={styles.headerAvatar}
                  contentFit="cover"
                />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Search (same style as Chat) ── */}
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={18}
            color="#888"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or ID"
            placeholderTextColor="#888"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCapitalize="characters"
          />
          {!!searchQuery && (
            <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#BBB" />
            </TouchableOpacity>
          )}
        </View>

        {/* Sticky section bar while list scrolls */}
        <View style={styles.stickySectionHeader}>
          <View style={styles.sectionLeft}>
            <Ionicons name="location" size={18} color="#E91E63" />
            <Text style={styles.sectionTitle}>
              {searchedUser ? "Search Result" : "Nearby People"}
            </Text>
          </View>
          {!searchedUser && (
            <Pressable
              style={({ pressed }) => [
                styles.filterBtn,
                pressed && Platform.OS === "ios" && styles.filterBtnPressed,
              ]}
              hitSlop={8}
              android_ripple={{ color: "rgba(0,0,0,0.08)", radius: 14 }}
              onPress={() => setPrefsVisible(true)}
            >
              <WhatsAppFilterIcon size={15} color="#8696A0" />
            </Pressable>
          )}
        </View>

        {/* ── List ── */}
        <FlatList
          data={displayUsers}
          extraData={{ relationshipById, likingId }}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          windowSize={10}
          initialNumToRender={8}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={["#8E2DE2"]}
              tintColor="#8E2DE2"
              title="Pull to refresh"
              titleColor="#8E2DE2"
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={
            displayUsers.length ? (
              <>
                {loadingMore ? (
                  <View style={styles.loadMoreFooter}>
                    <ActivityIndicator size="small" color="#8E2DE2" />
                    <Text style={styles.loadMoreText}>Loading more…</Text>
                  </View>
                ) : null}
                <PremiumBanner router={router} />
              </>
            ) : null
          }
          onEndReached={loadMoreNearby}
          onEndReachedThreshold={0.4}
        />
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
      />
    </SafeAreaView>
  );
}

function PremiumBanner({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <View style={styles.premiumWrap}>
      <LinearGradient
        colors={["#1a1a1a", "#333"]}
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.prefsOverlay}>
        <TouchableOpacity
          style={styles.prefsDismissArea}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.prefsSheet}>
          <Text style={styles.prefsTitle}>Preferences</Text>

          <PrefSection title="Show me">
            {GENDER_OPTIONS.map((option) => (
              <PrefOption
                key={option}
                label={option}
                selected={gender === option}
                onPress={() => setGender(option)}
              />
            ))}
          </PrefSection>

          <PrefSection title="Distance">
            {DISTANCE_OPTIONS.map((option) => (
              <PrefOption
                key={option.label}
                label={option.label}
                selected={radiusKm === option.value}
                onPress={() => setRadiusKm(option.value)}
              />
            ))}
          </PrefSection>

          <PrefSection title="Last active">
            {LOGIN_WITHIN_OPTIONS.map((option) => (
              <PrefOption
                key={option.label}
                label={option.label}
                selected={activeWithinMinutes === option.minutes}
                onPress={() => setActiveWithinMinutes(option.minutes)}
              />
            ))}
          </PrefSection>

          <View style={styles.prefsActions}>
            <TouchableOpacity
              style={styles.prefsCancelBtn}
              activeOpacity={0.7}
              onPress={onClose}
            >
              <Text style={styles.prefsCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.prefsSearchBtn}
              activeOpacity={0.85}
              onPress={() =>
                onSearch({ gender, radiusKm, activeWithinMinutes })
              }
            >
              <Text style={styles.prefsSearchBtnText}>Filter</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PrefSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.prefsSection}>
      <Text style={styles.prefsSectionTitle}>{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.prefsOptionsRow}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function PrefOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.prefsOption, selected && styles.prefsOptionSelected]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Text
        style={[
          styles.prefsOptionText,
          selected && styles.prefsOptionTextSelected,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 6,
    backgroundColor: "#fff",
  },
  headerTitleContainer: { flex: 1 },
  headerLogo: { width: 86, height: 30, marginLeft: -5 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  notifBtn: {
    width: 34,
    height: 34,
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
    backgroundColor: "#111",
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
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#FFF0F2",
    overflow: "hidden",
  },
  headerAvatar: { width: "100%", height: "100%" },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#333",
    paddingVertical: 0,
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
    color: "#888",
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
    backgroundColor: "#EC4899",
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  premiumBtnText: {
    color: "#fff",
    fontSize: 10.5,
    fontWeight: "700",
  },
  stickySectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    zIndex: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ECECEC",
  },
  sectionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1A1A2E",
  },
  filterBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F0F2F5",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  filterBtnPressed: {
    opacity: 0.65,
  },
  listItem: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  imageContainer: { position: "relative" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F5F5F5",
  },
  onlineStatus: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#25D366",
    borderWidth: 2,
    borderColor: "#fff",
  },
  textContainer: {
    flex: 1,
    marginLeft: 12,
    justifyContent: "center",
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  nameText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#111",
  },
  metaText: {
    fontSize: 12,
    color: "#6750A4",
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
    flex: 1,
    fontSize: 13,
    color: "#667781",
  },
  onlineNowText: {
    color: "#25D366",
    fontWeight: "600",
  },
  matchBtn: {
    padding: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E9EDEF",
    marginLeft: 76,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#555", marginTop: 8 },
  emptyText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: "#8E2DE2",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 100,
  },
  retryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  prefsOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  prefsDismissArea: {
    flex: 1,
  },
  prefsSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  prefsTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111",
    marginBottom: 18,
  },
  prefsSection: {
    marginBottom: 16,
  },
  prefsSectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#888",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  prefsOptionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 8,
  },
  prefsOption: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  prefsOptionSelected: {
    borderColor: "#111",
    backgroundColor: "#111",
  },
  prefsOptionText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#444",
  },
  prefsOptionTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  prefsActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#EAEAEA",
  },
  prefsCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: "#F4F4F4",
    alignItems: "center",
    justifyContent: "center",
  },
  prefsCancelBtnText: {
    color: "#333",
    fontSize: 15,
    fontWeight: "600",
  },
  prefsSearchBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: "#6750A4",
    alignItems: "center",
    justifyContent: "center",
  },
  prefsSearchBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
