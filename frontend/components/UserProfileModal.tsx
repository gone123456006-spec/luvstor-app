import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
    Dimensions,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";
import { MAX_PROFILE_GALLERY } from "../constants/profile";
import { isValidPublicId } from "../utils/auth";
import { resolveMediaUrl } from "../utils/media";
import ProfileInfoModal from "./ProfileInfoModal";
import ProfileInstagramSection from "./ProfileInstagramSection";
import ProfilePhotoViewer from "./ProfilePhotoViewer";
import WhatsAppAvatar, { getDisplayName } from "./WhatsAppAvatar";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/** Same theme as Profile tab */
const WA = {
  bg: "#FDF8FF",
  white: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#49454F",
  border: "#E7E0EC",
  teal: "#6750A4",
  primaryContainer: "#EADDFF",
};

interface UserProfile {
  id: string;
  publicId?: string;
  name: string;
  age: number;
  bio: string;
  photo: string;
  photos?: string[];
  gender: string;
  interests: string[];
  height?: number | null;
  relationshipGoal?: string;
  distance?: number;
  distanceKm?: string;
  isOnline?: boolean;
  friendshipStatus?: string;
  areFriends?: boolean;
  iLiked?: boolean;
  theyLiked?: boolean;
  subscriptionBadge?: string | null;
  subscriptionExpiresAt?: string | null;
}

interface Props {
  visible: boolean;
  user: UserProfile | null;
  onClose: () => void;
  onLike?: () => void;
  onUnlike?: () => void;
  onMessage?: () => void;
  likingInProgress?: boolean;
}

