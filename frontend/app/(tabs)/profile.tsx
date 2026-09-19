import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
    ActionSheetIOS,
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";
import CopyablePublicId from "../../components/CopyablePublicId";
import MediaImage, { prefetchMedia } from "../../components/MediaImage";
import ProfileInfoModal from "../../components/ProfileInfoModal";
import ProfileInstagramSection from "../../components/ProfileInstagramSection";
import ProfilePhotoViewer from "../../components/ProfilePhotoViewer";
import WhatsAppAvatar, {
    getDisplayName,
} from "../../components/WhatsAppAvatar";
import { MAX_PROFILE_GALLERY } from "../../constants/profile";
import { useAuth } from "../../contexts/AuthContext";
import { useSocket } from "../../contexts/SocketContext";
import { apiRequest, getApiBase } from "../../utils/api";
import {
    getAuthToken,
    getCurrentAuthUser,
    getLocalProfile,
    saveLocalProfile,
} from "../../utils/auth";
import { resolveMediaUrl } from "../../utils/media";
import {
    getCachedProfile,
    preloadProfile,
    ProfileScreenSnapshot,
    updateCachedProfile,
} from "../../utils/profileCache";
import {
    followGenderChange,
    resolveShowMe,
    SHOW_ME_OPTIONS,
    showMeLabel,
} from "../../utils/showMe";
import { useLiveSubscriptionBadge } from "../../utils/subscriptions";
import { useTabBarOverlayInset } from "../../hooks/useTabBarOverlayInset";

// ── Luvstor theme + WhatsApp-style layout ───────────────────
const WA = {
  bg: "#F5F5F7",
  white: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#49454F",
  border: "#E7E0EC",
  teal: "#6750A4",
  green: "#6750A4",
  danger: "#FF4B6E",
  header: "#F5F5F7",
  accent: "#FF4B6E",
  primaryContainer: "#EADDFF",
};

const C = {
  primary: "#6750A4",
  primaryContainer: "#EADDFF",
  surface: "#FFFFFF",
  surfaceVariant: "#E7E0EC",
  outline: "#79747E",
  outlineVariant: "#CAC4D0",
  onSurface: "#1C1B1F",
  onSurfaceVariant: "#49454F",
  accent: "#FF4B6E",
  accentLight: "#FFF0F2",
};

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

const INTEREST_OPTIONS = Object.keys(INTEREST_EMOJIS);

const GOAL_EMOJIS: Record<string, string> = {
  "Long-term relationship": "👩‍❤️‍👨",
  "Casual dating": "🥂",
  Friendship: "🤝",
  "Just vibes": "🤙",
  "See where it goes": "🧭",
  "Meaningful connection": "💖",
  "Chat & chill": "💬",
  "Friends first": "👫",
  Exploring: "🎒",
  "Open to possibilities": "🌟",
};

