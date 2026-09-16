import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import UserProfileModal from "../../components/UserProfileModal";
import { useAuth } from "../../contexts/AuthContext";
import { getAuthToken, isValidPublicId } from "../../utils/auth";
import {
  fetchUserProfile,
  NearbyUser,
  searchUserByPublicId,
} from "../../utils/nearby";
import { normalizePublicId } from "../../utils/profileLinks";
import {
  FriendshipStatus,
  getFriendshipStatus,
  sendLike,
  unlikeUser,
} from "../../utils/friends";

/**
 * Deep link entry: luvstor://u/ABCD1234 or https://…/u/ABCD1234
 * Loads the user and opens the profile viewer.
 */
export default function SharedProfileScreen() {
  const router = useRouter();
  const { user: authUser } = useAuth();
  const params = useLocalSearchParams<{ publicId?: string }>();
  const publicId = normalizePublicId(
    Array.isArray(params.publicId) ? params.publicId[0] : params.publicId,
  );

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [profileUser, setProfileUser] = React.useState<NearbyUser | null>(null);
  const [friendship, setFriendship] = React.useState<FriendshipStatus | null>(
    null,
  );
  const [liking, setLiking] = React.useState(false);
  const [modalVisible, setModalVisible] = React.useState(false);

  const goHome = React.useCallback(() => {
    setModalVisible(false);
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!publicId || !isValidPublicId(publicId)) {
        setError("Invalid profile link");
        setLoading(false);
        return;
      }

      // Must be signed in to view profiles
      if (!authUser) {
        const { setPendingProfileId } = await import("../../utils/pendingProfileLink");
        await setPendingProfileId(publicId);
        setError("Please sign in to view this profile");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const token = await getAuthToken();
        if (!token) {
          setError("Please sign in to view this profile");
          return;
        }

        const { user, error: searchErr } = await searchUserByPublicId(
          token,
          publicId,
        );
        if (cancelled) return;

        if (!user) {
          setError(searchErr || "Profile not found");
          return;
        }

        // Enrich with full gallery when possible
        let full = user;
        try {
          const { user: detailed } = await fetchUserProfile(token, user.id);
          if (detailed) full = { ...user, ...detailed };
        } catch {
          /* keep search result */
        }

        if (cancelled) return;
        setProfileUser(full);
        setModalVisible(true);

        try {
          const st = await getFriendshipStatus(token, full.id);
          if (!cancelled) setFriendship(st);
        } catch {
          /* ignore */
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not open profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicId, authUser?.id]);

  const onLike = async () => {
    if (!profileUser || liking) return;
    const token = await getAuthToken();
    if (!token) return;
    setLiking(true);
    try {
      await sendLike(token, profileUser.id);
      const st = await getFriendshipStatus(token, profileUser.id);
      setFriendship(st);
      setProfileUser((prev) =>
        prev
          ? {
              ...prev,
              iLiked: true,
              areFriends: !!st?.areFriends,
              friendshipStatus: st?.status || prev.friendshipStatus,
            }
          : prev,
      );
    } catch {
      /* ignore */
    } finally {
      setLiking(false);
    }
  };

  const onUnlike = async () => {
    if (!profileUser || liking) return;
    const token = await getAuthToken();
    if (!token) return;
    setLiking(true);
    try {
      await unlikeUser(token, profileUser.id);
      const st = await getFriendshipStatus(token, profileUser.id);
      setFriendship(st);
      setProfileUser((prev) =>
        prev
          ? {
              ...prev,
              iLiked: !!st?.iLiked,
              areFriends: !!st?.areFriends,
              friendshipStatus: st?.status || "stranger",
            }
          : prev,
      );
    } catch {
      /* ignore */
    } finally {
      setLiking(false);
    }
  };

  const onMessage = () => {
    if (!profileUser) return;
    setModalVisible(false);
    router.replace({
      pathname: "/messages/[id]",
      params: {
        id: profileUser.id,
        name: profileUser.name,
        photo: profileUser.photo || "",
        gender: profileUser.gender || "",
        isOnline: profileUser.isOnline ? "true" : "false",
      },
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6750A4" />
          <Text style={styles.hint}>Opening profile…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="person-outline" size={48} color="#CCC" />
          <Text style={styles.title}>Couldn’t open profile</Text>
          <Text style={styles.hint}>{error}</Text>
          {!authUser ? (
            <TouchableOpacity
              style={styles.btn}
              onPress={() => {
                router.replace({
                  pathname: "/login",
                  params: publicId ? { redirect: `u/${publicId}` } : {},
                });
              }}
            >
              <Text style={styles.btnText}>Sign in</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.linkBtn} onPress={goHome}>
            <Text style={styles.linkText}>Go to Discover</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <UserProfileModal
        visible={modalVisible && !!profileUser}
        user={
          profileUser
            ? {
                ...profileUser,
                iLiked: friendship?.iLiked ?? profileUser.iLiked,
                theyLiked: friendship?.theyLiked ?? profileUser.theyLiked,
                areFriends:
                  friendship?.areFriends ?? profileUser.areFriends,
                friendshipStatus:
                  friendship?.status ?? profileUser.friendshipStatus,
              }
            : null
        }
        onClose={goHome}
        onLike={onLike}
        onUnlike={onUnlike}
        onMessage={onMessage}
        likingInProgress={liking}
        onBlocked={goHome}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FDF8FF" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1C1B1F",
    marginTop: 8,
    textAlign: "center",
  },
  hint: {
    fontSize: 14,
    color: "#49454F",
    textAlign: "center",
    lineHeight: 20,
  },
  btn: {
    marginTop: 16,
    backgroundColor: "#6750A4",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  linkBtn: { marginTop: 12, padding: 8 },
  linkText: { color: "#6750A4", fontWeight: "600", fontSize: 14 },
});