export default function UserProfileModal({
  visible,
  user,
  onClose,
  onLike,
  onUnlike,
  onMessage,
  likingInProgress = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const [photoViewerVisible, setPhotoViewerVisible] = React.useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = React.useState(0);
  const [likedLocal, setLikedLocal] = React.useState(false);
  const [infoVisible, setInfoVisible] = React.useState(false);

  React.useEffect(() => {
    if (visible && user) {
      setLikedLocal(!!(user.iLiked || user.areFriends));
    }
  }, [visible, user?.id, user?.iLiked, user?.areFriends]);

  const gallery = React.useMemo(() => {
    if (!user) return [] as string[];
    const seen = new Set<string>();
    const list: string[] = [];
    const toUrl = (url?: string) => resolveMediaUrl(url) || url || "";
    // Same order as own Profile: photos array first (cover = photos[0]), then photo
    for (const url of [...(user.photos || []), user.photo]) {
      const resolved = toUrl(url);
      if (!resolved) continue;
      const key = String(resolved).split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(resolved);
      if (list.length >= MAX_PROFILE_GALLERY) break;
    }
    return list;
  }, [user?.photo, user?.photos]);

  React.useEffect(() => {
    if (!visible) {
      setPhotoViewerVisible(false);
      setSelectedPhotoIndex(0);
      setInfoVisible(false);
    }
  }, [visible]);

  if (!user) return null;

  const displayName = getDisplayName(user.name, user.publicId);
  const alreadyLiked = likedLocal;
  const coverUri = gallery[0] || null;
  const avatarPhoto =
    resolveMediaUrl(user.photo) || user.photo || gallery[0] || "";

  const rawKm = user.distanceKm != null ? String(user.distanceKm).trim() : "";
  const kmFromField =
    rawKm && rawKm !== "?" ? rawKm.replace(/\s*km$/i, "").trim() : "";
  const kmFromMetres =
    user.distance != null && Number.isFinite(Number(user.distance))
      ? (Number(user.distance) / 1000).toFixed(1)
      : "";
  const kmValue = kmFromField || kmFromMetres;

  const openPhotoViewer = (index: number) => {
    if (!gallery[index]) return;
    const uris = gallery.filter(Boolean);
    const startIndex = uris.indexOf(gallery[index]);
    setSelectedPhotoIndex(startIndex >= 0 ? startIndex : 0);
    setPhotoViewerVisible(true);
  };

  const handleLikeToggle = () => {
    if (likingInProgress) return;
    if (user.areFriends) {
      onUnlike?.();
      return;
    }
    const next = !alreadyLiked;
    setLikedLocal(next);
    if (next) onLike?.();
    else onUnlike?.();
  };

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          if (photoViewerVisible) setPhotoViewerVisible(false);
          else onClose();
        }}
        statusBarTranslucent
      >
        <SafeAreaView style={styles.container} edges={["bottom"]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            style={styles.scrollView}
            bounces={false}
          >
            {/* ── Cover + Avatar (exact Profile tab layout) ── */}
            <View style={styles.coverBlock}>
              <TouchableOpacity
                style={[
                  styles.coverWrap,
                  { height: 148 + Math.max(insets.top, 0) },
                ]}
                activeOpacity={0.9}
                onPress={() => openPhotoViewer(0)}
                disabled={!coverUri}
              >
                {coverUri ? (
                  <Image
                    source={{ uri: coverUri }}
                    style={styles.coverImage}
                    contentFit="cover"
                  />
                ) : (
                  <LinearGradient
                    colors={["#6750A4", "#FF4B6E"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.coverImage}
                  />
                )}
              </TouchableOpacity>

              {/* Back arrow only — overlaid on cover */}
              <TouchableOpacity
                style={[
                  styles.coverBackBtn,
                  { top: Math.max(insets.top, 8) + 8 },
                ]}
                onPress={onClose}
                activeOpacity={0.8}
                hitSlop={8}
              >
                <Ionicons name="arrow-back" size={22} color="#fff" />
              </TouchableOpacity>

              <View style={styles.avatarBlock}>
                <TouchableOpacity
                  style={styles.avatarWrap}
                  onPress={() => {
                    const idx = gallery.findIndex(
                      (u) =>
                        u &&
                        avatarPhoto &&
                        String(u).split("?")[0] ===
                          String(avatarPhoto).split("?")[0],
                    );
                    openPhotoViewer(idx >= 0 ? idx : 0);
                  }}
                  activeOpacity={0.85}
                  disabled={!avatarPhoto && !gallery.length}
                >
                  <WhatsAppAvatar
                    photo={avatarPhoto || undefined}
                    name={user.name}
                    publicId={user.publicId}
                    size={78}
                    online={!!user.isOnline}
                    badge={user.subscriptionBadge}
                    badgeExpiresAt={user.subscriptionExpiresAt}
                  />
                </TouchableOpacity>
                <Text style={styles.userName}>
                  {displayName}
                  {user.age ? `, ${user.age}` : ""}
                </Text>
                <Text style={styles.userIdText}>
                  ID:{" "}
                  {isValidPublicId(user.publicId)
                    ? String(user.publicId).toUpperCase()
                    : "····"}
                </Text>
              </View>
            </View>

            <ProfileInstagramSection
              bio={user.bio}
              relationshipGoal={user.relationshipGoal}
              interests={user.interests}
              gallery={gallery}
              maxSlots={MAX_PROFILE_GALLERY}
              onPhotoPress={openPhotoViewer}
              onInfoPress={() => setInfoVisible(true)}
            />
            <View style={{ height: 24 }} />
          </ScrollView>

          {/* Footer actions */}
          {(onLike || onUnlike || onMessage) && (
            <View style={styles.footer}>
              {(onLike || onUnlike) && (
                <TouchableOpacity
                  style={[
                    styles.footerBtn,
                    alreadyLiked ? styles.footerBtnLiked : styles.footerBtnLike,
                  ]}
                  activeOpacity={0.85}
                  disabled={likingInProgress}
                  onPress={handleLikeToggle}
                >
                  <Ionicons
                    name={alreadyLiked ? "heart" : "heart-outline"}
                    size={20}
                    color={alreadyLiked ? "#FF4B6E" : "#fff"}
                  />
                  <Text
                    style={[
                      styles.footerBtnText,
                      alreadyLiked && { color: "#FF4B6E" },
                    ]}
                  >
                    {user.areFriends
                      ? "Friends"
                      : alreadyLiked
                        ? "Liked"
                        : "Like"}
                  </Text>
                </TouchableOpacity>
              )}
              {onMessage ? (
                <TouchableOpacity
                  style={[styles.footerBtn, styles.footerBtnMsg]}
                  activeOpacity={0.85}
                  onPress={onMessage}
                >
                  <Ionicons name="chatbubble" size={18} color="#fff" />
                  <Text style={styles.footerBtnText}>Message</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

        </SafeAreaView>
      </Modal>

      <ProfilePhotoViewer
        visible={photoViewerVisible}
        uris={gallery}
        initialIndex={selectedPhotoIndex}
        onClose={() => setPhotoViewerVisible(false)}
      />

      <ProfileInfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        info={{
          name: user.name,
          publicId: user.publicId,
          age: user.age,
          photo: avatarPhoto,
          gender: user.gender,
          height: user.height,
          relationshipGoal: user.relationshipGoal,
          distanceLabel: kmValue ? `${kmValue} km` : undefined,
          interests: user.interests,
          subscriptionBadge: user.subscriptionBadge,
          subscriptionExpiresAt: user.subscriptionExpiresAt,
        }}
      />
    </>
  );
}

const PHOTO_GAP = 8;
const PHOTO_PAD = 16;
const PHOTO_SIZE = (SCREEN_WIDTH - PHOTO_PAD * 2 - PHOTO_GAP * 3) / 4;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WA.bg,
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  coverBlock: {
    backgroundColor: WA.white,
    paddingBottom: 16,
  },
  coverWrap: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: WA.border,
  },
  coverImage: {
    ...StyleSheet.absoluteFillObject,
  },
  coverBackBtn: {
    position: "absolute",
    left: 12,
    zIndex: 5,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBlock: {
    alignItems: "center",
    marginTop: -44,
  },
  avatarWrap: {
    position: "relative",
    marginBottom: 10,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: WA.white,
    backgroundColor: WA.white,
    overflow: "visible",
  },
  onlineDot: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#25D366",
    borderWidth: 2,
    borderColor: WA.white,
  },
  userName: {
    fontSize: 20,
    fontWeight: "600",
    color: WA.text,
  },
  userIdText: {
    fontSize: 13,
    color: WA.secondary,
    marginTop: 3,
    letterSpacing: 0.5,
  },
  waSectionHint: {
    fontSize: 14,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  waListGroup: {
    backgroundColor: WA.white,
  },
  waListRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 16,
  },
  waIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  waRowContent: {
    flex: 1,
  },
  waRowLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: WA.text,
  },
  waRowSub: {
    fontSize: 13,
    color: WA.secondary,
    marginTop: 2,
  },
  waDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 72,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: PHOTO_GAP,
    paddingHorizontal: PHOTO_PAD,
    paddingVertical: 12,
  },
  photoSlot: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: WA.border,
  },
  photoSlotEmptyBg: {
    backgroundColor: "#F0EDF4",
  },
  photoSlotImage: {
    width: "100%",
    height: "100%",
  },
  coverTag: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  coverTagText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  photoSlotEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  addIconCircleLocked: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E7E0EC",
    alignItems: "center",
    justifyContent: "center",
  },
  interestsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  interestChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: WA.primaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  interestEmoji: { fontSize: 13 },
  interestChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: WA.teal,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: WA.border,
    backgroundColor: WA.white,
  },
  footerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 24,
  },
  footerBtnLike: {
    backgroundColor: WA.teal,
  },
  footerBtnLiked: {
    backgroundColor: "#FFF0F2",
    borderWidth: 1,
    borderColor: "#FF4B6E",
  },
  footerBtnMsg: {
    backgroundColor: "#128C7E",
  },
  footerBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
});