const GOAL_OPTIONS = Object.keys(GOAL_EMOJIS);
const GENDER_EDIT_OPTIONS = ["Man", "Woman", "Other"] as const;
const DISTANCE_EDIT_OPTIONS = [1, 5, 10, 25, 50, 100];

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabClearance = useTabBarOverlayInset();
  const { sessionVersion, refreshSession } = useAuth();
  const { bumpProfileLocal } = useSocket();
  const initialSnapshot = React.useMemo(() => getCachedProfile(), []);
  const [profile, setProfile] = useState<any>(initialSnapshot?.profile ?? null);
  const [safetyVisible, setSafetyVisible] = useState(false);
  const [supportVisible, setSupportVisible] = useState(false);
  const [supportTab, setSupportTab] = useState<"faq" | "ticket">("faq");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [ticketCategory, setTicketCategory] = useState("Account");
  const supportScrollRef = useRef<ScrollView>(null);
  const [photoOptionsVisible, setPhotoOptionsVisible] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAge, setEditAge] = useState("");
  const [editGender, setEditGender] = useState("");
  const [editShowMe, setEditShowMe] = useState("");
  const [editHeight, setEditHeight] = useState("");
  const [editGoal, setEditGoal] = useState("");
  const [editDistance, setEditDistance] = useState(10);
  const [editInterests, setEditInterests] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  /** Local/server preview for Edit Profile DP (shows instantly while uploading). */
  const [editPhotoUri, setEditPhotoUri] = useState<string | null>(null);

  // Posts gallery (up to 6) — independent from DP + cover
  const [gallery, setGallery] = useState<string[]>(
    initialSnapshot?.gallery ?? [],
  );
  const [coverPhoto, setCoverPhoto] = useState<string>(
    initialSnapshot?.coverPhoto ?? initialSnapshot?.profile?.coverPhoto ?? "",
  );
  const [coverBusy, setCoverBusy] = useState(false);
  const coverBusyRef = useRef(false);
  const coverPhotoRef = useRef(coverPhoto);
  coverPhotoRef.current = coverPhoto;
  /** After a successful cover save, ignore empty server snapshots briefly */
  const coverStickyUntilRef = useRef(0);
  const [coverOptionsVisible, setCoverOptionsVisible] = useState(false);
  const [gallerySlotBusy, setGallerySlotBusy] = useState<number | null>(null);
  const [gallerySlot, setGallerySlot] = useState<number>(0);
  const [galleryOptionsVisible, setGalleryOptionsVisible] = useState(false);
  const [subscriptionBadge, setSubscriptionBadge] = useState<string | null>(
    initialSnapshot?.subscriptionBadge ?? null,
  );
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState<
    string | null
  >(initialSnapshot?.subscriptionExpiresAt ?? null);
  const liveSubscriptionBadge = useLiveSubscriptionBadge(
    subscriptionBadge,
    subscriptionExpiresAt,
  );
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);
  const [photoViewerUris, setPhotoViewerUris] = useState<string[]>([]);
  const [photoViewerTitle, setPhotoViewerTitle] = useState("Photos");

  const [activeSafetyTab, setActiveSafetyTab] = useState<"tips" | "checklist">(
    "tips",
  );
  const [checklistItems, setChecklistItems] = useState<string[]>([]);

  const CHECKLIST_OPTIONS = [
    { key: "public", text: "Meet in a crowded public space (like a cafe) ☕" },
    {
      key: "friend",
      text: "Let a friend know where you are going & share details 📍",
    },
    {
      key: "transport",
      text: "Have your own transport arranged (Uber/car/transit) 🚗",
    },
    {
      key: "privacy",
      text: "Keep your personal details (address, handles) private 🔒",
    },
    {
      key: "instinct",
      text: "Trust your gut feeling & leave if you feel uncomfortable 💯",
    },
  ];

  const toggleChecklistItem = (key: string) => {
    setChecklistItems((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  // ── Image URL helpers ──
  const toAbsolute = (url?: string | null) => {
    if (!url) return "";
    return resolveMediaUrl(url) || url;
  };

  /** Server stores relative paths (/uploads/...) so they survive IP changes. */
  const toRelative = (url?: string | null) => {
    if (!url) return "";
    const clean = url.split("?")[0];
    try {
      const parsed = new URL(clean);
      if (parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
    } catch {
      /* relative path */
    }
    const base = getApiBase();
    return clean.startsWith(base) ? clean.slice(base.length) : clean;
  };

  /** Upload a local image, returns the server-relative url. */
  const uploadImage = async (uri: string): Promise<string | null> => {
    const token = await getAuthToken();
    if (!token) {
      Alert.alert("Error", "Please log in to upload photo");
      return null;
    }
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const result = await apiRequest("/api/upload/image", token, {
      method: "POST",
      body: JSON.stringify({ base64: `data:image/jpeg;base64,${base64}` }),
    });
    return (result as any)?.url || null;
  };

  // ── Photo Upload Functions ──
  const uploadPhotoToBackend = async (uri: string) => {
    try {
      setUploadingPhoto(true);
      // Show picked image on Edit Profile immediately
      setEditPhotoUri(uri);

      const token = await getAuthToken();
      if (!token) {
        Alert.alert("Error", "Please log in to upload photo");
        setEditPhotoUri(null);
        setUploadingPhoto(false);
        return null;
      }

      const url = await uploadImage(uri);
      if (!url) {
        setEditPhotoUri(null);
        setUploadingPhoto(false);
        return null;
      }

      const absoluteUrl = toAbsolute(url);
      const busted = `${absoluteUrl}?t=${Date.now()}`;

      // Update profile with new photo URL on backend
      await apiRequest("/api/users/me", token, {
        method: "PUT",
        body: JSON.stringify({ photo: url }),
      });

      // Update local profile immediately
      const authUser = await getCurrentAuthUser();
      if (authUser?.email) {
        const currentProfile = await getLocalProfile(authUser.email);
        await saveLocalProfile(authUser.email, {
          ...currentProfile,
          photo: absoluteUrl,
        });
      }

      setProfile((prev: any) => (prev ? { ...prev, photo: busted } : prev));
      updateCachedProfile({ photo: busted });
      setEditPhotoUri(busted);

      if (authUser) {
        bumpProfileLocal({
          userId: String(authUser.id || profile?.id || ""),
          name: profile?.name,
          photo: busted,
          gender: profile?.gender,
        });
      }

      setUploadingPhoto(false);
      return busted;
    } catch (error: any) {
      console.error("Upload error:", error);
      setEditPhotoUri(null);
      Alert.alert("Upload Error", error?.message || "Failed to upload photo");
      setUploadingPhoto(false);
      return null;
    }
  };

  const takePhoto = async () => {
    setPhotoOptionsVisible(false);

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Please allow camera access to take photos",
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      setEditPhotoUri(localUri);
      const photoUrl = await uploadPhotoToBackend(localUri);
      if (!photoUrl) {
        Alert.alert("Error", "Failed to upload photo. Please try again.");
      }
    }
  };

  const chooseFromGallery = async () => {
    setPhotoOptionsVisible(false);

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo library access");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      setEditPhotoUri(localUri);
      const photoUrl = await uploadPhotoToBackend(localUri);
      if (!photoUrl) {
        Alert.alert("Error", "Failed to upload photo. Please try again.");
      }
    }
  };

  const removePhoto = async () => {
    setPhotoOptionsVisible(false);

    Alert.alert(
      "Remove Photo",
      "Are you sure you want to remove your profile picture?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              const token = await getAuthToken();
              if (!token) return;

              // Update backend
              await apiRequest("/api/users/me", token, {
                method: "PUT",
                body: JSON.stringify({ photo: "" }),
              });

              // Update local profile
              const authUser = await getCurrentAuthUser();
              if (authUser?.email) {
                const currentProfile = await getLocalProfile(authUser.email);
                await saveLocalProfile(authUser.email, {
                  ...currentProfile,
                  photo: "",
                });
              }
              setProfile((prev: any) => (prev ? { ...prev, photo: "" } : prev));
              setEditPhotoUri(null);
              updateCachedProfile({ photo: "" });
              if (authUser) {
                bumpProfileLocal({
                  userId: String(authUser.id || profile?.id || ""),
                  name: profile?.name,
                  photo: "",
                  gender: profile?.gender,
                });
              }

              Alert.alert("Success", "Profile picture removed");
            } catch (error) {
              Alert.alert("Error", "Failed to remove photo");
            }
          },
        },
      ],
    );
  };

  const showPhotoViewer = (uris: string[], index: number, title = "Photos") => {
    if (!uris.length) return;
    setPhotoViewerUris(uris);
    setPhotoViewerIndex(Math.min(Math.max(index, 0), uris.length - 1));
    setPhotoViewerTitle(title);
    setPhotoViewerVisible(true);
  };

  const viewPhoto = () => {
    setPhotoOptionsVisible(false);
    const avatar = editPhotoUri || profile?.photo;
    if (!avatar) return;
    const uris = gallery.filter(Boolean);
    const idx = uris.findIndex(
      (uri) => String(uri).split("?")[0] === String(avatar).split("?")[0],
    );
    if (idx >= 0) {
      showPhotoViewer(uris, idx, "Profile photo");
      return;
    }
    showPhotoViewer([avatar], 0, "Profile photo");
  };

  const handlePhotoPress = () => {
    if (Platform.OS === "ios") {
      // iOS Action Sheet
      const hasPhoto = !!(editPhotoUri || profile?.photo);
      const options = hasPhoto
        ? [
            "View Photo",
            "Take Photo",
            "Choose from Library",
            "Remove Photo",
            "Cancel",
          ]
        : ["Take Photo", "Choose from Library", "Cancel"];

      const destructiveIndex = hasPhoto ? 3 : -1;
      const cancelIndex = hasPhoto ? 4 : 2;

      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: cancelIndex,
          destructiveButtonIndex: destructiveIndex,
        },
        (buttonIndex) => {
          if (hasPhoto) {
            if (buttonIndex === 0) viewPhoto();
            else if (buttonIndex === 1) takePhoto();
            else if (buttonIndex === 2) chooseFromGallery();
            else if (buttonIndex === 3) removePhoto();
          } else {
            if (buttonIndex === 0) takePhoto();
            else if (buttonIndex === 1) chooseFromGallery();
          }
        },
      );
    } else {
      // Android Modal
      setPhotoOptionsVisible(true);
    }
  };

  // ── Cover (independent from DP + posts) ───────────────────────
  const displayCoverUrl = (url?: string | null) => {
    if (!url) return "";
    return resolveMediaUrl(url) || toAbsolute(url) || url;
  };

  const persistCover = async (next: string) => {
    const token = await getAuthToken();
    if (!token) throw new Error("Please log in");
    const relative = toRelative(next);
    const display = displayCoverUrl(relative || next);
    const res: any = await apiRequest("/api/users/me", token, {
      method: "PUT",
      body: JSON.stringify({ coverPhoto: relative }),
    });
    const saved =
      typeof res?.profile?.coverPhoto === "string"
        ? res.profile.coverPhoto
        : relative;
    const savedDisplay = displayCoverUrl(saved) || display;
    const authUser = await getCurrentAuthUser();
    if (authUser?.email) {
      const current = await getLocalProfile(authUser.email);
      await saveLocalProfile(authUser.email, {
        ...current,
        coverPhoto: saved || relative,
      });
    }
    updateCachedProfile({
      coverPhoto: savedDisplay,
      profile: {
        ...(getCachedProfile()?.profile || profile || {}),
        coverPhoto: saved || relative,
      } as any,
    });
    coverPhotoRef.current = savedDisplay;
    setCoverPhoto(savedDisplay);
    setProfile((prev: any) =>
      prev ? { ...prev, coverPhoto: saved || relative } : prev,
    );
    coverStickyUntilRef.current = Date.now() + 20_000;
    const myId = String(profile?.userId || authUser?.id || "");
    if (myId) {
      bumpProfileLocal({
        userId: myId,
        publicId: profile?.publicId,
        coverPhoto: saved || relative,
        photo: profile?.photo,
        name: profile?.name,
      });
    }
    return savedDisplay;
  };

  const pickCoverImage = async (fromCamera: boolean) => {
    setCoverOptionsVisible(false);
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert(
        "Permission needed",
        fromCamera
          ? "Please allow camera access to take photos"
          : "Please allow photo library access",
      );
      return;
    }
    const pickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9] as [number, number],
      quality: 0.9,
    };
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (result.canceled || !result.assets?.[0]) return;

    const localUri = result.assets[0].uri;
    coverBusyRef.current = true;
    setCoverBusy(true);
    // Instant local preview so cover is visible immediately
    coverPhotoRef.current = localUri;
    setCoverPhoto(localUri);
    try {
      const url = await uploadImage(localUri);
      if (!url) throw new Error("Upload failed");
      await persistCover(url);
    } catch (e: any) {
      coverPhotoRef.current = "";
      setCoverPhoto("");
      Alert.alert("Upload failed", e?.message || "Please try again.");
    } finally {
      coverBusyRef.current = false;
      setCoverBusy(false);
    }
  };

  const removeCoverPhoto = () => {
    setCoverOptionsVisible(false);
    Alert.alert("Remove cover", "Remove your cover photo?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          coverBusyRef.current = true;
          coverStickyUntilRef.current = 0;
          coverPhotoRef.current = "";
          setCoverPhoto("");
          try {
            await persistCover("");
          } catch {
            Alert.alert("Error", "Could not remove cover");
          } finally {
            coverBusyRef.current = false;
          }
        },
      },
    ]);
  };

  const viewCoverPhoto = () => {
    setCoverOptionsVisible(false);
    if (!coverPhoto) return;
    const uri = displayCoverUrl(coverPhoto);
    showPhotoViewer([uri], 0, "Cover photo");
  };

  const openCoverOptions = () => {
    if (Platform.OS === "ios") {
      const hasCover = !!coverPhoto;
      const options = hasCover
        ? [
            "View Cover",
            "Replace with Camera",
            "Replace from Library",
            "Remove Cover",
            "Cancel",
          ]
        : ["Take Photo", "Choose from Library", "Cancel"];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: hasCover ? 4 : 2,
          destructiveButtonIndex: hasCover ? 3 : -1,
        },
        (buttonIndex) => {
          if (hasCover) {
            if (buttonIndex === 0) viewCoverPhoto();
            else if (buttonIndex === 1) pickCoverImage(true);
            else if (buttonIndex === 2) pickCoverImage(false);
            else if (buttonIndex === 3) removeCoverPhoto();
          } else {
            if (buttonIndex === 0) pickCoverImage(true);
            else if (buttonIndex === 1) pickCoverImage(false);
          }
        },
      );
    } else {
      setCoverOptionsVisible(true);
    }
  };

  // ── Posts gallery (max 6) — independent from cover + DP ──
  const persistGallery = async (next: string[]) => {
    const token = await getAuthToken();
    if (!token) return;
    const relative = next.map(toRelative).filter(Boolean);

    const res = await apiRequest("/api/users/me", token, {
      method: "PUT",
      body: JSON.stringify({ photos: relative }),
    });

    const granted = Number(res?.galleryPostTokensGranted || 0);
    if (granted > 0) {
      Alert.alert(
        "Post photo bonus!",
        `You received ${granted} free tokens for adding post photo(s).`,
      );
    }

    const authUser = await getCurrentAuthUser();
    if (authUser?.email) {
      const current = await getLocalProfile(authUser.email);
      await saveLocalProfile(authUser.email, { ...current, photos: relative });
    }
  };

  const pickGalleryImage = async (index: number, fromCamera: boolean) => {
    setGalleryOptionsVisible(false);

    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert(
        "Permission needed",
        fromCamera
          ? "Please allow camera access to take photos"
          : "Please allow photo library access",
      );
      return;
    }

    const pickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.85,
    };
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);

    if (result.canceled || !result.assets?.[0]) return;

    setGallerySlotBusy(index);
    try {
      const url = await uploadImage(result.assets[0].uri);
      if (!url) throw new Error("Upload failed");

      const next = [...gallery];
      next[index] = toAbsolute(url);
      const compact = next.filter(Boolean).slice(0, MAX_PROFILE_GALLERY);

      setGallery(compact);
      await persistGallery(compact);
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message || "Please try again.");
    } finally {
      setGallerySlotBusy(null);
    }
  };

  const removeGalleryPhoto = (index: number) => {
    setGalleryOptionsVisible(false);
    Alert.alert("Remove photo", "Remove this photo from your profile?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const next = gallery.filter((_, i) => i !== index);
          setGallery(next);
          try {
            await persistGallery(next);
          } catch {
            Alert.alert("Error", "Could not remove photo");
          }
        },
      },
    ]);
  };

  const openPhotoViewer = (index: number) => {
    if (!gallery[index]) return;
    const uris = gallery.filter(Boolean);
    const startIndex = uris.indexOf(gallery[index]);
    showPhotoViewer(uris, startIndex >= 0 ? startIndex : 0, "Photos");
  };

  const openGalleryOptions = (index: number) => {
    setGallerySlot(index);

    if (Platform.OS === "ios") {
      const hasPhoto = !!gallery[index];
      const options = hasPhoto
        ? [
            "Replace with Camera",
            "Replace from Library",
            "Remove Photo",
            "Cancel",
          ]
        : ["Take Photo", "Choose from Library", "Cancel"];

      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: hasPhoto ? 3 : 2,
          destructiveButtonIndex: hasPhoto ? 2 : -1,
        },
        (buttonIndex) => {
          if (hasPhoto) {
            if (buttonIndex === 0) pickGalleryImage(index, true);
            else if (buttonIndex === 1) pickGalleryImage(index, false);
            else if (buttonIndex === 2) removeGalleryPhoto(index);
          } else {
            if (buttonIndex === 0) pickGalleryImage(index, true);
            else if (buttonIndex === 1) pickGalleryImage(index, false);
          }
        },
      );
    } else {
      setGalleryOptionsVisible(true);
    }
  };

  const handleGallerySlotPress = (index: number) => {
    if (gallery[index]) {
      openPhotoViewer(index);
      return;
    }
    openGalleryOptions(index);
  };

  const handleGallerySlotLongPress = (index: number) => {
    if (!gallery[index]) return;
    openGalleryOptions(index);
  };

  const openEditProfile = () => {
    setEditName(profile?.name || "");
    setEditBio(profile?.bio || "");
    setEditAge(
      profile?.age != null && Number(profile.age) > 0
        ? String(profile.age)
        : "",
    );
    setEditGender(profile?.gender || "");
    setEditShowMe(resolveShowMe(profile?.gender, profile?.showMe) || "");
    setEditHeight(
      profile?.height != null && Number(profile.height) > 0
        ? String(profile.height)
        : "",
    );
    setEditGoal(profile?.relationshipGoal || "");
    const dist = Number(profile?.distance);
    setEditDistance(Number.isFinite(dist) && dist > 0 ? Math.round(dist) : 10);
    setEditInterests(
      Array.isArray(profile?.interests)
        ? profile.interests.filter((i: string) => typeof i === "string")
        : [],
    );
    setEditPhotoUri(null);
    setEditVisible(true);
  };

  const toggleEditInterest = (label: string) => {
    setEditInterests((prev) =>
      prev.includes(label) ? prev.filter((i) => i !== label) : [...prev, label],
    );
  };

  const saveEditProfile = async () => {
    const name = editName.trim();
    const bio = editBio.trim();
    const ageNum = editAge.trim() ? parseInt(editAge.trim(), 10) : null;
    const heightNum = editHeight.trim()
      ? parseInt(editHeight.trim(), 10)
      : null;
    const gender = editGender.trim();
    const showMe = editShowMe.trim() || resolveShowMe(gender, "");
    const relationshipGoal = editGoal.trim();
    const interests = editInterests.slice(0, 16);
    const distance = editDistance;

    if (!name) {
      Alert.alert("Name required", "Please enter your name.");
      return;
    }
    if (bio.length > 300) {
      Alert.alert(
        "About Me too long",
        "Please keep About Me under 300 characters.",
      );
      return;
    }
    if (
      ageNum != null &&
      (!Number.isFinite(ageNum) || ageNum < 18 || ageNum > 100)
    ) {
      Alert.alert("Invalid age", "Please enter an age between 18 and 100.");
      return;
    }
    if (
      heightNum != null &&
      (!Number.isFinite(heightNum) || heightNum < 100 || heightNum > 250)
    ) {
      Alert.alert(
        "Invalid height",
        "Please enter height between 100 and 250 cm.",
      );
      return;
    }
    if (!Number.isFinite(distance) || distance < 1 || distance > 500) {
      Alert.alert("Invalid distance", "Please pick a discovery distance.");
      return;
    }
    if (interests.length < 1) {
      Alert.alert("Interests", "Please select at least 1 interest.");
      return;
    }

    setSavingEdit(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        Alert.alert("Error", "Please sign in again.");
        return;
      }

      const payload: Record<string, unknown> = {
        name,
        bio,
        gender,
        showMe,
        relationshipGoal,
        interests,
        distance,
        height: heightNum,
      };
      if (ageNum != null) payload.age = ageNum;

      await apiRequest("/api/users/me", token, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      const authUser = await getCurrentAuthUser();
      const next = {
        ...(profile || {}),
        name,
        bio,
        age: ageNum ?? profile?.age ?? null,
        gender,
        showMe,
        height: heightNum,
        relationshipGoal,
        interests,
        distance,
      };
      setProfile(next);
      if (authUser?.email) {
        const current = (await getLocalProfile(authUser.email)) || {};
        await saveLocalProfile(authUser.email, {
          ...current,
          name,
          bio,
          age: ageNum ?? current.age ?? null,
          gender,
          showMe,
          height: heightNum,
          relationshipGoal,
          interests,
          distance,
        });
      }

      bumpProfileLocal({
        userId: String(authUser?.id || profile?.userId || ""),
        publicId: profile?.publicId || "",
        name,
        bio,
        photo: profile?.photo || "",
        photos: Array.isArray(profile?.photos) ? profile.photos : [],
        age: ageNum ?? profile?.age ?? null,
        gender,
        height: heightNum,
        interests,
        relationshipGoal,
      });
      await refreshSession();

      setEditPhotoUri(null);
      setEditVisible(false);
    } catch (e: any) {
      Alert.alert("Could not save", e?.message || "Please try again.");
    } finally {
      setSavingEdit(false);
    }
  };

  const applyProfileSnapshot = useCallback(
    (snapshot: ProfileScreenSnapshot) => {
      if (coverBusyRef.current) return;
      setProfile(snapshot.profile);
      setGallery(snapshot.gallery);
      const raw = snapshot.coverPhoto || snapshot.profile?.coverPhoto || "";
      const next = displayCoverUrl(raw);
      const sticky =
        Date.now() < coverStickyUntilRef.current && !!coverPhotoRef.current;
      // Prefer any real cover; never wipe with empty while sticky/local exists
      if (next) {
        coverPhotoRef.current = next;
        setCoverPhoto(next);
      } else if (!sticky && !coverPhotoRef.current) {
        setCoverPhoto("");
      }
      setSubscriptionBadge(snapshot.subscriptionBadge);
      setSubscriptionExpiresAt(snapshot.subscriptionExpiresAt);

      // Warm disk cache so DP / cover / posts stay visible offline once loaded
      prefetchMedia(snapshot.profile?.photo);
      prefetchMedia(next || raw);
      for (const uri of snapshot.gallery || []) prefetchMedia(uri);
    },
    [],
  );

  // Fetch profile when tab focuses; use preloaded cache first.
  useFocusEffect(
    useCallback(() => {
      if (coverBusyRef.current) return;
      const cached = getCachedProfile();
      if (cached) {
        applyProfileSnapshot(cached);
      }

      void preloadProfile({ force: true }).then((snapshot) => {
        if (snapshot && !coverBusyRef.current) {
          applyProfileSnapshot(snapshot);
        }
      });

      // Direct /me cover sync — bypasses stale empty cache races
      void (async () => {
        try {
          const token = await getAuthToken();
          if (!token || coverBusyRef.current) return;
          const me: any = await apiRequest("/api/users/me", token);
          const raw = typeof me?.coverPhoto === "string" ? me.coverPhoto : "";
          if (!raw) return;
          const next = displayCoverUrl(raw);
          if (!next || coverBusyRef.current) return;
          coverPhotoRef.current = next;
          setCoverPhoto(next);
          setProfile((prev: any) =>
            prev ? { ...prev, coverPhoto: raw } : prev,
          );
          updateCachedProfile({
            coverPhoto: next,
            profile: {
              ...(getCachedProfile()?.profile || {}),
              coverPhoto: raw,
            } as any,
          });
          prefetchMedia(next);
        } catch {
          /* ignore — snapshot path still runs */
        }
      })();
    }, [sessionVersion, applyProfileSnapshot]),
  );

  const MENU_ITEMS = [
    {
      icon: "settings",
      label: "Settings",
      color: "#6750A4",
      route: "/settings",
    },
    {
      icon: "card",
      label: "Subscription",
      color: "#FF4B6E",
      route: "/subscription",
    },
    {
      icon: "shield-checkmark",
      label: "Photo verification",
      color: "#22C55E",
      route: "/photo-verify",
    },
    {
      icon: "gift",
      label: "Refer & Get 50 Tokens",
      color: "#7C3AED",
      route: "/refer",
    },
    {
      icon: "shield-checkmark",
      label: "Safety Center",
      color: "#4CAF50",
      route: "/safety-center",
    },
    {
      icon: "help-circle",
      label: "Help & Support",
      color: "#2196F3",
      route: "/help-support",
    },
  ];

  const coverHeight = 148 + Math.max(insets.top, 0);
  const coverUri =
    displayCoverUrl(coverPhoto) || displayCoverUrl(profile?.coverPhoto) || "";

  return (
    <View style={styles.root}>
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.scrollView}
        bounces={false}
        overScrollMode="never"
      >
        {/* ── Cover + Avatar (independent sections) ── */}
        <View style={styles.coverBlock}>
          <View style={[styles.coverWrap, { height: coverHeight }]}>
            {coverUri ? (
              <MediaImage
                uri={coverUri}
                style={{ width: "100%", height: coverHeight }}
                contentFit="cover"
                cachePolicy="memory-disk"
                onExhausted={() => {
                  // Drop broken cover so gradient placeholder shows
                  coverPhotoRef.current = "";
                  setCoverPhoto("");
                }}
              />
            ) : (
              <LinearGradient
                colors={["#370372", "#1C1B1F"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ width: "100%", height: coverHeight }}
              />
            )}
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={openCoverOptions}
              disabled={coverBusy}
            />
            <TouchableOpacity
              style={[styles.coverEditBtn, styles.profileEditBtn]}
              onPress={openEditProfile}
              activeOpacity={0.8}
            >
              <Ionicons name="pencil" size={11} color="#fff" />
              <Text style={styles.coverEditText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.coverEditBtn, styles.coverAddBtn]}
              onPress={openCoverOptions}
              activeOpacity={0.85}
              disabled={coverBusy}
            >
              {coverBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="camera" size={11} color="#fff" />
                  <Text style={styles.coverEditText}>
                    {coverUri ? "Edit cover" : "Add cover"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.avatarBlock}>
            <TouchableOpacity
              style={styles.avatarWrap}
              onPress={() => {
                if (profile?.photo) viewPhoto();
              }}
              activeOpacity={profile?.photo ? 0.85 : 1}
              disabled={uploadingPhoto || !profile?.photo}
            >
              <WhatsAppAvatar
                photo={profile?.photo}
                name={profile?.name}
                publicId={profile?.publicId}
                size={78}
                badge={liveSubscriptionBadge}
                badgeExpiresAt={subscriptionExpiresAt}
                photoVerified={
                  !!profile?.photoVerification?.photoVerified ||
                  profile?.photoVerification?.status === "approved"
                }
              />
              {uploadingPhoto ? (
                <View style={styles.uploadingOverlay}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              ) : null}
            </TouchableOpacity>
            <View style={styles.userNameRow}>
              <Text style={styles.userName}>
                {getDisplayName(profile?.name, profile?.publicId)}
                {profile?.age ? `, ${profile.age}` : ""}
              </Text>
              {profile?.photoVerification?.photoVerified ||
              profile?.photoVerification?.status === "approved" ? (
                <Ionicons
                  name="shield-checkmark"
                  size={18}
                  color="#22C55E"
                  style={{ marginLeft: 4 }}
                />
              ) : null}
            </View>
            <CopyablePublicId
              publicId={profile?.publicId}
              name={getDisplayName(profile?.name, profile?.publicId)}
            />
          </View>
        </View>

        <ProfileInstagramSection
          bio={profile?.bio}
          relationshipGoal={profile?.relationshipGoal}
          interests={profile?.interests}
          gallery={gallery}
          maxSlots={MAX_PROFILE_GALLERY}
          manageGallery
          gallerySlotBusy={gallerySlotBusy}
          onPhotoPress={handleGallerySlotPress}
          onPhotoLongPress={handleGallerySlotLongPress}
          onEditPress={openEditProfile}
          onInfoPress={() => setInfoVisible(true)}
        />

        {/* ── Settings Menu ── */}
        <Text style={styles.waSectionHint}>More</Text>
        <View style={[styles.waListGroup, { marginBottom: 40 }]}>
          {MENU_ITEMS.map((item, index) => (
            <View key={item.label}>
              <TouchableOpacity
                style={styles.waListRow}
                activeOpacity={0.7}
                onPress={() => {
                  if (item.label === "Refer & Get 50 Tokens") {
                    router.push("/refer" as any);
                  } else if (item.label === "Settings") {
                    router.push((item as any).route);
                  } else if (item.label === "Photo verification") {
                    router.push("/photo-verify" as any);
                  } else if (item.label === "Safety Center") {
                    router.push("/safety-center" as any);
                  } else if (item.label === "Help & Support") {
                    router.push("/help-support" as any);
                  } else if (item.label === "Subscription") {
                    router.push("/subscription" as any);
                  } else if ((item as any).route) {
                    router.push((item as any).route);
                  } else {
                    Alert.alert(
                      item.label,
                      `Welcome to the ${item.label} section of Luvstor.`,
                    );
                  }
                }}
              >
                <View
                  style={[styles.waIconCircle, { backgroundColor: item.color }]}
                >
                  <Ionicons name={item.icon as any} size={20} color="#fff" />
                </View>
                <View style={styles.waRowContent}>
                  <Text style={[styles.waRowLabel, { flex: 0 }]}>
                    {item.label}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={WA.secondary}
                />
              </TouchableOpacity>
              {index < MENU_ITEMS.length - 1 && (
                <View style={styles.waDivider} />
              )}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── Edit Profile (Instagram-style) ── */}
      <Modal
        animationType="slide"
        visible={editVisible}
        onRequestClose={() => {
          if (savingEdit) return;
          setEditPhotoUri(null);
          setEditVisible(false);
        }}
        presentationStyle="fullScreen"
        statusBarTranslucent
      >
        <View style={styles.igEditRoot}>
          <StatusBar barStyle="dark-content" backgroundColor={WA.bg} />
          <View style={{ paddingTop: Math.max(insets.top, 0) }}>
            <View style={styles.igEditHeader}>
              <TouchableOpacity
                onPress={() => {
                  if (savingEdit) return;
                  setEditPhotoUri(null);
                  setEditVisible(false);
                }}
                hitSlop={8}
                disabled={savingEdit}
                style={styles.igEditHeaderBtn}
              >
                <Text style={styles.igEditCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.igEditTitle}>Edit profile</Text>
              <TouchableOpacity
                onPress={saveEditProfile}
                hitSlop={8}
                disabled={savingEdit}
                style={styles.igEditHeaderBtn}
              >
                {savingEdit ? (
                  <ActivityIndicator size="small" color={WA.teal} />
                ) : (
                  <Text style={styles.igEditDone}>Done</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.igEditScroll,
                { paddingBottom: 40 + Math.max(insets.bottom, 0) },
              ]}
              showsVerticalScrollIndicator={false}
            >
              {/* Avatar — photo edit only here (pencil badge) */}
              <View style={styles.igEditAvatarBlock}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => !savingEdit && handlePhotoPress()}
                  disabled={savingEdit || uploadingPhoto}
                  style={styles.igEditAvatarTap}
                >
                  <WhatsAppAvatar
                    key={editPhotoUri || profile?.photo || "no-photo"}
                    photo={editPhotoUri || profile?.photo || null}
                    name={editName || profile?.name || "You"}
                    publicId={profile?.publicId}
                    size={96}
                  />
                  {uploadingPhoto ? (
                    <View style={styles.igEditAvatarBusy}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  ) : (
                    <View style={styles.igEditAvatarPencil}>
                      <Ionicons name="pencil" size={14} color="#FFFFFF" />
                    </View>
                  )}
                </TouchableOpacity>
                <CopyablePublicId
                  publicId={profile?.publicId}
                  name={
                    editName || getDisplayName(profile?.name, profile?.publicId)
                  }
                  style={styles.igEditIdRow}
                />
              </View>

              {/* Fields */}
              <View style={styles.igEditFields}>
                <View style={styles.igEditRow}>
                  <Text style={styles.igEditLabel}>Name</Text>
                  <TextInput
                    style={styles.igEditInput}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Name"
                    placeholderTextColor={WA.secondary}
                    maxLength={50}
                    autoCapitalize="words"
                    editable={!savingEdit}
                  />
                </View>

                <View style={styles.igEditRow}>
                  <Text style={styles.igEditLabel}>Age</Text>
                  <TextInput
                    style={styles.igEditInput}
                    value={editAge}
                    onChangeText={(t) =>
                      setEditAge(t.replace(/[^0-9]/g, "").slice(0, 3))
                    }
                    placeholder="18+"
                    placeholderTextColor={WA.secondary}
                    keyboardType="number-pad"
                    maxLength={3}
                    editable={!savingEdit}
                  />
                </View>

                <View style={styles.igEditRow}>
                  <Text style={styles.igEditLabel}>Height</Text>
                  <TextInput
                    style={styles.igEditInput}
                    value={editHeight}
                    onChangeText={(t) =>
                      setEditHeight(t.replace(/[^0-9]/g, "").slice(0, 3))
                    }
                    placeholder="cm"
                    placeholderTextColor={WA.secondary}
                    keyboardType="number-pad"
                    maxLength={3}
                    editable={!savingEdit}
                  />
                </View>

                <View style={[styles.igEditRow, styles.igEditRowBio]}>
                  <Text style={[styles.igEditLabel, { paddingTop: 4 }]}>
                    Bio
                  </Text>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[styles.igEditInput, styles.igEditBioInput]}
                      value={editBio}
                      onChangeText={setEditBio}
                      placeholder="Bio"
                      placeholderTextColor={WA.secondary}
                      maxLength={300}
                      multiline
                      textAlignVertical="top"
                      editable={!savingEdit}
                    />
                    <Text style={styles.igEditCharCount}>
                      {editBio.length}/300
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={styles.igEditSection}>Gender</Text>
              <View style={styles.igEditChipWrap}>
                {GENDER_EDIT_OPTIONS.map((g) => {
                  const selected = editGender === g;
                  return (
                    <TouchableOpacity
                      key={g}
                      style={[
                        styles.igEditChip,
                        selected && styles.igEditChipOn,
                      ]}
                      onPress={() => {
                        if (savingEdit) return;
                        setEditShowMe((prev) =>
                          followGenderChange(editGender, prev, g),
                        );
                        setEditGender(g);
                      }}
                      activeOpacity={0.8}
                      disabled={savingEdit}
                    >
                      <Text
                        style={[
                          styles.igEditChipText,
                          selected && styles.igEditChipTextOn,
                        ]}
                      >
                        {g}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.igEditSection}>Show me</Text>
              <View style={styles.igEditChipWrap}>
                {SHOW_ME_OPTIONS.map((option) => {
                  const selected = editShowMe === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.igEditChip,
                        selected && styles.igEditChipOn,
                      ]}
                      onPress={() => !savingEdit && setEditShowMe(option.value)}
                      activeOpacity={0.8}
                      disabled={savingEdit}
                    >
                      <Text
                        style={[
                          styles.igEditChipText,
                          selected && styles.igEditChipTextOn,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.igEditSection}>Looking for</Text>
              <View style={styles.igEditChipWrap}>
                {GOAL_OPTIONS.map((label) => {
                  const selected = editGoal === label;
                  return (
                    <TouchableOpacity
                      key={label}
                      style={[
                        styles.igEditChip,
                        selected && styles.igEditChipOn,
                      ]}
                      onPress={() => !savingEdit && setEditGoal(label)}
                      activeOpacity={0.8}
                      disabled={savingEdit}
                    >
                      <Text
                        style={[
                          styles.igEditChipText,
                          selected && styles.igEditChipTextOn,
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.igEditSection}>Discovery distance</Text>
              <View style={styles.igEditChipWrap}>
                {DISTANCE_EDIT_OPTIONS.map((km) => {
                  const selected = editDistance === km;
                  return (
                    <TouchableOpacity
                      key={km}
                      style={[
                        styles.igEditChip,
                        selected && styles.igEditChipOn,
                      ]}
                      onPress={() => !savingEdit && setEditDistance(km)}
                      activeOpacity={0.8}
                      disabled={savingEdit}
                    >
                      <Text
                        style={[
                          styles.igEditChipText,
                          selected && styles.igEditChipTextOn,
                        ]}
                      >
                        {km} km
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.igEditSection}>Interests</Text>
              <Text style={styles.igEditHint}>Select at least 1</Text>
              <View style={styles.igEditChipWrap}>
                {INTEREST_OPTIONS.map((label) => {
                  const selected = editInterests.includes(label);
                  return (
                    <TouchableOpacity
                      key={label}
                      style={[
                        styles.igEditChip,
                        selected && styles.igEditChipOn,
                      ]}
                      onPress={() => !savingEdit && toggleEditInterest(label)}
                      activeOpacity={0.8}
                      disabled={savingEdit}
                    >
                      <Text
                        style={[
                          styles.igEditChipText,
                          selected && styles.igEditChipTextOn,
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── Safety Center Modal (Luvstor Shield & Safety Hub) ── */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={safetyVisible}
        onRequestClose={() => setSafetyVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={styles.shieldIconBox}>
                  <Ionicons
                    name="shield-checkmark"
                    size={24}
                    color={C.accent}
                  />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Shield & Safety Hub</Text>
                  <Text style={styles.modalSubtitle}>
                    Your safety is our top priority
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setSafetyVisible(false)}
                style={styles.modalCloseBtn}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={20} color={C.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            {/* Segmented Button (M3 Navigation Tabs) */}
            <View style={styles.tabContainer}>
              <TouchableOpacity
                style={[
                  styles.tabButton,
                  activeSafetyTab === "tips" && styles.tabButtonActive,
                ]}
                onPress={() => setActiveSafetyTab("tips")}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="book-outline"
                  size={16}
                  color={
                    activeSafetyTab === "tips" ? "#fff" : C.onSurfaceVariant
                  }
                />
                <Text
                  style={[
                    styles.tabButtonText,
                    activeSafetyTab === "tips" && styles.tabButtonTextActive,
                  ]}
                >
                  Safety Rules
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.tabButton,
                  activeSafetyTab === "checklist" && styles.tabButtonActive,
                ]}
                onPress={() => setActiveSafetyTab("checklist")}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="checkbox-outline"
                  size={16}
                  color={
                    activeSafetyTab === "checklist"
                      ? "#fff"
                      : C.onSurfaceVariant
                  }
                />
                <Text
                  style={[
                    styles.tabButtonText,
                    activeSafetyTab === "checklist" &&
                      styles.tabButtonTextActive,
                  ]}
                >
                  Date Checklist
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalScroll}
              showsVerticalScrollIndicator={false}
            >
              {activeSafetyTab === "tips" ? (
                <>
                  {/* SOS Emergency Helpline Card */}
                  <View style={styles.sosCard}>
                    <View style={styles.sosLeft}>
                      <Ionicons name="alert-circle" size={24} color="#D32F2F" />
                      <View style={styles.sosTextContainer}>
                        <Text style={styles.sosTitle}>
                          Need Immediate Help?
                        </Text>
                        <Text style={styles.sosText}>
                          Connect with Luvstor Response Team
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.sosButton}
                      onPress={() => {
                        Alert.alert(
                          "Emergency Contact",
                          "Directing to safety support services. If you are in immediate danger, please contact your local police department (911/112) immediately.",
                          [
                            { text: "Dismiss" },
                            {
                              text: "Call Helpline",
                              onPress: () =>
                                Alert.alert(
                                  "Dialing support...",
                                  "Connecting you with safety specialists...",
                                ),
                            },
                          ],
                        );
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.sosButtonText}>SOS</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Safety Rule Items */}
                  <Text style={styles.sectionHeading}>Dating Safety Rules</Text>

                  {[
                    {
                      icon: "chatbubble-ellipses-outline",
                      title: "Keep Chats on Luvstor",
                      desc: "Do not share phone numbers, social handles, or personal addresses early on. Keep your chats protected inside our secure system.",
                      color: C.accent,
                    },
                    {
                      icon: "location-outline",
                      title: "Private Boundaries",
                      desc: "Location is completely removed from your profiles. Never share your exact home or work location with new matches.",
                      color: "#FF9800",
                    },
                    {
                      icon: "cafe-outline",
                      title: "Meet in Public & Tell a Friend",
                      desc: "For first dates, always choose busy public locations (like coffee shops). Always notify a friend of your location and plans.",
                      color: "#4CAF50",
                    },
                    {
                      icon: "cash-outline",
                      title: "Zero Financial Requests",
                      desc: "Never send money, wire transfers, or financial help to matches. Report anyone asking you for monetary support immediately.",
                      color: "#2196F3",
                    },
                    {
                      icon: "shield-outline",
                      title: "Block and Report Anytime",
                      desc: "If a match behaves suspiciously or makes you uncomfortable, block them instantly. Our support team reviews reports 24/7.",
                      color: "#f44336",
                    },
                  ].map((rule, i) => (
                    <View key={i} style={styles.ruleCard}>
                      <View
                        style={[
                          styles.ruleIconBox,
                          { backgroundColor: rule.color + "12" },
                        ]}
                      >
                        <Ionicons
                          name={rule.icon as any}
                          size={22}
                          color={rule.color}
                        />
                      </View>
                      <View style={styles.ruleContent}>
                        <Text style={styles.ruleTitle}>{rule.title}</Text>
                        <Text style={styles.ruleDesc}>{rule.desc}</Text>
                      </View>
                    </View>
                  ))}
                </>
              ) : (
                <>
                  {/* Interactive Checklist Intro */}
                  <View style={styles.checklistIntroCard}>
                    <Ionicons name="sparkles" size={20} color="#FF9800" />
                    <Text style={styles.checklistIntroText}>
                      Tap each checkmark to prepare safely for your upcoming
                      physical date!
                    </Text>
                  </View>

                  <Text style={styles.sectionHeading}>
                    First Date Preparations
                  </Text>

                  {CHECKLIST_OPTIONS.map(({ key, text }) => {
                    const checked = checklistItems.includes(key);
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[
                          styles.checklistCard,
                          checked && styles.checklistCardActive,
                        ]}
                        onPress={() => toggleChecklistItem(key)}
                        activeOpacity={0.8}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            checked && styles.checkboxActive,
                          ]}
                        >
                          {checked && (
                            <Ionicons name="checkmark" size={14} color="#fff" />
                          )}
                        </View>
                        <Text
                          style={[
                            styles.checklistText,
                            checked && styles.checklistTextActive,
                          ]}
                        >
                          {text}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
            </ScrollView>

            {/* Bottom Button */}
            <TouchableOpacity
              style={styles.modalDoneBtn}
              onPress={() => setSafetyVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.modalDoneBtnText}>I understand</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* ── Help & Support Modal (Luvstor Help & Support Hub) ── */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={supportVisible}
        onRequestClose={() => setSupportVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderLeft}>
                  <View
                    style={[
                      styles.shieldIconBox,
                      { backgroundColor: C.accentLight },
                    ]}
                  >
                    <Ionicons name="help-circle" size={24} color={C.accent} />
                  </View>
                  <View>
                    <Text style={styles.modalTitle}>Help & Support Hub</Text>
                    <Text style={styles.modalSubtitle}>
                      How can we assist you today?
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setSupportVisible(false)}
                  style={styles.modalCloseBtn}
                  activeOpacity={0.8}
                >
                  <Ionicons name="close" size={20} color={C.onSurfaceVariant} />
                </TouchableOpacity>
              </View>

              {/* Segmented Button (Tabs switcher) */}
              <View style={styles.tabContainer}>
                <TouchableOpacity
                  style={[
                    styles.tabButton,
                    supportTab === "faq" && { backgroundColor: C.accent },
                  ]}
                  onPress={() => setSupportTab("faq")}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="help-buoy-outline"
                    size={16}
                    color={supportTab === "faq" ? "#fff" : C.onSurfaceVariant}
                  />
                  <Text
                    style={[
                      styles.tabButtonText,
                      supportTab === "faq" && styles.tabButtonTextActive,
                    ]}
                  >
                    FAQ
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.tabButton,
                    supportTab === "ticket" && { backgroundColor: C.accent },
                  ]}
                  onPress={() => setSupportTab("ticket")}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="create-outline"
                    size={16}
                    color={
                      supportTab === "ticket" ? "#fff" : C.onSurfaceVariant
                    }
                  />
                  <Text
                    style={[
                      styles.tabButtonText,
                      supportTab === "ticket" && styles.tabButtonTextActive,
                    ]}
                  >
                    Raise Issue
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                ref={supportScrollRef}
                contentContainerStyle={styles.modalScroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {supportTab === "faq" && (
                  <>
                    <Text style={styles.sectionHeading}>
                      Frequently Asked Questions
                    </Text>
                    {[
                      {
                        q: "How do I delete my account permanently?",
                        a: 'Go to Profile > Settings > Account and tap "Delete Account". All your chats, matches, and images will be permanently wiped from our database.',
                      },
                      {
                        q: "Is Luvstor completely free to use?",
                        a: "Yes! Texting, matching, and audio chat inside Luvstor is 100% free. We offer premium Gold subscriptions for elevated discovery modes.",
                      },
                      {
                        q: "How do I block or report a user?",
                        a: 'Open the user\'s profile or chat bubble, tap the shield icon in the top right, and select "Block & Report". Our team reviews reports 24/7.',
                      },
                      {
                        q: "Why am I not getting any matches?",
                        a: 'Make sure your "About Me" description is engaging and you have selected at least 3 interests (with emojis) to help matches vibe with you!',
                      },
                    ].map((faq, i) => {
                      const isOpen = expandedFaq === i;
                      return (
                        <TouchableOpacity
                          key={i}
                          style={styles.faqCard}
                          onPress={() => setExpandedFaq(isOpen ? null : i)}
                          activeOpacity={0.9}
                        >
                          <View style={styles.faqHeader}>
                            <Text style={styles.faqQuestion}>{faq.q}</Text>
                            <Ionicons
                              name={isOpen ? "chevron-up" : "chevron-down"}
                              size={18}
                              color="#49454F"
                            />
                          </View>
                          {isOpen && (
                            <View style={styles.faqAnswerContainer}>
                              <Text style={styles.faqAnswer}>{faq.a}</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}

                {supportTab === "ticket" && (
                  <>
                    <Text style={styles.sectionHeading}>
                      Raise a Problem / Issue
                    </Text>

                    {/* Category select pills */}
                    <Text style={styles.inputLabel}>Issue Category</Text>
                    <View style={styles.categoryPillRow}>
                      {["Account", "Billing", "Safety", "Bug Report"].map(
                        (cat) => {
                          const isSel = ticketCategory === cat;
                          return (
                            <TouchableOpacity
                              key={cat}
                              style={[
                                styles.categoryPill,
                                isSel && styles.categoryPillActiveSupport,
                              ]}
                              onPress={() => setTicketCategory(cat)}
                              activeOpacity={0.8}
                            >
                              <Text
                                style={[
                                  styles.categoryPillText,
                                  isSel && styles.categoryPillTextActive,
                                ]}
                              >
                                {cat}
                              </Text>
                            </TouchableOpacity>
                          );
                        },
                      )}
                    </View>

                    {/* Outlined Subject input */}
                    <Text style={styles.inputLabel}>Subject</Text>
                    <TextInput
                      style={styles.supportInput}
                      placeholder="Brief summary of the issue..."
                      placeholderTextColor="#79747E"
                      value={ticketSubject}
                      onChangeText={setTicketSubject}
                      onFocus={() => {
                        setTimeout(() => {
                          supportScrollRef.current?.scrollTo({
                            y: 120,
                            animated: true,
                          });
                        }, 100);
                      }}
                    />

                    {/* Outlined Description Input */}
                    <Text style={styles.inputLabel}>Describe your problem</Text>
                    <TextInput
                      style={[styles.supportInput, styles.supportInputLarge]}
                      placeholder="Please explain the details of the problem..."
                      placeholderTextColor="#79747E"
                      multiline={true}
                      numberOfLines={4}
                      value={ticketDescription}
                      onChangeText={setTicketDescription}
                      onFocus={() => {
                        setTimeout(() => {
                          supportScrollRef.current?.scrollToEnd({
                            animated: true,
                          });
                        }, 100);
                      }}
                    />

                    {/* Spacing cushion to allow scrolling past keyboard */}
                    <View
                      style={{ height: Platform.OS === "ios" ? 140 : 100 }}
                    />

                    {/* Submit Button */}
                    <TouchableOpacity
                      style={[
                        styles.submitTicketBtn,
                        (!ticketSubject.trim() || !ticketDescription.trim()) &&
                          styles.submitTicketBtnDisabled,
                      ]}
                      onPress={() => {
                        if (!ticketSubject.trim() || !ticketDescription.trim())
                          return;
                        Alert.alert(
                          "Ticket Submitted!",
                          `Thank you! Your ticket #${Math.floor(100000 + Math.random() * 900000)} has been raised under category "${ticketCategory}".\n\nOur support specialists will email you back within 2 hours.`,
                          [
                            {
                              text: "OK",
                              onPress: () => {
                                setTicketSubject("");
                                setTicketDescription("");
                                setSupportVisible(false);
                              },
                            },
                          ],
                        );
                      }}
                      activeOpacity={0.8}
                      disabled={
                        !ticketSubject.trim() || !ticketDescription.trim()
                      }
                    >
                      <Text style={styles.submitTicketText}>
                        Submit Problem
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ProfilePhotoViewer
        visible={photoViewerVisible}
        uris={photoViewerUris}
        initialIndex={photoViewerIndex}
        title={photoViewerTitle}
        onClose={() => setPhotoViewerVisible(false)}
      />

      <ProfileInfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        onEditPress={openEditProfile}
        info={{
          name: profile?.name,
          publicId: profile?.publicId,
          age: profile?.age,
          photo: profile?.photo,
          gender: profile?.gender,
          height: profile?.height,
          relationshipGoal: profile?.relationshipGoal,
          showMeLabel: showMeLabel(profile?.gender, profile?.showMe),
          distanceLabel: profile?.distance ? `${profile.distance} km` : "10 km",
          interests: profile?.interests,
          subscriptionBadge: liveSubscriptionBadge,
          subscriptionExpiresAt: subscriptionExpiresAt,
          photoVerified:
            !!profile?.photoVerification?.photoVerified ||
            profile?.photoVerification?.status === "approved",
        }}
      />
    </SafeAreaView>

      {/* Sheets outside SafeArea so they sit flush above the tab bar */}
      {photoOptionsVisible ? (
        <View style={styles.photoSheetHost} pointerEvents="box-none">
          <Pressable
            style={[styles.photoModalDim, { bottom: tabClearance }]}
            onPress={() => setPhotoOptionsVisible(false)}
          />
          <View
            style={[
              styles.photoOptionsContainer,
              { marginBottom: tabClearance },
            ]}
          >
            <Text style={styles.photoOptionsTitle}>Profile Photo</Text>

            {(editPhotoUri || profile?.photo) && (
              <TouchableOpacity
                style={styles.photoOption}
                onPress={viewPhoto}
                activeOpacity={0.7}
              >
                <Ionicons name="eye-outline" size={22} color={C.primary} />
                <Text style={styles.photoOptionText}>View Photo</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.photoOption}
              onPress={takePhoto}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-outline" size={22} color={C.primary} />
              <Text style={styles.photoOptionText}>Take Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.photoOption}
              onPress={chooseFromGallery}
              activeOpacity={0.7}
            >
              <Ionicons name="images-outline" size={22} color={C.primary} />
              <Text style={styles.photoOptionText}>Choose from Gallery</Text>
            </TouchableOpacity>

            {(editPhotoUri || profile?.photo) && (
              <TouchableOpacity
                style={[styles.photoOption, styles.photoOptionDanger]}
                onPress={removePhoto}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={22} color="#f44336" />
                <Text
                  style={[styles.photoOptionText, styles.photoOptionDangerText]}
                >
                  Remove Photo
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.photoOptionCancel}
              onPress={() => setPhotoOptionsVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.photoOptionCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {coverOptionsVisible ? (
        <View style={styles.photoSheetHost} pointerEvents="box-none">
          <Pressable
            style={[styles.photoModalDim, { bottom: tabClearance }]}
            onPress={() => setCoverOptionsVisible(false)}
          />
          <View
            style={[
              styles.photoOptionsContainer,
              { marginBottom: tabClearance },
            ]}
          >
            <Text style={styles.photoOptionsTitle}>Cover Photo</Text>

            {!!coverPhoto && (
              <TouchableOpacity
                style={styles.photoOption}
                activeOpacity={0.7}
                onPress={viewCoverPhoto}
              >
                <Ionicons name="eye-outline" size={22} color={C.primary} />
                <Text style={styles.photoOptionText}>View Cover</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.photoOption}
              activeOpacity={0.7}
              onPress={() => pickCoverImage(true)}
            >
              <Ionicons name="camera-outline" size={22} color={C.primary} />
              <Text style={styles.photoOptionText}>
                {coverPhoto ? "Replace with Camera" : "Take Photo"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.photoOption}
              activeOpacity={0.7}
              onPress={() => pickCoverImage(false)}
            >
              <Ionicons name="images-outline" size={22} color={C.primary} />
              <Text style={styles.photoOptionText}>
                {coverPhoto ? "Replace from Gallery" : "Choose from Gallery"}
              </Text>
            </TouchableOpacity>

            {!!coverPhoto && (
              <TouchableOpacity
                style={[styles.photoOption, styles.photoOptionDanger]}
                activeOpacity={0.7}
                onPress={removeCoverPhoto}
              >
                <Ionicons name="trash-outline" size={22} color="#f44336" />
                <Text
                  style={[styles.photoOptionText, styles.photoOptionDangerText]}
                >
                  Remove Cover
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.photoOptionCancel}
              activeOpacity={0.7}
              onPress={() => setCoverOptionsVisible(false)}
            >
              <Text style={styles.photoOptionCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {galleryOptionsVisible ? (
        <View style={styles.photoSheetHost} pointerEvents="box-none">
          <Pressable
            style={[styles.photoModalDim, { bottom: tabClearance }]}
            onPress={() => setGalleryOptionsVisible(false)}
          />
          <View
            style={[
              styles.photoOptionsContainer,
              { marginBottom: tabClearance },
            ]}
          >
            <Text style={styles.photoOptionsTitle}>
              {`Post ${gallerySlot + 1}`}
            </Text>

            {!!gallery[gallerySlot] && (
              <TouchableOpacity
                style={styles.photoOption}
                activeOpacity={0.7}
                onPress={() => {
                  setGalleryOptionsVisible(false);
                  openPhotoViewer(gallerySlot);
                }}
              >
                <Ionicons name="eye-outline" size={22} color={C.primary} />
                <Text style={styles.photoOptionText}>View Photo</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.photoOption}
              activeOpacity={0.7}
              onPress={() => pickGalleryImage(gallerySlot, true)}
            >
              <Ionicons name="camera-outline" size={22} color={C.primary} />
              <Text style={styles.photoOptionText}>
                {gallery[gallerySlot] ? "Replace with Camera" : "Take Photo"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.photoOption}
              activeOpacity={0.7}
              onPress={() => pickGalleryImage(gallerySlot, false)}
            >
              <Ionicons name="images-outline" size={22} color={C.primary} />
              <Text style={styles.photoOptionText}>
                {gallery[gallerySlot]
                  ? "Replace from Gallery"
                  : "Choose from Gallery"}
              </Text>
            </TouchableOpacity>

            {!!gallery[gallerySlot] && (
              <TouchableOpacity
                style={[styles.photoOption, styles.photoOptionDanger]}
                activeOpacity={0.7}
                onPress={() => removeGalleryPhoto(gallerySlot)}
              >
                <Ionicons name="trash-outline" size={22} color="#f44336" />
                <Text
                  style={[styles.photoOptionText, styles.photoOptionDangerText]}
                >
                  Remove Photo
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.photoOptionCancel}
              activeOpacity={0.7}
              onPress={() => setGalleryOptionsVisible(false)}
            >
              <Text style={styles.photoOptionCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WA.bg,
  },
  container: {
    flex: 1,
    backgroundColor: WA.bg,
  },
  scrollView: {
    flex: 1,
    backgroundColor: WA.bg,
  },
  scrollContent: {
    paddingBottom: 120,
    backgroundColor: WA.bg,
    flexGrow: 1,
  },
  coverBlock: {
    backgroundColor: WA.white,
    paddingBottom: 16,
  },
  coverWrap: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: WA.border,
    position: "relative",
  },
  coverImage: {
    width: "100%",
  },
  coverEditBtn: {
    position: "absolute",
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 100,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  coverEditText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
  profileEditBtn: {
    left: 12,
    zIndex: 6,
  },
  coverAddBtn: {
    right: 12,
  },
  avatarBlock: {
    alignItems: "center",
    marginTop: -40,
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
  userNameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: "90%",
  },
  userName: {
    fontSize: 20,
    fontWeight: "600",
    color: WA.text,
  },
  subBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#DCF8C6",
  },
  subBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#075E54",
  },
  userIdText: {
    fontSize: 13,
    color: WA.secondary,
    marginTop: 3,
    letterSpacing: 0.5,
  },
  cameraIconBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: WA.teal,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: WA.white,
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 39,
    justifyContent: "center",
    alignItems: "center",
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
    flex: 1,
    fontSize: 17,
    color: WA.text,
    fontWeight: "400",
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
    flexWrap: "nowrap",
    gap: 8,
    padding: 16,
  },
  photoSlot: {
    flex: 1,
    aspectRatio: 1,
    minHeight: 72,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: WA.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  photoSlotLocked: {
    opacity: 0.55,
  },
  photoSlotImage: {
    width: "100%",
    height: "100%",
  },
  photoSlotEmpty: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: WA.bg,
  },
  addIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: WA.teal,
    justifyContent: "center",
    alignItems: "center",
  },
  addIconCircleLocked: {
    backgroundColor: "#D1D7DB",
  },
  photoSlotBusy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  coverTag: {
    position: "absolute",
    left: 6,
    top: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 100,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  coverTagText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
  },
  interestEmoji: {
    fontSize: 14,
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
    gap: 6,
    backgroundColor: WA.bg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  interestChipText: {
    fontSize: 14,
    color: WA.text,
    fontWeight: "500",
  },
  editOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  editDismiss: {
    flex: 1,
  },
  editSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  editHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  editTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: C.onSurface,
  },
  editHint: {
    fontSize: 12,
    color: C.onSurfaceVariant,
    marginBottom: 16,
  },
  editLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: C.onSurface,
    marginBottom: 6,
  },
  editInput: {
    borderWidth: 1,
    borderColor: WA.border,
    backgroundColor: WA.bg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.onSurface,
    marginBottom: 14,
  },
  editBioInput: {
    minHeight: 110,
    paddingTop: 12,
  },
  editCharCount: {
    alignSelf: "flex-end",
    fontSize: 11,
    color: "#999",
    marginTop: -8,
    marginBottom: 16,
  },
  editActions: {
    flexDirection: "row",
    gap: 10,
  },
  editCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WA.bg,
  },
  igEditRoot: {
    flex: 1,
    backgroundColor: "#F5F5F7",
  },
  igEditHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 12,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E5E5",
    backgroundColor: "#F5F5F7",
  },
  igEditHeaderBtn: {
    minWidth: 64,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  igEditCancel: {
    fontSize: 16,
    color: WA.secondary,
    fontWeight: "500",
  },
  igEditTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: WA.text,
  },
  igEditDone: {
    fontSize: 16,
    fontWeight: "700",
    color: WA.teal,
    textAlign: "right",
  },
  igEditScroll: {
    paddingBottom: 40,
  },
  igEditAvatarBlock: {
    alignItems: "center",
    paddingTop: 28,
    paddingBottom: 20,
  },
  igEditAvatarTap: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  igEditAvatarBusy: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 48,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  igEditAvatarPencil: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#262626",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#F5F5F7",
  },
  igEditIdRow: {
    marginTop: 12,
  },
  igEditFields: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: WA.border,
    paddingHorizontal: 16,
    backgroundColor: WA.white,
  },
  igEditRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: WA.border,
    minHeight: 48,
    paddingVertical: 4,
  },
  igEditRowBio: {
    alignItems: "flex-start",
    paddingTop: 12,
    paddingBottom: 8,
  },
  igEditLabel: {
    width: 88,
    fontSize: 15,
    color: WA.text,
    fontWeight: "500",
  },
  igEditInput: {
    flex: 1,
    fontSize: 15,
    color: WA.text,
    paddingVertical: 12,
    paddingRight: 4,
  },
  igEditBioInput: {
    minHeight: 72,
    paddingTop: 0,
    lineHeight: 20,
  },
  igEditCharCount: {
    alignSelf: "flex-end",
    fontSize: 12,
    color: WA.secondary,
    marginTop: 4,
  },
  igEditSection: {
    fontSize: 13,
    fontWeight: "700",
    color: WA.text,
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 8,
  },
  igEditHint: {
    fontSize: 12,
    color: WA.secondary,
    paddingHorizontal: 16,
    marginTop: -4,
    marginBottom: 6,
  },
  igEditChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  igEditChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: WA.white,
    borderWidth: 0,
  },
  igEditChipOn: {
    backgroundColor: WA.primaryContainer,
    borderWidth: 0,
  },
  igEditChipText: {
    fontSize: 13,
    color: WA.text,
    fontWeight: "500",
  },
  igEditChipTextOn: {
    color: WA.teal,
    fontWeight: "700",
  },
  waEditRoot: {
    flex: 1,
    backgroundColor: WA.bg,
  },
  waEditHeaderWrap: {
    zIndex: 2,
    overflow: "hidden",
    backgroundColor: Platform.OS === "ios" ? "transparent" : WA.bg,
    ...Platform.select({
      ios: {
        shadowColor: "#1C1B1F",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: {
        elevation: 0,
      },
      default: {},
    }),
  },
  waEditHeaderFrost: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: WA.bg,
  },
  waEditHeaderFrostIos: {
    backgroundColor: "rgba(253, 248, 255, 0.72)",
  },
  waEditHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 10,
    minHeight: 44,
    backgroundColor: "transparent",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(231, 224, 236, 0.85)",
  },
  waEditHeaderBtn: {
    minWidth: 64,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: "center",
  },
  waEditCancel: {
    fontSize: 16,
    color: WA.secondary,
    fontWeight: "500",
  },
  waEditTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: WA.text,
  },
  waEditSave: {
    fontSize: 16,
    fontWeight: "700",
    color: WA.teal,
  },
  waEditScroll: {
    paddingBottom: 40,
  },
  waEditSectionHint: {
    fontSize: 13,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    lineHeight: 18,
  },
  waEditGroup: {
    backgroundColor: WA.white,
  },
  waEditRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 4,
    minHeight: 52,
    gap: 12,
  },
  waEditRowLabel: {
    width: 64,
    fontSize: 15,
    color: WA.text,
    fontWeight: "500",
  },
  waEditRowInput: {
    flex: 1,
    fontSize: 16,
    color: WA.text,
    paddingVertical: 12,
  },
  waEditDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 16,
  },
  waEditAboutInput: {
    minHeight: 100,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    fontSize: 16,
    color: WA.text,
    lineHeight: 22,
  },
  waEditCharCount: {
    alignSelf: "flex-end",
    fontSize: 12,
    color: WA.secondary,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  waEditChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  waEditChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: WA.bg,
    borderWidth: 1,
    borderColor: WA.border,
  },
  waEditChipSelected: {
    backgroundColor: WA.primaryContainer,
    borderColor: WA.teal,
  },
  waEditChipEmoji: {
    fontSize: 13,
  },
  waEditChipText: {
    fontSize: 13,
    color: WA.text,
    fontWeight: "500",
  },
  waEditChipTextSelected: {
    color: WA.teal,
    fontWeight: "700",
  },
  editCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.onSurfaceVariant,
  },
  editSaveBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WA.teal,
  },
  editSaveBtnDisabled: {
    opacity: 0.7,
  },
  editSaveText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  // ── Safety Center Modal Styles ──────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#FEF7FF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "90%",
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E7E0EC",
  },
  modalHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  shieldIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#EADDFF",
    justifyContent: "center",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1C1B1F",
  },
  modalSubtitle: {
    fontSize: 13,
    color: "#49454F",
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E7E0EC",
    justifyContent: "center",
    alignItems: "center",
  },
  modalScroll: {
    paddingVertical: 20,
  },

  // SOS helpline card
  sosCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFF0F0",
    borderWidth: 1,
    borderColor: "#FFCDCD",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  sosLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  sosTextContainer: {
    flex: 1,
  },
  sosTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#B71C1C",
  },
  sosText: {
    fontSize: 12,
    color: "#D32F2F",
    marginTop: 2,
  },
  sosButton: {
    backgroundColor: "#D32F2F",
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#D32F2F",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  sosButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },

  sectionHeading: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1C1B1F",
    marginBottom: 16,
  },
  ruleCard: {
    flexDirection: "row",
    gap: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7E0EC",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  ruleIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  ruleContent: {
    flex: 1,
  },
  ruleTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1C1B1F",
  },
  ruleDesc: {
    fontSize: 13,
    color: "#49454F",
    lineHeight: 18,
    marginTop: 4,
  },

  modalDoneBtn: {
    backgroundColor: "#6750A4",
    borderRadius: 100,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  modalDoneBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  // Premium Navigation & Interactive Checklist Styles
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#EAE2F8",
    borderRadius: 100,
    padding: 4,
    marginTop: 16,
    marginHorizontal: 4,
  },
  tabButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 100,
  },
  tabButtonActive: {
    backgroundColor: "#6750A4",
    shadowColor: "#6750A4",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#49454F",
  },
  tabButtonTextActive: {
    color: "#FFFFFF",
  },
  checklistIntroCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: "#FFF8E1",
    borderColor: "#FFE082",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
  },
  checklistIntroText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: "#E65100",
    fontWeight: "600",
  },
  checklistCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "#FFFFFF",
    borderColor: "#E7E0EC",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  checklistCardActive: {
    borderColor: "#EADDFF",
    backgroundColor: "#F3EDF7",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#79747E",
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxActive: {
    borderColor: "#6750A4",
    backgroundColor: "#6750A4",
  },
  checklistText: {
    flex: 1,
    fontSize: 14,
    color: "#1C1B1F",
    fontWeight: "600",
  },
  checklistTextActive: {
    color: "#6750A4",
  },

  // FAQ Accordion styles
  faqCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7E0EC",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  faqHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  faqQuestion: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#1C1B1F",
  },
  faqAnswerContainer: {
    borderTopWidth: 1,
    borderTopColor: "#E7E0EC",
    marginTop: 12,
    paddingTop: 12,
  },
  faqAnswer: {
    fontSize: 13,
    color: "#49454F",
    lineHeight: 18,
  },

  // Raise problem form inputs
  inputLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1C1B1F",
    marginTop: 16,
    marginBottom: 8,
  },
  categoryPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  categoryPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: "#F3EDF7",
    borderWidth: 1,
    borderColor: "#E7E0EC",
  },
  categoryPillActiveSupport: {
    backgroundColor: "#F3EDF7",
    borderColor: "#6750A4",
  },
  categoryPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#49454F",
  },
  categoryPillTextActive: {
    color: "#6750A4",
  },
  supportInput: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#79747E",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: "#1C1B1F",
    marginBottom: 12,
  },
  supportInputLarge: {
    height: 120,
    textAlignVertical: "top",
  },
  submitTicketBtn: {
    backgroundColor: "#6750A4",
    borderRadius: 100,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
    shadowColor: "#6750A4",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  submitTicketBtnDisabled: {
    backgroundColor: "#E0E0E0",
    elevation: 0,
  },
  submitTicketText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  // Contact support channel cards
  contactCard: {
    flexDirection: "row",
    gap: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7E0EC",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  contactIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  contactDetails: {
    flex: 1,
  },
  contactLabel: {
    fontSize: 12,
    color: "#79747E",
    fontWeight: "500",
  },
  contactValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1C1B1F",
    marginTop: 2,
  },
  contactSub: {
    fontSize: 11,
    color: "#49454F",
    marginTop: 2,
  },

  // User ID styling
  userIdContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F3EDF7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    marginTop: 6,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: "#E7E0EC",
  },
  userIdText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#49454F",
    letterSpacing: 0.5,
  },

  // Demographics row
  demographicsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  demographicBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.accentLight,
    borderWidth: 1,
    borderColor: "#FFF0F2",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 100,
  },
  demographicText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.accent,
  },

  // Photo options sheet — full window, flush toward footer tabs
  photoSheetHost: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    elevation: 2000,
    justifyContent: "flex-end",
  },
  photoModalDim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  photoOptionsContainer: {
    backgroundColor: "#E4E6EB",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 1,
    elevation: 8,
  },
  photoOptionsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: C.onSurface,
    textAlign: "center",
    marginBottom: 16,
  },
  photoOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    marginBottom: 8,
  },
  photoOptionText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.onSurface,
    flex: 1,
  },
  photoOptionDanger: {
    backgroundColor: "#FFEBEE",
  },
  photoOptionDangerText: {
    color: "#f44336",
  },
  photoOptionCancel: {
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  photoOptionCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.onSurfaceVariant,
  },

  // Full-screen viewer
  viewerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  viewerImage: {
    width: "100%",
    height: "80%",
  },
  viewerCloseBtn: {
    position: "absolute",
    top: 50,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
});
