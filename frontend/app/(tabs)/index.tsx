import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
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
import { fetchForYouPage } from "../../utils/forYou";
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

const FALLBACK_AVATAR = require("../../assets/images/boy-image.png");

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
  const [forYouUsers, setForYouUsers] = React.useState<NearbyUser[]>([]);
  const [feedTab, setFeedTab] = React.useState<"nearby" | "for_you">("nearby");
  const [forYouPage, setForYouPage] = React.useState(1);
  const [forYouHasMore, setForYouHasMore] = React.useState(true);
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
  const reloadForYou = React.useCallback(async (forceRefresh = false) => {
    const token = await getAuthToken();
    if (!token) return;
    setLoading(true);
    setLocationError(null);
    try {
      const { users, hasMore } = await fetchForYouPage(token, {
        page: 1,
        forceRefresh: !!forceRefresh,
      });
      setForYouUsers(users);
      setForYouPage(1);
      setForYouHasMore(hasMore);
      applyRelationships(setRelationshipById, users);
    } catch (err: any) {
      if (
        err?.code === "LOCATION_REQUIRED" ||
        /location/i.test(err?.message || "")
      ) {
        setLocationError(err?.message || "Location needed for For You");
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
    try {
      if (feedTab === "for_you") {
        await reloadForYou(true);
      } else {
        await reloadNearby();
      }
    } finally {
      setRefreshing(false);
    }
  }, [feedTab, reloadNearby, reloadForYou]);

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
  const renderItem = ({ item }: { item: NearbyUser }) => {
    const liked =
      relationshipById[item.id]?.iLiked ||
      relationshipById[item.id]?.areFriends;
    return (
      <TouchableOpacity
        style={styles.listItem}
        activeOpacity={0.7}
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
            size={56}
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
          <Text style={styles.subtitleText} numberOfLines={1}>
            {item.isOnline
              ? "Active now"
              : feedTab === "for_you"
                ? "Suggested for you"
                : "Nearby"}
            {(item as any).photoVerified ? " · Verified" : ""}
            {item.relationshipGoal ? ` · ${item.relationshipGoal}` : ""}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.matchBtn, liked && styles.matchBtnLiked]}
          onPress={() => toggleLike(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
          disabled={likingId === item.id}
        >
          {likingId === item.id ? (
            <ActivityIndicator
              size="small"
              color={liked ? "#262626" : "#fff"}
            />
          ) : (
            <Text
              style={[styles.matchBtnText, liked && styles.matchBtnTextLiked]}
            >
              {liked ? "Liked" : "Like"}
            </Text>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

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
      return <CardGridSkeleton count={6} />;
    }
    if (searchByIdLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#262626" />
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
      <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

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

        {/* ── Search ── */}
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={16}
            color="#8E8E8E"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search"
            placeholderTextColor="#8E8E8E"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCapitalize="characters"
          />
          {!!searchQuery && (
            <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color="#C7C7C7" />
            </TouchableOpacity>
          )}
        </View>

        {/* Sticky section bar while list scrolls */}
        <View style={styles.stickySectionHeader}>
          <View style={styles.feedTabs}>
            <TouchableOpacity
              style={[
                styles.feedTab,
                feedTab === "nearby" && styles.feedTabActive,
              ]}
              onPress={() => setFeedTab("nearby")}
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
              onPress={() => setPrefsVisible(true)}
            >
              <Ionicons name="options-outline" size={22} color="#262626" />
            </Pressable>
          )}
        </View>

        {/* ── List ── */}
        <FlatList
          data={displayUsers}
          extraData={{ relationshipById, likingId, feedTab }}
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
              colors={["#262626"]}
              tintColor="#262626"
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={
            displayUsers.length ? (
              <>
                {loadingMore ? (
                  <View style={styles.loadMoreFooter}>
                    <ActivityIndicator size="small" color="#262626" />
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
          <Text style={styles.prefsTitle}>Show me</Text>

          <View style={styles.prefsSection}>
            <View style={styles.prefsEqualRow}>
              {GENDER_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.prefsEqualCard,
                    gender === option && styles.prefsEqualCardSelected,
                  ]}
                  onPress={() => setGender(option)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.prefsEqualCardText,
                      gender === option && styles.prefsEqualCardTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
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
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 8,
    backgroundColor: "#FFFFFF",
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
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#EFEFEF",
  },
  headerAvatar: { width: "100%", height: "100%" },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EFEFEF",
    marginHorizontal: 16,
    marginTop: 2,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 10,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#262626",
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
    color: "#8E8E8E",
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
    paddingHorizontal: 8,
    paddingTop: 4,
    backgroundColor: "#FFFFFF",
    zIndex: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DBDBDB",
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
    borderBottomColor: "#262626",
  },
  feedTabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#8E8E8E",
  },
  feedTabTextActive: {
    color: "#262626",
  },
  sectionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#262626",
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
    backgroundColor: "#fff",
  },
  imageContainer: { position: "relative" },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#EFEFEF",
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
    color: "#262626",
  },
  metaText: {
    fontSize: 12,
    color: "#8E8E8E",
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
    color: "#8E8E8E",
    marginTop: 1,
  },
  onlineNowText: {
    color: "#262626",
    fontWeight: "600",
  },
  matchBtn: {
    minWidth: 48,
    height: 28,
    paddingHorizontal: 7,
    borderRadius: 7,
    backgroundColor: "#111",
    justifyContent: "center",
    alignItems: "center",
  },
  matchBtnLiked: {
    backgroundColor: "#EFEFEF",
  },
  matchBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  matchBtnTextLiked: {
    color: "#262626",
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
    color: "#262626",
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#8E8E8E",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: "#0095F6",
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
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  prefsDismissArea: {
    flex: 1,
  },
  prefsSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  prefsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#262626",
    textAlign: "center",
    marginBottom: 18,
  },
  prefsSection: {
    marginBottom: 16,
  },
  prefsSectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8E8E8E",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  prefsEqualRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    width: "100%",
  },
  prefsEqualCard: {
    flex: 1,
    minWidth: 0,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#DBDBDB",
    backgroundColor: "#FAFAFA",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  prefsEqualCardSelected: {
    borderColor: "#262626",
    backgroundColor: "#262626",
  },
  prefsEqualCardText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#262626",
    textAlign: "center",
  },
  prefsEqualCardTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  prefsSliderSection: {
    marginBottom: Platform.OS === "android" ? 2 : 10,
  },
  prefsSliderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Platform.OS === "android" ? 4 : 8,
  },
  prefsSliderTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: "#262626",
  },
  prefsSliderValue: {
    fontSize: 15,
    fontWeight: "500",
    color: "#262626",
  },
  prefsSliderTrackHit: {
    height: Platform.OS === "android" ? 28 : 36,
    justifyContent: "center",
    marginLeft: 10,
  },
  prefsSliderTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EFEFEF",
    overflow: "hidden",
  },
  prefsSliderFill: {
    height: "100%",
    backgroundColor: "#262626",
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.10)",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2.5,
      },
      android: { elevation: 3 },
    }),
  },
  prefsActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#DBDBDB",
  },
  prefsCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#EFEFEF",
    alignItems: "center",
    justifyContent: "center",
  },
  prefsCancelBtnText: {
    color: "#262626",
    fontSize: 14,
    fontWeight: "700",
  },
  prefsSearchBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#0095F6",
    alignItems: "center",
    justifyContent: "center",
  },
  prefsSearchBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
