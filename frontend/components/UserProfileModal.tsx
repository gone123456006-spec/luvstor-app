import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
    Animated,
    Dimensions,
    Modal,
    Pressable,
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
import { getAuthToken, isValidPublicId } from "../utils/auth";
import { blockUser, ReportReason, reportUser } from "../utils/friends";
import { mediaIdentity, resolveMediaUrl } from "../utils/media";
import { getSheetBottomPadding } from "../utils/navigation";
import { nearbyKmLabel } from "../utils/nearby";
import { showMeLabel } from "../utils/showMe";
import { useAppAlert } from "./AppAlert";
import CopyablePublicId, { sharePublicProfile } from "./CopyablePublicId";
import MediaImage, { prefetchMedia } from "./MediaImage";
import ProfileInstagramSection from "./ProfileInstagramSection";
import ProfilePhotoViewer from "./ProfilePhotoViewer";
import WhatsAppAvatar, {
  getDisplayName,
} from "./WhatsAppAvatar";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

/** Same theme as Profile tab */
const WA = {
  bg: "#FDF8FF",
  white: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#49454F",
  border: "#E7E0EC",
  teal: "#6750A4",
  primaryContainer: "#EADDFF",
  danger: "#B3261E",
};

const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: "spam", label: "Spam" },
  { key: "harassment", label: "Harassment or bullying" },
  { key: "inappropriate", label: "Inappropriate content" },
  { key: "fake_profile", label: "Fake profile" },
  { key: "underage", label: "Underage user" },
  { key: "other", label: "Other" },
];

const INTEREST_EMOJIS: Record<string, string> = {
  Travel: "✈️",
  Music: "🎵",
  Fitness: "🏋️",
  Cooking: "🍳",
  Art: "🎨",
  Gaming: "🎮",
  Movies: "🎬",
  Photography: "📷",
  Reading: "📖",
  Dancing: "💃",
  Nature: "🍃",
  Coffee: "☕",
  Yoga: "🧘",
  Sports: "⚽",
  Pets: "🐾",
  Food: "🍕",
};

const GOAL_EMOJIS: Record<string, string> = {
  "Long-term relationship": "👩‍❤️‍👨",
  "Casual dating": "🥂",
  Friendship: "🤝",
  "Just vibes": "🤙",
  "See where it goes": "🧭",
};

interface UserProfile {
  id: string;
  publicId?: string;
  name: string;
  age: number;
  bio: string;
  photo: string;
  photos?: string[];
  coverPhoto?: string;
  gender: string;
  interests: string[];
  height?: number | null;
  relationshipGoal?: string;
  showMe?: string;
  distance?: number;
  distanceKm?: string;
  isOnline?: boolean;
  friendshipStatus?: string;
  areFriends?: boolean;
  iLiked?: boolean;
  theyLiked?: boolean;
  subscriptionBadge?: string | null;
  subscriptionExpiresAt?: string | null;
  photoVerified?: boolean;
}


/** Same media file even if host/query differs — used to freeze DP/cover/posts. */
function sameMedia(a?: string | null, b?: string | null): boolean {
  const ia = mediaIdentity(a);
  const ib = mediaIdentity(b);
  if (ia && ib) return ia === ib;
  return String(a || "").trim() === String(b || "").trim();
}

/**
 * Merge incoming profile updates without swapping media URL strings when the
 * underlying file is unchanged. Returns `prev` unchanged when nothing visible
 * changed — avoids re-render loops that flip the screen.
 *
 * Empty `photos: []` is treated as a real clear (delete). Only omit/undefined
 * photos keeps the previous gallery (e.g. presence-only patches).
 */
function mergeStableUser(
  prev: UserProfile | null,
  next: UserProfile,
): UserProfile {
  if (!prev || prev.id !== next.id) return next;

  const photosProvided = Array.isArray(next.photos);
  const nextPhotos = photosProvided ? next.photos! : [];
  const prevPhotos = Array.isArray(prev.photos) ? prev.photos : [];

  let photos = prevPhotos;
  if (photosProvided) {
    if (
      nextPhotos.length === prevPhotos.length &&
      nextPhotos.every((p, i) => sameMedia(p, prevPhotos[i]))
    ) {
      photos = prevPhotos;
    } else {
      photos = nextPhotos;
    }
  }

  const photo = sameMedia(prev.photo, next.photo) ? prev.photo : next.photo;
  const coverPhoto = sameMedia(prev.coverPhoto, next.coverPhoto)
    ? prev.coverPhoto
    : next.coverPhoto;

  const merged: UserProfile = {
    ...next,
    photo,
    coverPhoto,
    photos,
  };

  if (
    merged.name === prev.name &&
    merged.age === prev.age &&
    merged.bio === prev.bio &&
    merged.photo === prev.photo &&
    merged.coverPhoto === prev.coverPhoto &&
    merged.photos === prev.photos &&
    merged.gender === prev.gender &&
    merged.isOnline === prev.isOnline &&
    merged.iLiked === prev.iLiked &&
    merged.areFriends === prev.areFriends &&
    merged.theyLiked === prev.theyLiked &&
    merged.friendshipStatus === prev.friendshipStatus &&
    merged.subscriptionBadge === prev.subscriptionBadge &&
    merged.photoVerified === prev.photoVerified &&
    merged.distanceKm === prev.distanceKm &&
    merged.relationshipGoal === prev.relationshipGoal &&
    merged.height === prev.height &&
    merged.showMe === prev.showMe
  ) {
    return prev;
  }

  return merged;
}

interface Props {
  visible: boolean;
  user: UserProfile | null;
  onClose: () => void;
  onLike?: () => void;
  onUnlike?: () => void;
  onMessage?: () => void;
  /** Called after a successful block (parent can remove from feed) */
  onBlocked?: (userId: string) => void;
  likingInProgress?: boolean;
}

function UserProfileModal({
  visible,
  user,
  onClose,
  onLike,
  onUnlike,
  onMessage,
  onBlocked,
  likingInProgress = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAppAlert();
  const [photoViewerVisible, setPhotoViewerVisible] = React.useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = React.useState(0);
  const [viewerUris, setViewerUris] = React.useState<string[]>([]);
  const [viewerTitle, setViewerTitle] = React.useState("Photos");
  const [likedLocal, setLikedLocal] = React.useState(false);
  const [infoVisible, setInfoVisible] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = React.useState(false);
  const [reasonPickerOpen, setReasonPickerOpen] = React.useState(false);
  const [pendingAlsoBlock, setPendingAlsoBlock] = React.useState(false);
  const [actionBusy, setActionBusy] = React.useState(false);
  const waSheetAnim = React.useRef(new Animated.Value(0)).current;
  const waSheetVisible = blockConfirmOpen || reportOpen || reasonPickerOpen;
  /** While Options/Info open, ignore parent user churn (presence) — stops loop blink. */
  const overlayOpenRef = React.useRef(false);
  overlayOpenRef.current = menuOpen || infoVisible;

  // Keep last known user so the Modal never unmounts mid-open / mid-fetch.
  const [displayUser, setDisplayUser] = React.useState<UserProfile | null>(user);

  React.useEffect(() => {
    if (!user) return;
    if (overlayOpenRef.current) return;
    setDisplayUser((prev) => mergeStableUser(prev, user));
  }, [user]);

  React.useEffect(() => {
    if (!waSheetVisible) {
      waSheetAnim.setValue(0);
      return;
    }
    waSheetAnim.setValue(0);
    Animated.timing(waSheetAnim, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [waSheetVisible, blockConfirmOpen, reportOpen, reasonPickerOpen, waSheetAnim]);

  const closeMenu = () => setMenuOpen(false);
  const closeMenuNow = () => {
    setMenuOpen(false);
    setReportOpen(false);
    setBlockConfirmOpen(false);
    setReasonPickerOpen(false);
    setPendingAlsoBlock(false);
  };

  const closeInfoPage = () => setInfoVisible(false);

  React.useEffect(() => {
    if (visible && user) {
      setLikedLocal(!!(user.iLiked || user.areFriends));
    }
  }, [visible, user?.id, user?.iLiked, user?.areFriends]);

  const gallery = React.useMemo(() => {
    if (!displayUser) return [] as string[];
    const seen = new Set<string>();
    const list: string[] = [];
    for (const url of displayUser.photos || []) {
      const resolved = resolveMediaUrl(url) || url || "";
      if (!resolved) continue;
      const key = mediaIdentity(resolved) || resolved;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(resolved);
      if (list.length >= MAX_PROFILE_GALLERY) break;
    }
    return list;
  }, [displayUser?.id, displayUser?.photos]);

  React.useEffect(() => {
    if (!visible || !displayUser) return;
    prefetchMedia(displayUser.photo);
    prefetchMedia(displayUser.coverPhoto);
    for (const uri of gallery) prefetchMedia(uri);
  }, [
    visible,
    displayUser?.id,
    displayUser?.photo,
    displayUser?.coverPhoto,
    gallery,
  ]);

  React.useEffect(() => {
    if (!visible) {
      setPhotoViewerVisible(false);
      setSelectedPhotoIndex(0);
      setViewerUris([]);
      setInfoVisible(false);
      setMenuOpen(false);
      setReportOpen(false);
      setBlockConfirmOpen(false);
      setReasonPickerOpen(false);
      setPendingAlsoBlock(false);
      setActionBusy(false);
    }
  }, [visible]);

  if (!visible || !displayUser) return null;

  const displayName = getDisplayName(displayUser.name, displayUser.publicId);
  const alreadyLiked = likedLocal;
  const coverUri =
    resolveMediaUrl(displayUser.coverPhoto) || displayUser.coverPhoto || null;
  const coverHeight = 148 + Math.max(insets.top, 0);
  const avatarPhoto = displayUser.photo || "";
  const kmValue =
    nearbyKmLabel(displayUser.distanceKm) ||
    nearbyKmLabel(
      displayUser.distance != null ? Number(displayUser.distance) / 1000 : undefined,
    ) ||
    "";

  const profileInfoRows = [
    {
      icon: "person" as const,
      color: "#9C27B0",
      title: "Gender",
      value: displayUser.gender,
    },
    {
      icon: "resize" as const,
      color: "#FF9800",
      title: "Height",
      value: displayUser.height ? `${displayUser.height} cm` : undefined,
    },
    {
      icon: "heart" as const,
      color: "#FF4B6E",
      title: "Looking for",
      value: displayUser.relationshipGoal
        ? `${GOAL_EMOJIS[displayUser.relationshipGoal] || ""} ${displayUser.relationshipGoal}`.trim()
        : undefined,
    },
    {
      icon: "people" as const,
      color: "#2196F3",
      title: "Show me",
      value: displayUser.showMe
        ? showMeLabel(displayUser.gender, displayUser.showMe)
        : undefined,
    },
    {
      icon: "locate" as const,
      color: WA.teal,
      title: "Distance",
      value: kmValue ? `${kmValue} km` : undefined,
    },
  ];

  const optionsInterests = (displayUser.interests || []).filter(Boolean);

  const showViewer = (uris: string[], index: number, title: string) => {
    const clean = uris.filter(Boolean);
    if (!clean.length) return;
    closeMenuNow();
    setViewerUris(clean);
    setViewerTitle(title);
    setSelectedPhotoIndex(Math.min(Math.max(index, 0), clean.length - 1));
    setPhotoViewerVisible(true);
  };

  const openPhotoViewer = (index: number) => {
    if (!gallery[index]) return;
    const startIndex = gallery.filter(Boolean).indexOf(gallery[index]);
    showViewer(gallery, startIndex >= 0 ? startIndex : 0, displayName);
  };

  const handleLikeToggle = () => {
    if (likingInProgress) return;
    if (displayUser.areFriends) {
      onUnlike?.();
      return;
    }
    const next = !alreadyLiked;
    setLikedLocal(next);
    if (next) onLike?.();
    else onUnlike?.();
  };

  const handleShare = () => {
    closeMenuNow();
    void sharePublicProfile({
      publicId: displayUser.publicId,
      name: displayName,
    });
  };

  const doBlock = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setBlockConfirmOpen(false);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await blockUser(token, displayUser.id);
      closeMenuNow();
      onBlocked?.(displayUser.id);
      onClose();
      setTimeout(() => {
        showAlert({
          title: "User blocked",
          message: `${displayName} has been blocked.`,
          icon: "hand-left",
        });
      }, 320);
    } catch (e: any) {
      showAlert({
        title: "Could not block",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleBlock = () => {
    setReportOpen(false);
    setReasonPickerOpen(false);
    setBlockConfirmOpen(true);
  };

  const handleReport = () => {
    setBlockConfirmOpen(false);
    setReasonPickerOpen(false);
    setReportOpen(true);
  };

  const openReasonPicker = (alsoBlock: boolean) => {
    setBlockConfirmOpen(false);
    setReportOpen(false);
    setPendingAlsoBlock(alsoBlock);
    setReasonPickerOpen(true);
  };

  const submitReport = async (reason: ReportReason, alsoBlock: boolean) => {
    if (actionBusy) return;
    setActionBusy(true);
    setReasonPickerOpen(false);
    setReportOpen(false);
    setBlockConfirmOpen(false);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await reportUser(token, displayUser.id, reason, { alsoBlock });
      closeMenuNow();
      if (alsoBlock) {
        onBlocked?.(displayUser.id);
        onClose();
      }
      setTimeout(() => {
        showAlert({
          title: alsoBlock ? "Reported & blocked" : "Report sent",
          message: alsoBlock
            ? `${displayName} was reported and blocked.`
            : "Thanks — our team will review this report.",
          icon: "checkmark-circle",
        });
      }, 320);
    } catch (e: any) {
      showAlert({
        title: "Could not report",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    } finally {
      setActionBusy(false);
    }
  };

  const topBtnTop = Math.max(insets.top, 8) + 8;

  return (
    <>
      <Modal
        visible={visible}
        animationType="none"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          if (reasonPickerOpen) setReasonPickerOpen(false);
          else if (reportOpen) setReportOpen(false);
          else if (blockConfirmOpen) setBlockConfirmOpen(false);
          else if (menuOpen) setMenuOpen(false);
          else if (infoVisible) setInfoVisible(false);
          else if (photoViewerVisible) setPhotoViewerVisible(false);
          else onClose();
        }}
        statusBarTranslucent
      >
        <SafeAreaView style={styles.container} edges={["bottom"]}>
          <View
            style={[styles.headerBar, { paddingTop: topBtnTop }]}
            pointerEvents="box-none"
          >
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={onClose}
              activeOpacity={0.8}
              hitSlop={8}
            >
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => setMenuOpen(true)}
              activeOpacity={0.8}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            style={styles.scrollView}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.coverBlock}>
              <TouchableOpacity
                style={[
                  styles.coverWrap,
                  { height: coverHeight },
                ]}
                activeOpacity={0.9}
                onPress={() => {
                  if (coverUri) showViewer([coverUri], 0, displayName);
                }}
                disabled={!coverUri}
              >
                {coverUri ? (
                  <MediaImage
                    uri={coverUri}
                    style={{ width: "100%", height: coverHeight }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={0}
                  />
                ) : (
                  <LinearGradient
                    colors={["#6750A4", "#FF4B6E"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ width: "100%", height: coverHeight }}
                  />
                )}
              </TouchableOpacity>

              <View style={styles.avatarBlock}>
                <TouchableOpacity
                  style={styles.avatarWrap}
                  onPress={() => {
                    const uri = resolveMediaUrl(avatarPhoto) || avatarPhoto;
                    if (uri) showViewer([uri], 0, displayName);
                  }}
                  activeOpacity={0.85}
                  disabled={!avatarPhoto}
                >
                  <WhatsAppAvatar
                    photo={avatarPhoto || undefined}
                    name={displayUser.name}
                    publicId={displayUser.publicId}
                    size={78}
                    online={!!displayUser.isOnline}
                    badge={displayUser.subscriptionBadge}
                    badgeExpiresAt={displayUser.subscriptionExpiresAt}
                    photoVerified={!!displayUser.photoVerified}
                  />
                </TouchableOpacity>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={styles.userName}>
                    {displayName}
                    {displayUser.age ? `, ${displayUser.age}` : ""}
                  </Text>
                  {displayUser.photoVerified ? (
                    <Ionicons
                      name="shield-checkmark"
                      size={18}
                      color="#22C55E"
                      style={{ marginLeft: 6, marginBottom: 6 }}
                    />
                  ) : null}
                </View>
                <CopyablePublicId
                  publicId={displayUser.publicId}
                  name={displayName}
                  showShare={false}
                />
              </View>
            </View>

            <ProfileInstagramSection
              bio={displayUser.bio}
              relationshipGoal={displayUser.relationshipGoal}
              interests={displayUser.interests}
              gallery={gallery}
              maxSlots={MAX_PROFILE_GALLERY}
              onPhotoPress={openPhotoViewer}
              onInfoPress={() => setInfoVisible(true)}
            />
            <View style={{ height: 24 }} />
          </ScrollView>

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
                  {displayUser.areFriends
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

          <ProfilePhotoViewer
            visible={photoViewerVisible}
            uris={viewerUris}
            initialIndex={selectedPhotoIndex}
            title={viewerTitle}
            onClose={() => setPhotoViewerVisible(false)}
            asOverlay
          />
        </SafeAreaView>

          {menuOpen ? (
            <View
              style={styles.optionsPage}
              collapsable={false}
              renderToHardwareTextureAndroid
              shouldRasterizeIOS
            >
              <View
                style={[
                  styles.optionsHeader,
                  { paddingTop: Math.max(insets.top, 8) },
                ]}
              >
                <TouchableOpacity
                  style={styles.optionsBackBtn}
                  onPress={closeMenuNow}
                  activeOpacity={0.7}
                  hitSlop={8}
                >
                  <Ionicons name="arrow-back" size={24} color="#262626" />
                </TouchableOpacity>

                <Text style={styles.optionsTitle} numberOfLines={1}>
                  Options
                </Text>

                <View style={styles.optionsHeaderSpacer} />
              </View>

              <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={[
                  styles.optionsScrollContent,
                  { paddingBottom: getSheetBottomPadding(insets.bottom) },
                ]}
                bounces={false}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.optionsAvatarBlock}>
                  <WhatsAppAvatar
                    photo={avatarPhoto || undefined}
                    name={displayUser.name}
                    publicId={displayUser.publicId}
                    size={96}
                    online={!!displayUser.isOnline}
                    badge={displayUser.subscriptionBadge}
                    badgeExpiresAt={displayUser.subscriptionExpiresAt}
                    photoVerified={!!displayUser.photoVerified}
                  />
                  <Text style={styles.optionsUserName} numberOfLines={1}>
                    {displayName}
                  </Text>
                </View>

                <View style={styles.optionsGroup}>
                  <TouchableOpacity
                    style={styles.optionsRow}
                    onPress={handleShare}
                    activeOpacity={0.65}
                  >
                    <Text style={styles.optionsRowText}>Share</Text>
                    <Ionicons name="share-outline" size={22} color="#262626" />
                  </TouchableOpacity>
                  <View style={styles.optionsDivider} />
                  <TouchableOpacity
                    style={styles.optionsRow}
                    onPress={handleBlock}
                    activeOpacity={0.65}
                    disabled={actionBusy}
                  >
                    <Text style={[styles.optionsRowText, styles.optionsDanger]}>
                      Block
                    </Text>
                    <Ionicons
                      name="hand-left-outline"
                      size={22}
                      color="#ED4956"
                    />
                  </TouchableOpacity>
                  <View style={styles.optionsDivider} />
                  <TouchableOpacity
                    style={styles.optionsRow}
                    onPress={handleReport}
                    activeOpacity={0.65}
                    disabled={actionBusy}
                  >
                    <Text style={[styles.optionsRowText, styles.optionsDanger]}>
                      Report
                    </Text>
                    <Ionicons name="flag-outline" size={22} color="#ED4956" />
                  </TouchableOpacity>
                </View>
              </ScrollView>

              {/* Block — WhatsApp-style sheet */}
              {blockConfirmOpen ? (
                <View
                  style={styles.waSheetOverlay}
                  pointerEvents="box-none"
                >
                  <Pressable
                    style={styles.waSheetBackdrop}
                    onPress={() => setBlockConfirmOpen(false)}
                  />
                  <Animated.View
                    style={[
                      styles.waSheet,
                      {
                        paddingBottom: getSheetBottomPadding(insets.bottom),
                        transform: [
                          {
                            translateY: waSheetAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [420, 0],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <View style={styles.waSheetHeader}>
                      <Text style={styles.waSheetTitle} numberOfLines={2}>
                        {`Block "${displayName}"?`}
                      </Text>
                      <TouchableOpacity
                        style={styles.waCloseBtn}
                        onPress={() => setBlockConfirmOpen(false)}
                        activeOpacity={0.7}
                        hitSlop={8}
                      >
                        <Ionicons name="close" size={20} color={WA.teal} />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.waInfoCard}>
                      <Text style={styles.waInfoText}>
                        This person won’t be able to message or call you. They
                        won’t know you blocked or reported them.
                      </Text>
                      <Text style={[styles.waInfoText, styles.waInfoTextGap]}>
                        If you block and report, recent messages from this chat
                        may also be sent to Luvstor.
                      </Text>
                    </View>

                    <View style={styles.waActionCard}>
                      <TouchableOpacity
                        style={styles.waActionRow}
                        activeOpacity={0.55}
                        disabled={actionBusy}
                        onPress={() => openReasonPicker(true)}
                      >
                        <Ionicons
                          name="warning-outline"
                          size={22}
                          color={WA.danger}
                        />
                        <Text style={styles.waActionText}>
                          Block and report
                        </Text>
                      </TouchableOpacity>
                      <View style={styles.waActionDivider} />
                      <TouchableOpacity
                        style={styles.waActionRow}
                        activeOpacity={0.55}
                        disabled={actionBusy}
                        onPress={() => void doBlock()}
                      >
                        <Ionicons
                          name="ban-outline"
                          size={22}
                          color={WA.danger}
                        />
                        <Text style={styles.waActionText}>Block</Text>
                      </TouchableOpacity>
                    </View>
                  </Animated.View>
                </View>
              ) : null}

              {/* Report — WhatsApp-style sheet */}
              {reportOpen ? (
                <View
                  style={styles.waSheetOverlay}
                  pointerEvents="box-none"
                >
                  <Pressable
                    style={styles.waSheetBackdrop}
                    onPress={() => setReportOpen(false)}
                  />
                  <Animated.View
                    style={[
                      styles.waSheet,
                      {
                        paddingBottom: getSheetBottomPadding(insets.bottom),
                        transform: [
                          {
                            translateY: waSheetAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [420, 0],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <View style={styles.waSheetHeader}>
                      <Text style={styles.waSheetTitle}>Report to Luvstor</Text>
                      <TouchableOpacity
                        style={styles.waCloseBtn}
                        onPress={() => setReportOpen(false)}
                        activeOpacity={0.7}
                        hitSlop={8}
                      >
                        <Ionicons name="close" size={20} color={WA.teal} />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.waInfoCard}>
                      <Text style={styles.waInfoText}>
                        Recent messages from this chat may be sent to Luvstor.
                        This person won’t know you blocked or reported them.
                      </Text>
                      <Text style={[styles.waInfoText, styles.waInfoTextGap]}>
                        If you report and block, this person won’t be able to
                        message or call you.
                      </Text>
                    </View>

                    <View style={styles.waActionCard}>
                      <TouchableOpacity
                        style={styles.waActionRow}
                        activeOpacity={0.55}
                        disabled={actionBusy}
                        onPress={() => openReasonPicker(true)}
                      >
                        <Ionicons
                          name="ban-outline"
                          size={22}
                          color={WA.danger}
                        />
                        <Text style={styles.waActionText}>
                          Report and block
                        </Text>
                      </TouchableOpacity>
                      <View style={styles.waActionDivider} />
                      <TouchableOpacity
                        style={styles.waActionRow}
                        activeOpacity={0.55}
                        disabled={actionBusy}
                        onPress={() => openReasonPicker(false)}
                      >
                        <Ionicons
                          name="warning-outline"
                          size={22}
                          color={WA.danger}
                        />
                        <Text style={styles.waActionText}>Report</Text>
                      </TouchableOpacity>
                    </View>
                  </Animated.View>
                </View>
              ) : null}

              {/* Report reason picker — same sheet UI as Block/Report */}
              {reasonPickerOpen ? (
                <View
                  style={styles.waSheetOverlay}
                  pointerEvents="box-none"
                >
                  <Pressable
                    style={styles.waSheetBackdrop}
                    onPress={() => setReasonPickerOpen(false)}
                  />
                  <Animated.View
                    style={[
                      styles.waSheet,
                      {
                        paddingBottom: getSheetBottomPadding(insets.bottom),
                        transform: [
                          {
                            translateY: waSheetAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [520, 0],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <View style={styles.waSheetHeader}>
                      <Text style={styles.waSheetTitle}>
                        {pendingAlsoBlock ? "Report and block" : "Report"}
                      </Text>
                      <TouchableOpacity
                        style={styles.waCloseBtn}
                        onPress={() => setReasonPickerOpen(false)}
                        activeOpacity={0.7}
                        hitSlop={8}
                      >
                        <Ionicons name="close" size={20} color={WA.teal} />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.waActionCard}>
                      {REPORT_REASONS.map((item, index) => (
                        <React.Fragment key={item.key}>
                          {index > 0 ? (
                            <View style={styles.reasonRowDivider} />
                          ) : null}
                          <TouchableOpacity
                            style={styles.reasonRow}
                            activeOpacity={0.55}
                            disabled={actionBusy}
                            onPress={() =>
                              void submitReport(item.key, pendingAlsoBlock)
                            }
                          >
                            <Text style={styles.reasonRowText}>
                              {item.label}
                            </Text>
                          </TouchableOpacity>
                        </React.Fragment>
                      ))}
                    </View>
                  </Animated.View>
                </View>
              ) : null}
            </View>
          ) : null}

          {infoVisible ? (
            <View
              style={styles.optionsPage}
              collapsable={false}
              renderToHardwareTextureAndroid
              shouldRasterizeIOS
            >
              <View
                style={[
                  styles.optionsHeader,
                  { paddingTop: Math.max(insets.top, 8) },
                ]}
              >
                <TouchableOpacity
                  style={styles.optionsBackBtn}
                  onPress={closeInfoPage}
                  activeOpacity={0.7}
                  hitSlop={8}
                >
                  <Ionicons name="arrow-back" size={24} color="#262626" />
                </TouchableOpacity>

                <Text style={styles.optionsTitle} numberOfLines={1}>
                  Profile Info
                </Text>

                <View style={styles.optionsHeaderSpacer} />
              </View>

              <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={[
                  styles.optionsScrollContent,
                  { paddingBottom: getSheetBottomPadding(insets.bottom) },
                ]}
                bounces={false}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.optionsAvatarBlock}>
                  <WhatsAppAvatar
                    photo={avatarPhoto || undefined}
                    name={displayUser.name}
                    publicId={displayUser.publicId}
                    size={96}
                    online={!!displayUser.isOnline}
                    badge={displayUser.subscriptionBadge}
                    badgeExpiresAt={displayUser.subscriptionExpiresAt}
                    photoVerified={!!displayUser.photoVerified}
                  />
                  <Text style={styles.optionsUserName} numberOfLines={1}>
                    {displayName}
                    {displayUser.age ? `, ${displayUser.age}` : ""}
                  </Text>
                  {isValidPublicId(displayUser.publicId) ? (
                    <CopyablePublicId
                      publicId={displayUser.publicId}
                      name={displayName}
                      textStyle={styles.optionsUserId}
                      showShare={false}
                    />
                  ) : null}
                </View>

                <View style={[styles.optionsGroup, styles.optionsInfoGroup]}>
                  {profileInfoRows.map((row, index) => {
                    const empty = !row.value?.trim();
                    return (
                      <React.Fragment key={row.title}>
                        {index > 0 ? (
                          <View style={styles.optionsDivider} />
                        ) : null}
                        <View style={styles.optionsInfoRow}>
                          <View
                            style={[
                              styles.optionsInfoIcon,
                              { backgroundColor: row.color },
                            ]}
                          >
                            <Ionicons
                              name={row.icon}
                              size={16}
                              color="#FFFFFF"
                            />
                          </View>
                          <View style={styles.optionsInfoTextWrap}>
                            <Text style={styles.optionsInfoLabel}>
                              {row.title}
                            </Text>
                            <Text
                              style={[
                                styles.optionsInfoValue,
                                empty && styles.optionsInfoValueEmpty,
                              ]}
                            >
                              {empty ? "Not set" : row.value}
                            </Text>
                          </View>
                        </View>
                      </React.Fragment>
                    );
                  })}
                </View>

                <View style={[styles.optionsGroup, styles.optionsInfoGroup]}>
                  <View style={styles.optionsInfoRow}>
                    <View
                      style={[
                        styles.optionsInfoIcon,
                        { backgroundColor: "#4CAF50" },
                      ]}
                    >
                      <Ionicons name="sparkles" size={16} color="#FFFFFF" />
                    </View>
                    <Text style={styles.optionsInfoLabel}>Interests</Text>
                  </View>
                  {optionsInterests.length > 0 ? (
                    <View style={styles.optionsInterestsWrap}>
                      {optionsInterests.map((interest) => (
                        <View key={interest} style={styles.optionsInterestChip}>
                          <Text style={styles.optionsInterestText}>
                            {INTEREST_EMOJIS[interest] || "✨"} {interest}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.optionsInfoEmptyPad}>Not set</Text>
                  )}
                </View>
              </ScrollView>
            </View>
          ) : null}
      </Modal>
    </>
  );
}

export default React.memo(UserProfileModal, (prev, next) => {
  if (prev.visible !== next.visible) return false;
  if (prev.likingInProgress !== next.likingInProgress) return false;
  if (prev.user === next.user) return true;
  if (!prev.user || !next.user) return prev.user === next.user;
  // Skip re-render when parent only churned object identity (presence ticks)
  return mergeStableUser(prev.user, next.user) === prev.user;
});


const PHOTO_GAP = 8;
const PHOTO_PAD = 16;
const PHOTO_SIZE = (SCREEN_WIDTH - PHOTO_PAD * 2 - PHOTO_GAP * 3) / 4;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WA.bg,
    overflow: "visible",
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
    width: "100%",
  },
  headerBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 300,
    elevation: 300,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  moreWrap: {
    alignItems: "flex-end",
    zIndex: 301,
  },
  /** Full-screen Options page (covers whole window) */
  optionsPage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFFFFF",
    zIndex: 99990,
    elevation: 99990,
  },
  optionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 10,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DBDBDB",
  },
  optionsBackBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  optionsHeaderCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 44,
  },
  optionsHeaderSpacer: {
    width: 44,
  },
  optionsInfoHeaderBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  optionsTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: "#262626",
    letterSpacing: 0.2,
  },
  optionsScroll: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  optionsScrollContent: {
    paddingTop: 28,
    paddingHorizontal: 16,
    flexGrow: 1,
  },
  optionsAvatarBlock: {
    alignItems: "center",
    marginBottom: 28,
    gap: 8,
  },
  optionsUserName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#262626",
  },
  optionsUserId: {
    fontSize: 13,
    color: WA.secondary,
    letterSpacing: 0.4,
  },
  optionsGroup: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DBDBDB",
  },
  optionsInfoGroup: {
    marginBottom: 12,
  },
  optionsInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  optionsInfoIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionsInfoTextWrap: {
    flex: 1,
  },
  optionsInfoLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: WA.secondary,
  },
  optionsInfoValue: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: "500",
    color: WA.text,
  },
  optionsInfoValueEmpty: {
    color: "#8E8E8E",
    fontWeight: "400",
  },
  optionsInfoEmptyPad: {
    fontSize: 15,
    color: "#8E8E8E",
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  optionsInterestsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  optionsInterestChip: {
    backgroundColor: WA.primaryContainer,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  optionsInterestText: {
    fontSize: 13,
    color: WA.teal,
    fontWeight: "500",
  },
  optionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
  },
  optionsRowText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "400",
    color: "#262626",
  },
  optionsDanger: {
    color: "#ED4956",
  },
  optionsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#DBDBDB",
    marginLeft: 16,
  },
  /** In-page alert sheets — nested Modal does not show */
  confirmOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 30,
    elevation: 30,
    justifyContent: "flex-end",
  },
  confirmOverlayCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    elevation: 40,
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  /** WhatsApp-style Block / Report sheet */
  waSheetOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    elevation: 40,
    justifyContent: "flex-end",
  },
  waSheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  waSheet: {
    width: "100%",
    backgroundColor: WA.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 14,
    paddingTop: 14,
    gap: 10,
    zIndex: 41,
  },
  waSheetHeader: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 44,
    marginBottom: 2,
  },
  waSheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: WA.text,
    textAlign: "center",
  },
  waCloseBtn: {
    position: "absolute",
    right: 4,
    top: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: WA.primaryContainer,
    alignItems: "center",
    justifyContent: "center",
  },
  waInfoCard: {
    backgroundColor: WA.white,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: WA.border,
  },
  waInfoText: {
    fontSize: 15,
    lineHeight: 21,
    color: WA.text,
    fontWeight: "400",
  },
  waInfoTextGap: {
    marginTop: 14,
  },
  waActionCard: {
    backgroundColor: WA.white,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: WA.border,
  },
  waActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  waActionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 52,
  },
  waActionText: {
    fontSize: 16,
    fontWeight: "500",
    color: WA.danger,
  },
  outlineCardCenterWrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 36,
    zIndex: 41,
  },
  /** Outlined centered card (like reference popup) */
  outlineCard: {
    width: "100%",
    maxWidth: 300,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#C7C7CC",
  },
  outlineBorder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#C7C7CC",
  },
  outlineCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111111",
    textAlign: "center",
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  outlineCardHDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E5E5EA",
  },
  outlineCardVDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: "#E5E5EA",
    alignSelf: "stretch",
  },
  outlineCardActions: {
    flexDirection: "row",
    minHeight: 52,
  },
  outlineCardAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  outlineCardActionDanger: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ED4956",
  },
  outlineCardActionPrimary: {
    fontSize: 15,
    fontWeight: "600",
    color: WA.teal,
  },
  alertSheet: {
    width: "100%",
    paddingHorizontal: 10,
    paddingBottom: 6,
    gap: 8,
    zIndex: 41,
  },
  alertCard: {
    backgroundColor: WA.white,
    borderRadius: 14,
    overflow: "hidden",
  },
  alertStick: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D1D6",
    marginTop: 10,
    marginBottom: 4,
  },
  alertTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: WA.text,
    textAlign: "center",
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  alertMessage: {
    marginTop: 8,
    marginBottom: 16,
    fontSize: 13,
    lineHeight: 18,
    color: "#8E8E8E",
    textAlign: "center",
    paddingHorizontal: 16,
  },
  alertDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
  },
  alertBtn: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  alertBtnDefault: {
    fontSize: 17,
    fontWeight: "400",
    color: WA.teal,
  },
  alertCancel: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: WA.white,
    alignItems: "center",
    justifyContent: "center",
  },
  alertCancelText: {
    fontSize: 17,
    fontWeight: "600",
    color: WA.teal,
  },
  reasonSheet: {
    width: "100%",
    paddingHorizontal: 10,
    gap: 8,
    zIndex: 41,
  },
  reasonCard: {
    backgroundColor: WA.white,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: WA.border,
  },
  reasonStick: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D1D6",
    marginTop: 10,
    marginBottom: 4,
  },
  reasonTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: WA.text,
    textAlign: "center",
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  reasonSubtitle: {
    marginTop: 6,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
    color: WA.secondary,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  reasonDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
  },
  reasonBtn: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  reasonBtnText: {
    fontSize: 17,
    fontWeight: "400",
    color: WA.teal,
    textAlign: "center",
  },
  reasonCancel: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: WA.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: WA.border,
  },
  reasonWhyText: {
    fontSize: 15,
    lineHeight: 21,
    color: WA.secondary,
    textAlign: "center",
    fontWeight: "400",
  },
  reasonRow: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  reasonRowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
  },
  reasonRowText: {
    fontSize: 16,
    fontWeight: "500",
    color: WA.teal,
    textAlign: "center",
  },
  reasonCancelCard: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: WA.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: WA.border,
  },
  reasonCancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: WA.teal,
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
  sheetOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 40,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(11, 20, 26, 0.45)",
  },
  sheetWrap: {
    paddingHorizontal: 12,
    gap: 8,
  },
  sheetCard: {
    backgroundColor: "#E4E6EB",
    borderRadius: 16,
    overflow: "hidden",
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  sheetRowText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: WA.text,
  },
  sheetDanger: {
    color: WA.danger,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 18,
  },
  sheetCancel: {
    backgroundColor: "#E4E6EB",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  sheetCancelText: {
    fontSize: 16,
    fontWeight: "700",
    color: WA.teal,
  },
  reportTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: WA.text,
    textAlign: "center",
    paddingTop: 16,
    paddingHorizontal: 18,
  },
  reportSubtitle: {
    fontSize: 13,
    color: WA.secondary,
    textAlign: "center",
    paddingHorizontal: 18,
    paddingBottom: 10,
    paddingTop: 4,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: WA.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: WA.border,
  },
  footerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 24,
  },
  footerBtnLike: {
    backgroundColor: WA.teal,
  },
  footerBtnLiked: {
    backgroundColor: "#FFE8EE",
  },
  footerBtnMsg: {
    backgroundColor: "#25D366",
  },
  footerBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});
