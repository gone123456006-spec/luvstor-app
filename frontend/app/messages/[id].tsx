import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import {
    Stack,
    useFocusEffect,
    useLocalSearchParams,
    useRouter,
} from "expo-router";
import * as ScreenCapture from "expo-screen-capture";
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ActivityIndicator,
    Animated,
    BackHandler,
    Dimensions,
    FlatList,
    InteractionManager,
    Keyboard,
    Modal,
    Platform,
    Pressable,
    Image as RNImage,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import {
    GestureHandlerRootView,
    Swipeable,
} from "react-native-gesture-handler";
import {
    KeyboardAvoidingView,
    useKeyboardState,
    useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Reanimated, {
    Extrapolation,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";
import { io, Socket } from "socket.io-client";
import { useAppAlert } from "../../components/AppAlert";
import { ChatThreadSkeleton } from "../../components/ScreenSkeleton";
import UserProfileModal from "../../components/UserProfileModal";
import WhatsAppAvatar, {
    getDisplayName,
} from "../../components/WhatsAppAvatar";
import { useAuth } from "../../contexts/AuthContext";
import { useCall } from "../../contexts/CallContext";
import { useSocket } from "../../contexts/SocketContext";
import { API_BASE, apiRequest } from "../../utils/api";
import { getAuthToken, getCurrentAuthUser } from "../../utils/auth";
import {
    ChatAccessStatus,
    ensureChatSession,
    fetchChatAccess,
} from "../../utils/chatTokens";
import {
    acceptFriendRequest,
    blockUser,
    FriendshipStatus,
    getFriendshipStatus,
    ReportReason,
    reportUser,
    sendLike,
    unblockUser,
    unlikeUser,
} from "../../utils/friends";
import { fetchUserProfile, NearbyUser } from "../../utils/nearby";
import {
    clearThreadCache,
    getThreadFromMemory,
    hydrateThreadFromDisk,
    schedulePersistThread,
    setThreadCacheAccount,
    type CachedChatMsg,
} from "../../utils/threadCache";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
/** Compact on small phones, slightly larger on tablets */
const IS_COMPACT = SCREEN_WIDTH < 360;
const IS_WIDE = SCREEN_WIDTH >= 768;
const INPUT_BTN = IS_COMPACT ? 34 : IS_WIDE ? 40 : 36;
const SEND_BTN = INPUT_BTN - 4;
const LUVSTOR_PURPLE = "#8E2DE2";
const SENDER_BUBBLE_BLACK = "#111";
const LUVSTOR_PRIMARY = "#6750A4";
const APP_THEME = LUVSTOR_PRIMARY;
const LUVSTOR_GRADIENT = [LUVSTOR_PURPLE, LUVSTOR_PRIMARY] as const;
const INPUT_ICON = IS_COMPACT ? 20 : 22;
const ATTACH_ICON = IS_COMPACT ? 24 : 26;
const CHAT_KEYBOARD_GAP = 4;
/** Inverted list: offset.y below this = user is reading recent messages */
const NEAR_BOTTOM_THRESHOLD = 80;
const IMAGE_PREVIEW_SIZE = Math.min(88, Math.max(64, SCREEN_WIDTH * 0.22));
/** Turn relative /uploads/... or wrong-host absolute URLs into a loadable API_BASE URL */
function resolveMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  if (
    url.startsWith("file://") ||
    url.startsWith("content://") ||
    url.startsWith("data:")
  ) {
    return url;
  }
  if (url.startsWith("/")) {
    return `${API_BASE}${url}`;
  }
  // Absolute URL from another host/localhost → rewrite path onto this device's API_BASE
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/uploads/")) {
      return `${API_BASE}${parsed.pathname}`;
    }
  } catch {
    /* ignore */
  }
  return url;
}

const { width: screenWidth } = Dimensions.get("window");
const IMG_BUBBLE_WIDTH = Math.min(screenWidth * 0.7, 280);

// ── Animated typing indicator (three bouncing dots) ───────────────
const TypingDots = () => {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const bounce = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: -3.5,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.delay(520 - delay),
        ]),
      );
    const anims = [bounce(dot1, 0), bounce(dot2, 160), bounce(dot3, 320)];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.typingDotsRow}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View
          key={i}
          style={[styles.typingDot, { transform: [{ translateY: dot }] }]}
        />
      ))}
    </View>
  );
};

// ── Types ─────────────────────────────────────────────────────────
interface ChatMsg {
  _id: string;
  sender: "me" | "other";
  text: string;
  type: "text" | "image" | "audio";
  mediaUrl?: string | null;
  /** Tiny JPEG data URI so the receiver sees the photo immediately */
  mediaThumb?: string | null;
  localImageUri?: string;
  localVoiceUri?: string;
  replyTo?: ChatMsg;
  isDeleted?: boolean;
  createdAt: number;
  pending?: boolean;
  /** Blocked path — never delivered */
  undelivered?: boolean;
  /** Reached the recipient's device (double gray) */
  delivered?: boolean;
  /** Recipient opened the chat (blue ticks) */
  read?: boolean;
  /** WhatsApp-style view-once photo */
  viewOnce?: boolean;
  viewOnceOpened?: boolean;
}

function getCachedThread(chatId: string): ChatMsg[] {
  return (getThreadFromMemory(chatId) as ChatMsg[] | undefined) || [];
}

function DeliveryTicks({
  isMe,
  pending,
  undelivered,
  delivered,
  read,
  light = false,
}: {
  isMe: boolean;
  pending?: boolean;
  undelivered?: boolean;
  delivered?: boolean;
  read?: boolean;
  light?: boolean;
}) {
  if (!isMe) return null;

  // Single tick: sending / offline / blocked / not yet delivered
  if (pending || undelivered || !delivered) {
    return (
      <Ionicons
        name="checkmark"
        size={13}
        color={light ? "rgba(255,255,255,0.8)" : "#8696A0"}
        style={styles.singleDeliveryTick}
      />
    );
  }

  // Double tick: delivered (gray) or seen (blue)
  const tickColor = read
    ? "#53BDEB"
    : light
      ? "rgba(255,255,255,0.85)"
      : "#8696A0";

  return (
    <View style={styles.doubleDeliveryTicks}>
      <Ionicons
        name="checkmark"
        size={12}
        color={tickColor}
        style={styles.doubleDeliveryTickBack}
      />
      <Ionicons
        name="checkmark"
        size={12}
        color={tickColor}
        style={styles.doubleDeliveryTickFront}
      />
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** WhatsApp-style text bubble: time after text, bottom-right on last line. */
function MessageBubbleText({
  text,
  isMe,
  createdAt,
  pending,
  undelivered,
  delivered,
  read,
}: {
  text: string;
  isMe: boolean;
  createdAt: number;
  pending?: boolean;
  undelivered?: boolean;
  delivered?: boolean;
  read?: boolean;
}) {
  const timeLabel = fmtTime(createdAt);
  const [isMultiLine, setIsMultiLine] = useState(false);

  return (
    <View style={styles.messageTextWrap}>
      <Text
        style={[
          styles.messageText,
          isMe ? styles.myMessageText : styles.otherMessageText,
        ]}
        onTextLayout={(event) => {
          const multi = event.nativeEvent.lines.length > 1;
          if (multi !== isMultiLine) setIsMultiLine(multi);
        }}
      >
        {text}
      </Text>
      <View
        style={[
          styles.messageMetaInline,
          isMultiLine && styles.messageMetaInlineMultiLine,
        ]}
      >
        <Text
          style={[
            styles.messageTime,
            isMe ? styles.myMessageTime : styles.otherMessageTime,
          ]}
        >
          {timeLabel}
        </Text>
        {isMe ? (
          <DeliveryTicks
            isMe
            pending={pending}
            undelivered={undelivered}
            delivered={delivered}
            read={read}
            light
          />
        ) : null}
      </View>
    </View>
  );
}

// ── Voice bubble ──────────────────────────────────────────────────
const VOICE_WAVE_HEIGHTS = [
  7, 12, 9, 15, 11, 14, 8, 13, 10, 16, 12, 8, 14, 9, 13, 11,
];

const VoiceMessage = ({
  uri,
  isMe,
  createdAt,
  pending,
  undelivered,
  delivered,
  read,
}: {
  uri: string;
  isMe: boolean;
  createdAt: number;
  pending?: boolean;
  undelivered?: boolean;
  delivered?: boolean;
  read?: boolean;
}) => {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const playableUri = resolveMediaUrl(uri) || uri;

  const fmtVoice = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
  };

  async function toggle() {
    try {
      if (sound) {
        const status = await sound.getStatusAsync();
        if (status.isLoaded && status.isPlaying) {
          await sound.pauseAsync();
          setPlaying(false);
        } else if (status.isLoaded) {
          await sound.playAsync();
          setPlaying(true);
        }
        return;
      }

      if (!playableUri || (playableUri.startsWith("file://") && !isMe)) {
        console.warn("Voice URL not playable on this device:", playableUri);
        return;
      }

      setLoading(true);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      const { sound: s } = await Audio.Sound.createAsync(
        { uri: playableUri },
        { shouldPlay: true },
      );
      setSound(s);
      setPlaying(true);
      s.setOnPlaybackStatusUpdate((st) => {
        if (!st.isLoaded) return;
        if (typeof st.durationMillis === "number")
          setDurationMs(st.durationMillis);
        if (typeof st.positionMillis === "number")
          setPositionMs(st.positionMillis);
        if (st.didJustFinish) {
          setPlaying(false);
          setPositionMs(0);
          s.setPositionAsync(0);
        }
      });
    } catch (e) {
      console.warn("Voice playback failed", e);
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(
    () => () => {
      sound?.unloadAsync();
    },
    [sound],
  );

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const displayMs = playing || positionMs > 0 ? positionMs : durationMs;
  const barActiveColor = isMe ? "#FFFFFF" : "#8E2DE2";
  const barIdleColor = isMe ? "rgba(255,255,255,0.35)" : "#C4B5D4";

  return (
    <View
      style={[
        styles.voiceBubble,
        isMe ? styles.myVoiceBubble : styles.otherVoiceBubble,
      ]}
    >
      <TouchableOpacity
        onPress={toggle}
        style={[
          styles.voicePlayBtn,
          isMe ? styles.myVoicePlayBtn : styles.otherVoicePlayBtn,
        ]}
        disabled={loading}
        activeOpacity={0.75}
      >
        {loading ? (
          <ActivityIndicator size="small" color={isMe ? "#8E2DE2" : "#fff"} />
        ) : (
          <Ionicons
            name={playing ? "pause" : "play"}
            size={15}
            color={isMe ? "#8E2DE2" : "#fff"}
            style={!playing ? { marginLeft: 1 } : undefined}
          />
        )}
      </TouchableOpacity>

      <View style={styles.voiceBody}>
        <View style={styles.voiceWaveRow}>
          {VOICE_WAVE_HEIGHTS.map((h, i) => {
            const filled =
              (playing || positionMs > 0) &&
              i / VOICE_WAVE_HEIGHTS.length <= progress;
            return (
              <View
                key={i}
                style={[
                  styles.voiceWaveBar,
                  {
                    height: h,
                    backgroundColor: filled ? barActiveColor : barIdleColor,
                  },
                ]}
              />
            );
          })}
        </View>
        <View style={styles.voiceMetaRow}>
          <Text
            style={[
              styles.voiceDuration,
              isMe ? styles.myVoiceDuration : styles.otherVoiceDuration,
            ]}
          >
            {fmtVoice(displayMs || 0)}
          </Text>
          <View style={styles.voiceTimeRow}>
            <Text
              style={[
                styles.voiceTime,
                isMe ? styles.myVoiceTime : styles.otherVoiceTime,
              ]}
            >
              {fmtTime(createdAt)}
            </Text>
            {isMe && (
              <DeliveryTicks
                isMe
                pending={pending}
                undelivered={undelivered}
                delivered={delivered}
                read={read}
                light
              />
            )}
          </View>
        </View>
      </View>
    </View>
  );
};

// ── Message row ───────────────────────────────────────────────────
function replyPreviewLabel(m?: ChatMsg | null) {
  if (!m || m.isDeleted) return "Original message";
  // Audio first — mediaUrl alone must not be treated as a photo
  if (m.type === "audio" || !!m.localVoiceUri) return "Voice message";
  if (m.text?.trim()) return m.text.trim();
  if (m.type === "image" || !!m.localImageUri) {
    return m.viewOnce ? "View once photo" : "Photo";
  }
  return "Message";
}

function replyThumbUri(m?: ChatMsg | null) {
  // Never show media thumb for view-once or audio
  if (!m || m.isDeleted || m.viewOnce) return null;
  if (m.type === "audio" || !!m.localVoiceUri) return null;
  if (m.type !== "image" && !m.localImageUri) return null;
  return (
    resolveMediaUrl(
      m.localImageUri ||
        (m.type === "image" ? m.mediaUrl : null) ||
        m.mediaThumb,
    ) || null
  );
}

const CHAT_IMAGE_MAX_EDGE = 1280;
const CHAT_THUMB_MAX_CHARS = 14000;

function getLocalImageSize(
  uri: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

async function makeChatThumb(uri: string): Promise<string | undefined> {
  try {
    const thumbRes = await manipulateAsync(uri, [{ resize: { width: 36 } }], {
      compress: 0.28,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (
      thumbRes.base64 &&
      thumbRes.base64.length > 0 &&
      thumbRes.base64.length < CHAT_THUMB_MAX_CHARS
    ) {
      return `data:image/jpeg;base64,${thumbRes.base64}`;
    }
  } catch (e) {
    console.warn("Chat image thumb skipped", e);
  }
  return undefined;
}

async function compressChatImage(uri: string): Promise<string> {
  try {
    let width = CHAT_IMAGE_MAX_EDGE;
    try {
      const size = await getLocalImageSize(uri);
      if (size.width > 0) width = Math.min(CHAT_IMAGE_MAX_EDGE, size.width);
    } catch {
      // Keep the default max edge
    }
    const full = await manipulateAsync(uri, [{ resize: { width } }], {
      compress: 0.55,
      format: SaveFormat.JPEG,
    });
    return full.uri || uri;
  } catch (e) {
    console.warn("Chat image compress skipped", e);
    return uri;
  }
}

function prefetchChatImage(uri?: string | null) {
  if (!uri || isLocalMediaUri(uri)) return;
  void Image.prefetch(uri, "memory-disk");
}

function isAudioReply(m?: ChatMsg | null) {
  return !!m && (m.type === "audio" || !!m.localVoiceUri);
}

/** WhatsApp: never buffer the sender's photo. Receiver blurs only on first download. */
const loadedChatImages = new Set<string>();

function isLocalMediaUri(uri: string) {
  return !/^https?:\/\//i.test(uri || "");
}

function rememberLoadedImage(...uris: Array<string | null | undefined>) {
  for (const uri of uris) {
    if (uri) loadedChatImages.add(uri);
  }
}

function imageAlreadyReady(uri: string, isMine?: boolean) {
  return !!isMine || isLocalMediaUri(uri) || loadedChatImages.has(uri);
}

function ImageLoadSpinner({ size = 48 }: { size?: number }) {
  return (
    <View
      style={[
        styles.imageBufferRing,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <ActivityIndicator size="small" color="#fff" />
    </View>
  );
}

const ChatBubbleImage = React.memo(function ChatBubbleImage({
  uri,
  width,
  height,
  isMine,
  placeholderUri,
}: {
  uri: string;
  width: number;
  height: number;
  isMine?: boolean;
  placeholderUri?: string | null;
}) {
  const hasPlaceholder = !!placeholderUri && placeholderUri !== uri;
  const [loaded, setLoaded] = React.useState(
    () => imageAlreadyReady(uri, isMine) || hasPlaceholder,
  );

  React.useEffect(() => {
    let cancelled = false;
    if (imageAlreadyReady(uri, isMine)) {
      rememberLoadedImage(uri);
      setLoaded(true);
      return;
    }
    if (!hasPlaceholder) setLoaded(false);
    Image.getCachePathAsync(uri)
      .then((path) => {
        if (cancelled || !path) return;
        rememberLoadedImage(uri);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uri, isMine, hasPlaceholder]);

  const buffering =
    !isMine && !isLocalMediaUri(uri) && !loaded && !hasPlaceholder;

  const markReady = React.useCallback(() => {
    rememberLoadedImage(uri);
    setLoaded(true);
  }, [uri]);

  return (
    <View style={{ width, height, backgroundColor: "#1F2C34" }}>
      <Image
        source={{ uri }}
        placeholder={hasPlaceholder ? { uri: placeholderUri! } : undefined}
        placeholderContentFit="cover"
        style={{ width, height }}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={uri}
        priority="high"
        blurRadius={0}
        transition={hasPlaceholder ? 80 : 0}
        onLoad={markReady}
        onError={markReady}
      />
      {buffering ? (
        <View pointerEvents="none" style={styles.imageBufferOverlay}>
          <ImageLoadSpinner />
        </View>
      ) : null}
    </View>
  );
});

const WhatsAppFullScreenPhoto = React.memo(function WhatsAppFullScreenPhoto({
  uri,
}: {
  uri: string;
}) {
  const [loaded, setLoaded] = React.useState(() => imageAlreadyReady(uri));

  React.useEffect(() => {
    let cancelled = false;
    if (imageAlreadyReady(uri)) {
      rememberLoadedImage(uri);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    Image.getCachePathAsync(uri)
      .then((path) => {
        if (cancelled || !path) return;
        rememberLoadedImage(uri);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const markReady = React.useCallback(() => {
    rememberLoadedImage(uri);
    setLoaded(true);
  }, [uri]);

  return (
    <View style={styles.fullScreenPhotoWrap}>
      <Image
        source={{ uri }}
        style={styles.fullScreenImage}
        contentFit="contain"
        cachePolicy="memory-disk"
        recyclingKey={`full-${uri}`}
        priority="high"
        transition={0}
        onLoad={markReady}
        onError={markReady}
      />
      {!loaded && !isLocalMediaUri(uri) ? (
        <View pointerEvents="none" style={styles.fullScreenBuffer}>
          <ImageLoadSpinner size={56} />
        </View>
      ) : null}
    </View>
  );
});

const ReplySwipeAction = ({
  dragX,
}: {
  dragX: Animated.AnimatedInterpolation<number>;
}) => {
  const scale = dragX.interpolate({
    inputRange: [0, 36, 72],
    outputRange: [0.35, 1, 1.08],
    extrapolate: "clamp",
  });
  const opacity = dragX.interpolate({
    inputRange: [0, 24, 56],
    outputRange: [0, 0.85, 1],
    extrapolate: "clamp",
  });
  return (
    <View style={styles.replyActionContainer}>
      <Animated.View
        style={[styles.replyActionIcon, { opacity, transform: [{ scale }] }]}
      >
        <Ionicons name="arrow-undo" size={18} color="#fff" />
      </Animated.View>
    </View>
  );
};

const MessageItem = React.memo(function MessageItem({
  item,
  onReply,
  onJumpToReply,
  onImagePress,
  onViewOnceOpen,
  onToggleSelect,
  isSelected,
  selectionMode,
  highlighted,
  otherName,
}: {
  item: ChatMsg;
  onReply: (m: ChatMsg) => void;
  onJumpToReply: (messageId: string) => void;
  onImagePress: (uri: string) => void;
  onViewOnceOpen: (m: ChatMsg) => void;
  onToggleSelect: (id: string) => void;
  isSelected: boolean;
  selectionMode: boolean;
  highlighted: boolean;
  otherName: string;
}) {
  const isMe = item.sender === "me";
  const swRef = useRef<Swipeable>(null);
  const didReplyRef = useRef(false);
  const rowStyle = [
    styles.messageRow,
    isSelected && styles.selectedMessageRow,
    highlighted && styles.highlightedMessageRow,
  ];

  const ReplyPreview = () => {
    if (!item.replyTo) return null;
    const isViewOnceReply = !!item.replyTo.viewOnce;
    const isVoiceReply = isAudioReply(item.replyTo);
    const thumb =
      isViewOnceReply || isVoiceReply ? null : replyThumbUri(item.replyTo);
    return (
      <Pressable
        onPress={() => {
          if (selectionMode || item.replyTo?.isDeleted) return;
          const targetId = item.replyTo?._id;
          if (targetId) onJumpToReply(String(targetId));
        }}
        disabled={selectionMode || !!item.replyTo?.isDeleted}
        style={[
          styles.replyBubble,
          isMe ? styles.myReplyBubble : styles.otherReplyBubble,
          isVoiceReply && styles.replyBubbleVoice,
        ]}
      >
        <View
          style={[
            styles.replyBubbleAccent,
            isMe ? styles.myReplyBubbleAccent : styles.otherReplyBubbleAccent,
          ]}
        />
        <View style={styles.replyBubbleBody}>
          <Text
            style={[
              styles.replyBubbleName,
              isMe ? styles.myReplyBubbleName : styles.otherReplyBubbleName,
            ]}
            numberOfLines={1}
          >
            {item.replyTo.sender === "me" ? "You" : otherName}
          </Text>
          <View style={styles.replyBubbleTextRow}>
            {isVoiceReply ? (
              <Ionicons
                name="mic"
                size={13}
                color={isMe ? "rgba(255,255,255,0.85)" : "#6750A4"}
                style={{ marginRight: 4 }}
              />
            ) : null}
            <Text
              style={[
                styles.replyBubbleText,
                isMe ? styles.myReplyBubbleText : styles.otherReplyBubbleText,
              ]}
              numberOfLines={1}
            >
              {isVoiceReply ? "Voice message" : replyPreviewLabel(item.replyTo)}
            </Text>
          </View>
        </View>
        {isViewOnceReply ? (
          <View
            style={[
              styles.replyBubbleViewOnceThumb,
              isMe
                ? styles.replyBubbleViewOnceThumbMe
                : styles.replyBubbleViewOnceThumbOther,
            ]}
          >
            <Ionicons
              name="eye-off"
              size={15}
              color={isMe ? "#fff" : "#6750A4"}
            />
          </View>
        ) : thumb ? (
          <RNImage
            source={{ uri: thumb }}
            style={styles.replyBubbleThumb}
            resizeMode="cover"
            fadeDuration={0}
          />
        ) : null}
      </Pressable>
    );
  };

  const triggerReply = () => {
    if (didReplyRef.current || selectionMode || item.isDeleted) return;
    didReplyRef.current = true;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      /* ignore */
    }
    // Fire reply after interactions so FlatList/image don't blank mid-swipe
    swRef.current?.close();
    InteractionManager.runAfterInteractions(() => {
      onReply(item);
      didReplyRef.current = false;
    });
  };

  const wrapSwipe = (node: React.ReactNode) => {
    if (selectionMode || item.isDeleted) return <>{node}</>;
    return (
      <Swipeable
        ref={swRef}
        renderLeftActions={(_, dragX) => <ReplySwipeAction dragX={dragX} />}
        onSwipeableOpen={triggerReply}
        leftThreshold={56}
        overshootLeft={false}
        overshootFriction={8}
        friction={2}
        enableTrackpadTwoFingerGesture
      >
        {/* Keep native image layer alive during swipe transform (Android blank fix) */}
        <View collapsable={false} renderToHardwareTextureAndroid>
          {node}
        </View>
      </Swipeable>
    );
  };

  if (item.isDeleted) {
    return (
      <View style={rowStyle}>
        <View
          style={[
            styles.messageContainer,
            isMe ? styles.myMessage : styles.otherMessage,
          ]}
        >
          <View
            style={[
              styles.messageBubble,
              isMe ? styles.myDeletedBubble : styles.otherDeletedBubble,
            ]}
          >
            <View style={styles.deletedMessageContent}>
              <Ionicons
                name="ban-outline"
                size={14}
                color={isMe ? "rgba(255,255,255,0.7)" : "#999"}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.deletedMessageText,
                  isMe
                    ? styles.myDeletedMessageText
                    : styles.otherDeletedMessageText,
                ]}
              >
                This message was deleted
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const remoteImgUri =
    item.type === "image" ? resolveMediaUrl(item.mediaUrl) : null;
  const localImgUri = item.localImageUri
    ? resolveMediaUrl(item.localImageUri)
    : null;
  const thumbUri =
    item.viewOnce || item.type !== "image"
      ? null
      : item.mediaThumb ||
        (localImgUri && isLocalMediaUri(localImgUri) && !isMe
          ? localImgUri
          : null);
  const imgUri = isMe
    ? localImgUri || remoteImgUri
    : remoteImgUri || localImgUri || thumbUri;
  const isViewOnceImage = item.type === "image" && !!item.viewOnce;
  if (imgUri || isViewOnceImage) {
    const showOpenedLock = isViewOnceImage && !!item.viewOnceOpened;
    const showReceiverGate =
      isViewOnceImage && !isMe && !item.viewOnceOpened && !imgUri;
    const showSenderOpened =
      isViewOnceImage && isMe && !!item.viewOnceOpened && !imgUri;

    return wrapSwipe(
      <Pressable
        onLongPress={() => {
          if (!selectionMode) onToggleSelect(item._id);
        }}
        onPress={selectionMode ? () => onToggleSelect(item._id) : undefined}
        delayLongPress={280}
        style={rowStyle}
      >
        {selectionMode && (
          <View style={styles.checkboxContainer}>
            <View
              style={[styles.checkbox, isSelected && styles.checkboxSelected]}
            >
              {isSelected && (
                <Ionicons name="checkmark" size={14} color="#fff" />
              )}
            </View>
          </View>
        )}
        <View
          pointerEvents={selectionMode ? "none" : "box-none"}
          style={{ flex: 1 }}
        >
          <View
            style={[
              styles.messageContainer,
              isMe ? styles.myMessage : styles.otherMessage,
            ]}
          >
            {showOpenedLock || showSenderOpened ? (
              <View
                style={[
                  styles.messageBubble,
                  styles.viewOnceBubble,
                  isMe ? styles.myBubbleBorder : styles.otherBubbleBorder,
                ]}
              >
                <ReplyPreview />
                <View style={styles.viewOnceRow}>
                  <View
                    style={[
                      styles.viewOnceIconCircle,
                      isMe
                        ? styles.viewOnceIconCircleMe
                        : styles.viewOnceIconCircleOther,
                    ]}
                  >
                    <Ionicons
                      name="eye-off-outline"
                      size={15}
                      color={isMe ? "#fff" : "#6750A4"}
                    />
                    <View
                      style={[
                        styles.viewOnceOneBadge,
                        !isMe && styles.viewOnceOneBadgeOther,
                      ]}
                    >
                      <Text style={styles.viewOnceOneBadgeText}>1</Text>
                    </View>
                  </View>
                  <View style={styles.viewOnceTextCol}>
                    <Text
                      style={[
                        styles.viewOnceLabel,
                        isMe
                          ? styles.viewOnceLabelMe
                          : styles.viewOnceLabelOther,
                      ]}
                      numberOfLines={1}
                    >
                      Opened
                    </Text>
                    <View style={styles.viewOnceMetaRow}>
                      <Text
                        style={[
                          styles.viewOnceMeta,
                          isMe
                            ? styles.viewOnceMetaMe
                            : styles.viewOnceMetaOther,
                        ]}
                        numberOfLines={1}
                      >
                        Photo
                      </Text>
                      <View style={styles.viewOnceTimeWrap}>
                        <Text
                          style={[
                            styles.messageTime,
                            isMe
                              ? styles.myMessageTime
                              : styles.otherMessageTime,
                          ]}
                        >
                          {fmtTime(item.createdAt)}
                        </Text>
                        {isMe && (
                          <DeliveryTicks
                            isMe
                            pending={item.pending}
                            undelivered={item.undelivered}
                            delivered={item.delivered}
                            read={item.read}
                            light={isMe}
                          />
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            ) : showReceiverGate ? (
              <TouchableOpacity
                onPress={() => onViewOnceOpen(item)}
                onLongPress={() => {
                  if (!selectionMode) onToggleSelect(item._id);
                }}
                delayLongPress={280}
                activeOpacity={0.85}
                style={[
                  styles.messageBubble,
                  styles.viewOnceBubble,
                  styles.otherBubbleBorder,
                  isSelected && styles.mediaSelected,
                ]}
              >
                <ReplyPreview />
                <View style={styles.viewOnceRow}>
                  <View
                    style={[
                      styles.viewOnceIconCircle,
                      styles.viewOnceIconCircleOther,
                    ]}
                  >
                    <Ionicons name="eye-outline" size={15} color="#6750A4" />
                    <View
                      style={[
                        styles.viewOnceOneBadge,
                        styles.viewOnceOneBadgeOther,
                      ]}
                    >
                      <Text style={styles.viewOnceOneBadgeText}>1</Text>
                    </View>
                  </View>
                  <View style={styles.viewOnceTextCol}>
                    <Text
                      style={[styles.viewOnceLabel, styles.viewOnceLabelOther]}
                      numberOfLines={1}
                    >
                      Photo
                    </Text>
                    <View style={styles.viewOnceMetaRow}>
                      <Text
                        style={[styles.viewOnceMeta, styles.viewOnceMetaOther]}
                        numberOfLines={1}
                      >
                        View once
                      </Text>
                      <View style={styles.viewOnceTimeWrap}>
                        <Text
                          style={[styles.messageTime, styles.otherMessageTime]}
                        >
                          {fmtTime(item.createdAt)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            ) : imgUri ? (
              <TouchableOpacity
                onPress={() => onImagePress(imgUri)}
                onLongPress={() => {
                  if (!selectionMode) onToggleSelect(item._id);
                }}
                delayLongPress={280}
                delayPressIn={120}
                activeOpacity={1}
                style={[
                  styles.imageBubble,
                  isMe ? styles.myImageBubble : styles.otherImageBubble,
                  { width: IMG_BUBBLE_WIDTH },
                  isSelected && styles.mediaSelected,
                ]}
              >
                <View
                  collapsable={false}
                  renderToHardwareTextureAndroid
                  needsOffscreenAlphaCompositing
                  style={{ borderRadius: 12, overflow: "hidden" }}
                >
                  <ReplyPreview />
                  <ChatBubbleImage
                    uri={imgUri}
                    width={IMG_BUBBLE_WIDTH}
                    height={200}
                    isMine={isMe}
                    placeholderUri={!isMe ? thumbUri : null}
                  />
                  {isViewOnceImage ? (
                    <View
                      style={styles.viewOncePhotoBadge}
                      pointerEvents="none"
                    >
                      <Ionicons name="eye" size={13} color="#fff" />
                      <View style={styles.viewOncePhotoOne}>
                        <Text style={styles.viewOncePhotoOneText}>1</Text>
                      </View>
                    </View>
                  ) : null}
                  <View style={styles.imageTimeOverlay}>
                    {isMe && (
                      <DeliveryTicks
                        isMe
                        pending={item.pending}
                        undelivered={item.undelivered}
                        delivered={item.delivered}
                        read={item.read}
                        light
                      />
                    )}
                    <Text style={[styles.messageTime, { color: "#fff" }]}>
                      {fmtTime(item.createdAt)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Pressable>,
    );
  }

  const voiceUri = resolveMediaUrl(
    item.localVoiceUri || (item.type === "audio" ? item.mediaUrl : null),
  );
  if (voiceUri) {
    return wrapSwipe(
      <Pressable
        onLongPress={() => {
          if (!selectionMode) onToggleSelect(item._id);
        }}
        onPress={selectionMode ? () => onToggleSelect(item._id) : undefined}
        delayLongPress={280}
        style={rowStyle}
      >
        {selectionMode && (
          <View style={styles.checkboxContainer}>
            <View
              style={[styles.checkbox, isSelected && styles.checkboxSelected]}
            >
              {isSelected && (
                <Ionicons name="checkmark" size={14} color="#fff" />
              )}
            </View>
          </View>
        )}
        <View
          pointerEvents={selectionMode ? "none" : "box-none"}
          style={{ flex: 1 }}
        >
          <View
            style={[
              styles.messageContainer,
              isMe ? styles.myMessage : styles.otherMessage,
              isSelected && styles.mediaSelected,
            ]}
          >
            <View>
              <ReplyPreview />
              <VoiceMessage
                uri={voiceUri}
                isMe={isMe}
                createdAt={item.createdAt}
                pending={item.pending}
                undelivered={item.undelivered}
                delivered={item.delivered}
                read={item.read}
              />
            </View>
          </View>
        </View>
      </Pressable>,
    );
  }

  return wrapSwipe(
    <Pressable
      onLongPress={() => {
        if (!item.isDeleted && !selectionMode) onToggleSelect(item._id);
      }}
      onPress={
        selectionMode && !item.isDeleted
          ? () => onToggleSelect(item._id)
          : undefined
      }
      style={rowStyle}
    >
      {selectionMode && !item.isDeleted && (
        <View style={styles.checkboxContainer}>
          <View
            style={[styles.checkbox, isSelected && styles.checkboxSelected]}
          >
            {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
        </View>
      )}
      <View
        pointerEvents={selectionMode ? "none" : "box-none"}
        style={{ flex: 1 }}
      >
        <View
          style={[
            styles.messageContainer,
            isMe ? styles.myMessage : styles.otherMessage,
          ]}
        >
          <View
            style={[
              styles.messageBubble,
              isMe ? styles.myBubbleBorder : styles.otherBubbleBorder,
            ]}
          >
            <ReplyPreview />
            <MessageBubbleText
              text={item.text}
              isMe={isMe}
              createdAt={item.createdAt}
              pending={item.pending}
              undelivered={item.undelivered}
              delivered={item.delivered}
              read={item.read}
            />
          </View>
        </View>
      </View>
    </Pressable>,
  );
});

// ── Main Screen ───────────────────────────────────────────────────
export default function MessageScreen() {
  const {
    id,
    name,
    photo,
    gender,
    isOnline: isOnlineParam,
    privacyHidden: privacyHiddenParam,
  } = useLocalSearchParams<{
    id: string;
    name: string;
    photo: string;
    gender: string;
    isOnline: string;
    privacyHidden?: string;
  }>();
  const router = useRouter();
  const { showAlert } = useAppAlert();
  const { sessionVersion, user } = useAuth();
  const { startCall: startMediaCall } = useCall();
  const {
    friendTick,
    refreshUnread,
    profileTick,
    lastProfileUpdate,
    presenceTick,
    lastPresence,
    conversationDeletedTick,
    lastConversationDeleted,
    bumpChatPreview,
  } = useSocket();

  const [messages, setMessages] = useState<ChatMsg[]>(() =>
    getCachedThread(String(id)),
  );
  const [loading, setLoading] = useState(
    () => getCachedThread(String(id)).length === 0,
  );
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedImage, setSelectedImage] = useState<{
    uri: string;
    width: number;
    height: number;
  } | null>(null);
  const [fullScreenImage, setFullScreenImage] = useState<{
    uri: string;
    messageId?: string;
    viewOnce?: boolean;
  } | null>(null);
  const fullScreenImageRef = useRef(fullScreenImage);
  fullScreenImageRef.current = fullScreenImage;
  const [pendingPhoto, setPendingPhoto] = useState<{
    uri: string;
  } | null>(null);
  const [pendingViewOnce, setPendingViewOnce] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMsg | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [chatAccess, setChatAccess] = useState<ChatAccessStatus | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [conversationStatus, setConversationStatus] = useState<{
    canSend: boolean;
    code?: string;
    message?: string;
    consecutiveCount: number;
  }>({ canSend: true, consecutiveCount: 0 });
  const [friendshipStatus, setFriendshipStatus] =
    useState<FriendshipStatus | null>(null);
  const friendshipStatusRef = useRef<FriendshipStatus | null>(null);
  friendshipStatusRef.current = friendshipStatus;

  /** Both liked each other → + photo / voice / calls unlock */
  const isMatched = !!(
    friendshipStatus?.areFriends ||
    friendshipStatus?.canCall ||
    friendshipStatus?.canSendMedia ||
    friendshipStatus?.status === "mutual_match" ||
    friendshipStatus?.status === "friends" ||
    (friendshipStatus?.iLiked && friendshipStatus?.theyLiked)
  );

  const [likingHeader, setLikingHeader] = useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 56, right: 12 });
  const menuPosRef = useRef({ top: 56, right: 12 });
  const menuOpenRef = useRef(false);
  const menuOpenGuardRef = useRef(false);
  const menuOverlayRef = useRef<View>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const moreBtnRef = useRef<View>(null);
  const [profileUser, setProfileUser] = useState<NearbyUser | null>(null);
  const [displayName, setDisplayName] = useState(name || "User");
  const [displayPhoto, setDisplayPhoto] = useState(photo || "");
  const [displayGender, setDisplayGender] = useState(gender || "");
  const [displayBio, setDisplayBio] = useState("");
  const [privacyHidden, setPrivacyHidden] = useState(false);

  // Instant mic ↔ send (no extra state lag)
  const showSendIcon = inputText.trim().length > 0 || !!selectedImage;

  const [otherUserOnline, setOtherUserOnline] = useState(
    isOnlineParam === "true",
  );
  const socketRef = useRef<Socket | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const keyboardWasOpenRef = useRef(false);
  const chatTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isNearBottomRef = useRef(true);
  const prevMessagesLenRef = useRef(0);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingEmitAt = useRef(0);
  const insets = useSafeAreaInsets();
  const isKeyboardVisible = useKeyboardState((s) => s.isVisible);
  const selectionMode = selectedMessages.length > 0;

  const bottomInsetSv = useSharedValue(insets.bottom);
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();

  useEffect(() => {
    bottomInsetSv.value = insets.bottom;
  }, [bottomInsetSv, insets.bottom]);

  // Closed: home-indicator safe area. Open: 4px gap above keyboard.
  const safeSpacerStyle = useAnimatedStyle(() => ({
    height: interpolate(
      keyboardProgress.value,
      [0, 1],
      [bottomInsetSv.value, CHAT_KEYBOARD_GAP],
      Extrapolation.CLAMP,
    ),
  }));

  const scrollToLatest = useCallback((animated = true) => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  const handleListScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      isNearBottomRef.current =
        e.nativeEvent.contentOffset.y <= NEAR_BOTTOM_THRESHOLD;
    },
    [],
  );

  // Scroll to latest only when keyboard opens and user was already at the bottom
  useEffect(() => {
    if (!isKeyboardVisible || !isNearBottomRef.current) return;
    const frame = requestAnimationFrame(() => scrollToLatest(true));
    return () => cancelAnimationFrame(frame);
  }, [isKeyboardVisible, scrollToLatest]);

  // New messages: scroll only if user is already near the bottom
  useEffect(() => {
    if (
      messages.length > prevMessagesLenRef.current &&
      isNearBottomRef.current
    ) {
      requestAnimationFrame(() => scrollToLatest(true));
    }
    prevMessagesLenRef.current = messages.length;
  }, [messages.length, scrollToLatest]);

  const applyChatAccess = (status: ChatAccessStatus) => {
    setChatAccess(status);
    setRemainingMs(status.remainingMs || 0);
  };

  const fetchConversationStatus = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetch(
        `${API_BASE}/api/chat/conversation-status/${id}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.ok) {
        const status = await res.json();
        setConversationStatus(status);
        setChatMuted(!!status.muted);
      }
    } catch (e) {
      console.error("Failed to fetch conversation status", e);
    }
  };

  const handleMuteChat = () => {
    closeChatMenu(async () => {
      try {
        const token = await getAuthToken();
        if (!token || !id) return;
        const next = !chatMuted;
        const data: any = await apiRequest(`/api/chat/mute/${id}`, token, {
          method: "POST",
          body: JSON.stringify({ muted: next }),
        });
        setChatMuted(!!data?.muted);
        showAlert({
          title: data?.muted ? "Chat muted" : "Chat unmuted",
          message: data?.muted
            ? "You won't get push notifications from this chat."
            : "Push notifications for this chat are on again.",
          icon: data?.muted ? "notifications-off" : "notifications",
        });
      } catch (e: any) {
        showAlert({
          title: "Could not update mute",
          message: e?.message || "Please try again.",
          icon: "alert-circle",
        });
      }
    });
  };

  const fetchFriendshipStatus = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      const status = await getFriendshipStatus(token, id);
      setFriendshipStatus(status);
      if (status.theyBlocked || status.iBlocked) {
        setPrivacyHidden(!!status.theyBlocked);
        setOtherUserOnline(false);
      } else {
        setPrivacyHidden(false);
        // After unblock, restore real online status from profile
        try {
          const { user } = await fetchUserProfile(token, String(id));
          if (user) {
            setOtherUserOnline(!!user.isOnline);
            if (user.photo) {
              setDisplayPhoto(resolveMediaUrl(user.photo) || user.photo || "");
            }
            if (user.name) setDisplayName(user.name);
            if (user.gender) setDisplayGender(user.gender);
          }
        } catch {
          /* keep previous */
        }
      }
    } catch (e) {
      console.error("Failed to fetch friendship status", e);
    }
  };

  const toggleHeaderLike = async () => {
    if (likingHeader || !id) return;

    const status = friendshipStatus;
    const areFriends = !!status?.areFriends;
    const iLiked = !!status?.iLiked;
    const theyLiked = !!status?.theyLiked;
    const relStatus = status?.status;

    if (status?.status === "blocked") {
      showAlert({
        title: "Unavailable",
        message: "This action isn't available while the user is blocked.",
        icon: "alert-circle",
      });
      return;
    }

    const applyFriendshipLocal = (next: Partial<FriendshipStatus>) => {
      setFriendshipStatus((prev) => ({
        status: (next.status ||
          prev?.status ||
          "stranger") as FriendshipStatus["status"],
        areFriends: next.areFriends ?? prev?.areFriends ?? false,
        canSendMedia: next.canSendMedia ?? prev?.canSendMedia ?? false,
        canCall: next.canCall ?? prev?.canCall ?? false,
        iLiked: next.iLiked ?? prev?.iLiked ?? false,
        theyLiked: next.theyLiked ?? prev?.theyLiked ?? false,
        iBlocked: prev?.iBlocked,
        theyBlocked: prev?.theyBlocked,
      }));
    };

    const runUnlike = async () => {
      const previous = friendshipStatus;
      applyFriendshipLocal({
        status: "stranger",
        areFriends: false,
        canSendMedia: false,
        canCall: false,
        iLiked: false,
        theyLiked: false,
      });
      setLikingHeader(true);
      try {
        const token = await getAuthToken();
        if (!token) return;
        await unlikeUser(token, String(id));
        await fetchFriendshipStatus();
      } catch (e: any) {
        if (previous) setFriendshipStatus(previous);
        showAlert({
          title: "Could not unlike",
          message: e?.message || "Please try again.",
          icon: "alert-circle",
        });
      } finally {
        setLikingHeader(false);
      }
    };

    // Friends → Unlike removes the friendship
    if (areFriends) {
      showAlert({
        title: "Unlike?",
        message: `Remove ${getDisplayName(displayName) || "this user"} from friends?`,
        icon: "heart-dislike",
        buttons: [
          { text: "Cancel", style: "cancel" },
          { text: "Unlike", style: "destructive", onPress: runUnlike },
        ],
      });
      return;
    }

    // Already liked them (pending) → Unlike
    if (iLiked && !areFriends) {
      showAlert({
        title: "Unlike?",
        message: "Remove your like for this user.",
        icon: "heart-dislike",
        buttons: [
          { text: "Cancel", style: "cancel" },
          { text: "Unlike", style: "destructive", onPress: runUnlike },
        ],
      });
      return;
    }

    // Same as Request: Like Back / Accept → Friends
    const previous = friendshipStatus;
    applyFriendshipLocal({
      status:
        relStatus === "mutual_match" || theyLiked ? "friends" : "pending_like",
      areFriends: relStatus === "mutual_match" || theyLiked,
      canSendMedia: relStatus === "mutual_match" || theyLiked,
      canCall: relStatus === "mutual_match" || theyLiked,
      iLiked: true,
      theyLiked,
    });

    setLikingHeader(true);
    try {
      const token = await getAuthToken();
      if (!token) return;

      let resultStatus = "pending_like";
      if (relStatus === "mutual_match") {
        const result = await acceptFriendRequest(token, String(id));
        resultStatus = result.status;
      } else {
        const result = await sendLike(token, String(id));
        resultStatus = result.status;
      }

      await fetchFriendshipStatus();

      if (resultStatus === "friends") {
        showAlert({
          title: "You're friends!",
          message: "Moved to the Friend section.",
          icon: "heart",
        });
      }
    } catch (e: any) {
      if (previous) setFriendshipStatus(previous);
      showAlert({
        title: "Could not send like",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    } finally {
      setLikingHeader(false);
    }
  };

  const reportAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!menuOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeChatMenu();
      return true;
    });
    return () => sub.remove();
  }, [menuOpen]);

  useEffect(() => {
    if (reportOpen) {
      reportAnim.setValue(0);
      Animated.timing(reportAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [reportOpen, reportAnim]);

  const closeChatMenu = (after?: () => void) => {
    menuOpenRef.current = false;
    menuOverlayRef.current?.setNativeProps({
      opacity: 0,
      pointerEvents: "none",
    });
    setMenuOpen(false);
    if (after) requestAnimationFrame(after);
  };

  const computeMenuPosition = () => {
    const gap = Platform.OS === "android" ? 28 : 14;
    const edge = Platform.OS === "android" ? 12 : 10;
    const node = moreBtnRef.current;
    if (!node || typeof (node as any).measureInWindow !== "function") {
      return;
    }
    (node as any).measureInWindow(
      (x: number, y: number, width: number, height: number) => {
        const { width: winW, height: winH } = Dimensions.get("window");
        const menuWidth = 86;
        let right = Math.max(edge, winW - (x + width) + 4);
        if (winW - right - menuWidth < edge) {
          right = Math.max(edge, winW - menuWidth - edge);
        }
        let top = y + Math.max(height, 40) + gap;
        const minTop =
          Platform.OS === "android"
            ? Math.max(edge, insets.top + 56)
            : edge + 8;
        top = Math.max(top, minTop);
        const estimatedH = 168;
        if (top + estimatedH > winH - edge) {
          top = Math.max(minTop, y - estimatedH - gap);
        }
        const prev = menuPosRef.current;
        if (prev.top === top && prev.right === right) return;
        const pos = { top, right };
        menuPosRef.current = pos;
        setMenuPos(pos);
      },
    );
  };

  const openChatMenu = () => {
    if (menuOpenRef.current) return;
    menuOpenRef.current = true;
    menuOpenGuardRef.current = true;

    // Show overlay on the same frame as touch — before React re-render
    menuOverlayRef.current?.setNativeProps({
      opacity: 1,
      pointerEvents: "box-none",
    });
    setMenuOpen(true);

    requestAnimationFrame(() => {
      menuOpenGuardRef.current = false;
    });

    if (keyboardWasOpenRef.current) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const closeReportSheet = (after?: () => void) => {
    Animated.timing(reportAnim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setReportOpen(false);
      if (after) requestAnimationFrame(after);
    });
  };

  const handleMenuLike = () => {
    closeChatMenu(() => toggleHeaderLike());
  };

  const handleBlockUser = () => {
    closeChatMenu(() => {
      const label = getDisplayName(displayName) || "this user";
      showAlert({
        title: `Block ${label}?`,
        message:
          "Blocked contacts can't message you or see your profile photo. You can unblock them anytime.",
        icon: "hand-left",
        buttons: [
          { text: "Cancel", style: "cancel" },
          {
            text: "Block",
            style: "destructive",
            onPress: async () => {
              try {
                const token = await getAuthToken();
                if (!token || !id) return;
                await blockUser(token, String(id));
                await fetchFriendshipStatus();
                showAlert({
                  title: "User blocked",
                  message: `${label} has been blocked.`,
                  icon: "checkmark-circle",
                });
              } catch (e: any) {
                showAlert({
                  title: "Could not block",
                  message: e?.message || "Please try again.",
                  icon: "alert-circle",
                });
              }
            },
          },
        ],
      });
    });
  };

  const handleReportUser = () => {
    closeChatMenu(() => setReportOpen(true));
  };

  const submitReport = async (reason: ReportReason, alsoBlock: boolean) => {
    try {
      const token = await getAuthToken();
      if (!token || !id) return;
      const result = await reportUser(token, String(id), reason, { alsoBlock });
      await fetchFriendshipStatus();
      showAlert({
        title: alsoBlock ? "Reported & blocked" : "Report sent",
        message: result.message,
        icon: "checkmark-circle",
      });
    } catch (e: any) {
      showAlert({
        title: "Could not report",
        message: e?.message || "Please try again.",
        icon: "alert-circle",
      });
    }
  };

  const showInsufficientTokensPopup = (msg?: string) => {
    showAlert({
      title: "Not enough tokens",
      message:
        msg ||
        "You don't have enough tokens to continue chatting. Please purchase more tokens to continue.",
      icon: "wallet",
      buttons: [
        { text: "Cancel", style: "cancel" },
        {
          text: "Buy Tokens",
          style: "primary",
          onPress: () => router.push("/(tabs)/token"),
        },
      ],
    });
  };

  /** Fast local gate — server still enforces session on socket send. */
  const requireChatAccess = async (): Promise<boolean> => {
    // Instant path: already have an active session or enough tokens cached
    if (
      chatAccess?.unlimitedChat ||
      chatAccess?.hasActiveSession ||
      chatAccess?.canChat
    ) {
      return true;
    }
    if (chatAccess && chatAccess.canChat === false) {
      showInsufficientTokensPopup(chatAccess.message);
      return false;
    }
    // Cold path only (first send before status loaded)
    try {
      const token = await getAuthToken();
      if (!token) return false;
      const status = await ensureChatSession(token);
      applyChatAccess(status);
      if (status.ok === false || status.code === "INSUFFICIENT_TOKENS") {
        showInsufficientTokensPopup(status.message);
        return false;
      }
      return true;
    } catch (e) {
      console.error("ensureChatSession failed", e);
      showAlert({
        title: "Chat access",
        message: "Could not verify chat tokens. Try again.",
        icon: "alert-circle",
      });
      return false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuthToken();
        if (!token || cancelled) return;
        const status = await fetchChatAccess(token);
        if (!cancelled) {
          applyChatAccess(status);
          await fetchConversationStatus();
        }
      } catch (e) {
        console.warn("fetchChatAccess failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, sessionVersion]);

  // Live friendship updates (like / unlike / became friends)
  useEffect(() => {
    if (friendTick === 0) return;
    fetchFriendshipStatus();
  }, [friendTick, id]);

  // Chat deleted — leave thread immediately (WhatsApp-style)
  useEffect(() => {
    if (
      conversationDeletedTick === 0 ||
      !lastConversationDeleted?.otherUserId
    ) {
      return;
    }
    if (String(lastConversationDeleted.otherUserId) !== String(id)) return;
    void clearThreadCache(user?.email, String(id));
    router.replace("/(tabs)/chat");
  }, [
    conversationDeletedTick,
    lastConversationDeleted,
    id,
    user?.email,
    router,
  ]);

  // Keep header name/photo in sync with route params + live profile updates
  useEffect(() => {
    const blocked =
      !!friendshipStatus?.theyBlocked || !!friendshipStatus?.iBlocked;
    const hidden =
      !!friendshipStatus?.theyBlocked || privacyHiddenParam === "true";
    setPrivacyHidden(hidden);
    setDisplayName(name || "User");
    setDisplayPhoto(hidden ? "" : photo || "");
    setDisplayGender(gender || "");
    if (blocked || hidden) {
      setOtherUserOnline(false);
    }
  }, [
    id,
    name,
    photo,
    gender,
    privacyHiddenParam,
    friendshipStatus?.theyBlocked,
    friendshipStatus?.iBlocked,
  ]);

  useEffect(() => {
    if (profileTick === 0 || !lastProfileUpdate?.userId) return;
    if (String(lastProfileUpdate.userId) !== String(id)) return;
    const hidden =
      !!friendshipStatus?.theyBlocked ||
      !!(lastProfileUpdate as any).privacyHidden;
    if (hidden) {
      setPrivacyHidden(true);
      setDisplayPhoto("");
      setOtherUserOnline(false);
    } else {
      setPrivacyHidden(false);
    }
    if (lastProfileUpdate.name) setDisplayName(lastProfileUpdate.name);
    if (!hidden && lastProfileUpdate.photo != null) {
      setDisplayPhoto(
        resolveMediaUrl(lastProfileUpdate.photo) ||
          lastProfileUpdate.photo ||
          "",
      );
    }
    if (lastProfileUpdate.gender) setDisplayGender(lastProfileUpdate.gender);
    if (lastProfileUpdate.bio != null) setDisplayBio(lastProfileUpdate.bio);
    setProfileUser((prev) =>
      prev
        ? {
            ...prev,
            name: lastProfileUpdate.name || prev.name,
            bio:
              lastProfileUpdate.bio != null ? lastProfileUpdate.bio : prev.bio,
            photo: hidden
              ? ""
              : lastProfileUpdate.photo
                ? resolveMediaUrl(lastProfileUpdate.photo) ||
                  lastProfileUpdate.photo
                : prev.photo,
            photos: Array.isArray(lastProfileUpdate.photos)
              ? (lastProfileUpdate.photos
                  .map((p) => resolveMediaUrl(p) || p)
                  .filter(Boolean) as string[])
              : prev.photos,
            age:
              lastProfileUpdate.age != null ? lastProfileUpdate.age : prev.age,
            gender: lastProfileUpdate.gender || prev.gender,
            height:
              lastProfileUpdate.height !== undefined
                ? lastProfileUpdate.height
                : prev.height,
            interests: Array.isArray(lastProfileUpdate.interests)
              ? lastProfileUpdate.interests
              : prev.interests,
            relationshipGoal:
              lastProfileUpdate.relationshipGoal !== undefined
                ? lastProfileUpdate.relationshipGoal
                : prev.relationshipGoal,
            publicId: lastProfileUpdate.publicId || prev.publicId,
          }
        : prev,
    );
  }, [profileTick, lastProfileUpdate, id, friendshipStatus?.theyBlocked]);

  // Load latest name / bio / photo for this chat partner
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuthToken();
        if (!token || !id) return;
        const { user } = await fetchUserProfile(token, String(id));
        if (cancelled || !user) return;
        setDisplayName(user.name || "User");
        if (user.photo) setDisplayPhoto(user.photo);
        if (user.gender) setDisplayGender(user.gender);
        setDisplayBio(user.bio || "");
        setProfileUser((prev) => ({
          ...(prev || {
            id: String(id),
            name: user.name,
            age: user.age,
            bio: user.bio,
            photo: user.photo,
            photos: user.photos || [],
            gender: user.gender,
            interests: user.interests || [],
            isOnline: otherUserOnline,
          }),
          ...user,
          isOnline: otherUserOnline,
        }));
      } catch {
        /* keep route params */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, sessionVersion, profileTick]);

  // Fallback poll only when socket is disconnected (live path is Socket.IO)
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const latestAtRef = { current: 0 };

      const syncOnce = async () => {
        try {
          if (socketRef.current?.connected) return;

          const token = await getAuthToken();
          if (!token || cancelled) return;
          const authUser = await getCurrentAuthUser();
          if (!authUser?.id || cancelled) return;

          const afterIso = new Date(
            Math.max(latestAtRef.current - 1000, 0),
          ).toISOString();
          const poll: any[] = await apiRequest(
            `/api/chat/poll/${id}?after=${encodeURIComponent(afterIso)}`,
            token,
          ).catch(() => []);

          if (cancelled || !Array.isArray(poll) || !poll.length) return;

          setMessages((prev) => {
            const byId = new Map(prev.map((m) => [m._id, m]));
            let changed = false;
            let maxAt = latestAtRef.current;
            for (const raw of poll) {
              const mapped = mapMsg(raw, authUser.id);
              if (mapped.undelivered && mapped.sender === "other") continue;
              if (
                friendshipStatusRef.current?.iBlocked &&
                mapped.sender === "other"
              ) {
                continue;
              }
              const at = mapped.createdAt || 0;
              if (at > maxAt) maxAt = at;
              if (!byId.has(mapped._id)) {
                byId.set(mapped._id, mapped);
                changed = true;
              }
            }
            latestAtRef.current = maxAt;
            if (!changed) return prev;
            return Array.from(byId.values()).sort(
              (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
            );
          });
        } catch {
          /* ignore */
        }
      };

      // Seed latest timestamp from current messages
      setMessages((prev) => {
        latestAtRef.current = prev.reduce(
          (max, m) => Math.max(max, m.createdAt || 0),
          0,
        );
        return prev;
      });

      // Light refresh on focus (once), then rare poll if offline
      void (async () => {
        try {
          refreshUnread();
          const token = await getAuthToken();
          if (!token || cancelled) return;
          await Promise.all([
            fetchChatAccess(token).then((access) => {
              if (!cancelled) applyChatAccess(access);
            }),
            fetchConversationStatus(),
            fetchFriendshipStatus(),
          ]);
        } catch {
          /* ignore */
        }
      })();

      syncOnce();
      const iv = setInterval(syncOnce, 5000);

      return () => {
        cancelled = true;
        clearInterval(iv);
      };
    }, [id, refreshUnread]),
  );

  useEffect(() => {
    if (chatAccess?.unlimitedChat) {
      setRemainingMs(chatAccess.remainingMs || 0);
      return;
    }
    if (!chatAccess?.hasActiveSession || !chatAccess.sessionExpiresAt) {
      setRemainingMs(0);
      return;
    }
    const expires = new Date(chatAccess.sessionExpiresAt).getTime();
    const tick = () => {
      const left = Math.max(0, expires - Date.now());
      setRemainingMs(left);
      if (left <= 0) {
        setChatAccess((prev) =>
          prev && !prev.unlimitedChat
            ? {
                ...prev,
                hasActiveSession: false,
                remainingMs: 0,
                canChat: (prev.tokenBalance ?? 0) >= (prev.tokenCost ?? 10),
              }
            : prev,
        );
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [
    chatAccess?.sessionExpiresAt,
    chatAccess?.hasActiveSession,
    chatAccess?.unlimitedChat,
  ]);

  // Soft sync across devices / after spin credit elsewhere
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        const status = await fetchChatAccess(token);
        applyChatAccess(status);
      } catch {
        /* ignore */
      }
    }, 60000);
    return () => clearInterval(iv);
  }, [id]);

  // WhatsApp-style: newest first + inverted list → latest always at bottom on open
  const listData = useMemo(() => [...messages].reverse(), [messages]);

  const jumpToRepliedMessage = useCallback(
    (messageId: string) => {
      const index = listData.findIndex(
        (m) => String(m._id) === String(messageId),
      );
      if (index < 0) {
        showAlert({
          title: "Can't find message",
          message: "This message is no longer available in the chat.",
          icon: "alert-circle",
        });
        return;
      }
      try {
        flatListRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.35,
        });
      } catch {
        /* onScrollToIndexFailed handles retry */
      }
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setHighlightedMessageId(String(messageId));
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
      }, 1400);
    },
    [listData, showAlert],
  );

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const cached = getCachedThread(String(id));
    if (cached.length) {
      setMessages(cached);
      setLoading(false);
    } else {
      setMessages([]);
    }
  }, [id]);

  useEffect(() => {
    if (!id || !messages.length) return;
    schedulePersistThread(String(id), messages as CachedChatMsg[]);
  }, [id, messages]);

  useEffect(() => {
    setThreadCacheAccount(user?.email);
  }, [user?.email]);

  const mapMsg = (m: any, myUid: string): ChatMsg => {
    const isDeleted = Boolean(m.isDeleted);
    const mediaUrl = isDeleted
      ? null
      : resolveMediaUrl(m.mediaUrl) || m.mediaUrl || null;
    const mediaThumb =
      !isDeleted && !m.viewOnce && typeof m.mediaThumb === "string"
        ? m.mediaThumb
        : undefined;

    let replyTo: ChatMsg | undefined;
    const rt = m.replyTo;
    if (rt && typeof rt === "object" && rt._id) {
      const rtDeleted = Boolean(rt.isDeleted);
      const rtViewOnce = !!rt.viewOnce;
      const rtMedia =
        rtDeleted || rtViewOnce
          ? null
          : resolveMediaUrl(rt.mediaUrl) || rt.mediaUrl || null;
      replyTo = {
        _id: String(rt._id),
        sender: String(rt.senderId) === myUid ? "me" : "other",
        text: rtDeleted ? "" : rt.text || "",
        type: rt.type || "text",
        mediaUrl:
          !rtDeleted && !rtViewOnce && rt.type === "image" ? rtMedia : null,
        localImageUri:
          !rtDeleted && !rtViewOnce && rt.type === "image" && rtMedia
            ? rtMedia
            : undefined,
        localVoiceUri:
          !rtDeleted && rt.type === "audio" && rtMedia ? rtMedia : undefined,
        createdAt: rt.createdAt ? new Date(rt.createdAt).getTime() : Date.now(),
        isDeleted: rtDeleted,
        viewOnce: rtViewOnce,
        viewOnceOpened: !!rt.viewOnceOpened,
      };
    }

    return {
      _id: String(m._id),
      sender: String(m.senderId) === myUid ? "me" : "other",
      text: isDeleted ? "" : m.text || "",
      type: m.type || "text",
      mediaUrl,
      mediaThumb,
      localVoiceUri:
        !isDeleted && m.type === "audio" && mediaUrl ? mediaUrl : undefined,
      replyTo,
      viewOnce: !!m.viewOnce,
      viewOnceOpened: !!m.viewOnceOpened,
      createdAt: new Date(m.createdAt).getTime(),
      pending: false,
      undelivered: !!m.undelivered,
      // Back-compat: older messages had no `delivered` field — treat as delivered
      delivered: m.undelivered
        ? false
        : m.delivered === true || m.read === true || m.delivered == null,
      read: !!m.read && !m.undelivered,
      isDeleted,
    };
  };

  const replyTargetId = (m: ChatMsg | null | undefined) =>
    m && /^[0-9a-f]{24}$/i.test(String(m._id)) ? String(m._id) : null;

  const sanitizeReplyQuote = (
    m: ChatMsg | null | undefined,
  ): ChatMsg | undefined => {
    if (!m) return undefined;
    if (m.viewOnce) {
      return {
        ...m,
        mediaUrl: null,
        localImageUri: undefined,
      };
    }
    // Audio replies must never carry an image thumb
    if (m.type === "audio" || m.localVoiceUri) {
      return {
        ...m,
        type: "audio",
        localImageUri: undefined,
      };
    }
    return m;
  };

  const handleReplyToMessage = useCallback((m: ChatMsg) => {
    setReplyingTo(sanitizeReplyQuote(m) || m);
    // Defer focus so keyboard/layout doesn't blank the swiped image
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => inputRef.current?.focus(), 60);
    });
  }, []);

  const handleImagePress = useCallback((uri: string) => {
    setFullScreenImage({ uri });
  }, []);

  const handleToggleSelect = useCallback((msgId: string) => {
    setSelectedMessages((p) =>
      p.includes(msgId) ? p.filter((x) => x !== msgId) : [...p, msgId],
    );
  }, []);

  const openViewOncePhoto = useCallback(
    async (m: ChatMsg) => {
      if (!m.viewOnce || m.viewOnceOpened || m.sender === "me") return;
      if (!/^[0-9a-f]{24}$/i.test(String(m._id))) return;

      // Prefer REST (reliable); also notify via socket for sender sync
      try {
        const token = await getAuthToken();
        if (!token) return;
        const res: any = await apiRequest(
          `/api/chat/view-once/${m._id}`,
          token,
          {
            method: "POST",
            body: JSON.stringify({}),
          },
        );
        const uri = resolveMediaUrl(res?.mediaUrl) || res?.mediaUrl || "";
        if (!uri) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg._id === m._id
                ? {
                    ...msg,
                    viewOnceOpened: true,
                    mediaUrl: null,
                    localImageUri: undefined,
                  }
                : msg,
            ),
          );
          return;
        }
        setFullScreenImage({ uri, messageId: String(m._id), viewOnce: true });
        setMessages((prev) =>
          prev.map((msg) =>
            msg._id === m._id
              ? {
                  ...msg,
                  viewOnceOpened: true,
                  mediaUrl: null,
                  localImageUri: undefined,
                }
              : msg,
          ),
        );
      } catch (e: any) {
        const already =
          e?.code === "ALREADY_OPENED" ||
          e?.status === 410 ||
          /already opened/i.test(String(e?.message || ""));
        setMessages((prev) =>
          prev.map((msg) =>
            msg._id === m._id
              ? {
                  ...msg,
                  viewOnceOpened: true,
                  mediaUrl: null,
                  localImageUri: undefined,
                }
              : msg,
          ),
        );
        if (!already) {
          showAlert({
            title: "Could not open photo",
            message: e?.message || "Please try again.",
            icon: "eye-off",
          });
        }
      }
    },
    [showAlert],
  );

  const closeFullScreenImage = () => {
    setFullScreenImage(null);
  };

  // Block screenshots / screen recording while a view-once photo is visible
  const protectViewOnceCapture =
    !!fullScreenImage?.viewOnce || (!!pendingPhoto && pendingViewOnce);

  useEffect(() => {
    if (!protectViewOnceCapture) return;

    let cancelled = false;
    const key = "view-once";

    const enable = async () => {
      try {
        const available = await ScreenCapture.isAvailableAsync();
        if (!available || cancelled) return;
        await ScreenCapture.preventScreenCaptureAsync(key);
        if (Platform.OS === "ios") {
          await ScreenCapture.enableAppSwitcherProtectionAsync(0.85);
        }
      } catch (e) {
        console.warn("View-once capture protection failed", e);
      }
    };

    enable();

    // If a screenshot somehow still fires, close the open view-once immediately
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = ScreenCapture.addScreenshotListener(() => {
        if (fullScreenImageRef.current?.viewOnce) {
          setFullScreenImage(null);
          showAlert({
            title: "Not allowed",
            message:
              "Screenshots and recordings aren't allowed for view once photos.",
            icon: "eye-off",
          });
        }
      });
    } catch {
      // Screenshot listener may need permissions on older Android; blocking still applies
    }

    return () => {
      cancelled = true;
      subscription?.remove();
      ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
      if (Platform.OS === "ios") {
        ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {});
      }
    };
  }, [protectViewOnceCapture, showAlert]);

  // ── Load history & Setup Socket.IO ──────────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const init = async () => {
      const token = await getAuthToken();
      const authUser = await getCurrentAuthUser();
      if (!token || !authUser || cancelled) return;

      const chatId = String(id);
      setThreadCacheAccount(authUser.email || user?.email);

      let hadLocal = getCachedThread(chatId).length > 0;
      if (!hadLocal) {
        const disk = await hydrateThreadFromDisk(
          chatId,
          (raw, myUid) => (raw as any[]).map((m) => mapMsg(m, myUid)),
          authUser.id,
        );
        if (disk?.length && !cancelled) {
          setMessages(disk as ChatMsg[]);
          setLoading(false);
          hadLocal = true;
        }
      }

      if (!hadLocal) setLoading(true);
      try {
        const history: any[] = await apiRequest(
          `/api/chat/history/${id}`,
          token,
        );
        if (cancelled) return;
        const mapped = history.map((m) => mapMsg(m, authUser.id));
        setMessages(mapped);
        schedulePersistThread(chatId, mapped as CachedChatMsg[]);
        for (const raw of history.slice(-12)) {
          if (raw?.type === "image" && raw.mediaUrl && !raw.viewOnce) {
            prefetchChatImage(resolveMediaUrl(raw.mediaUrl) || raw.mediaUrl);
          }
        }
      } catch (e) {
        if (!hadLocal) console.error("Failed to load history", e);
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Connect Socket.IO
      const socketUrl = API_BASE.replace("/api", "");
      const socket = io(socketUrl, {
        auth: { token },
        transports: ["websocket"],
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        socket.emit("chat:join", { otherUserId: id });
        socket.emit("chat:read", { otherUserId: id });
      });

      socket.on("chat:message", (msg: any) => {
        if (cancelled) return;
        const incoming = mapMsg(msg, authUser.id);
        const clientMsgId = msg.clientMsgId;
        const fs = friendshipStatusRef.current;

        // WhatsApp: if I blocked them, never show their new messages
        if (fs?.iBlocked && incoming.sender === "other") {
          return;
        }

        // Never show undelivered messages on the blocked recipient's device
        if (incoming.undelivered && incoming.sender === "other") {
          return;
        }

        setMessages((prev) => {
          if (prev.some((m) => m._id === incoming._id)) return prev;

          if (clientMsgId) {
            const idx = prev.findIndex((m) => m._id === clientMsgId);
            if (idx !== -1) {
              const prevMsg = prev[idx];
              const newArr = [...prev];
              newArr[idx] = {
                ...incoming,
                // Keep local preview + view-once flag across ack
                localImageUri: prevMsg.localImageUri || incoming.localImageUri,
                localVoiceUri: prevMsg.localVoiceUri || incoming.localVoiceUri,
                mediaThumb: incoming.mediaThumb || prevMsg.mediaThumb,
                viewOnce: !!(incoming.viewOnce || prevMsg.viewOnce),
                viewOnceOpened: !!(
                  incoming.viewOnceOpened || prevMsg.viewOnceOpened
                ),
                replyTo: incoming.replyTo || prevMsg.replyTo,
              };
              return newArr;
            }
          }

          return [...prev, incoming];
        });
        if (
          incoming.sender === "other" &&
          incoming.type === "image" &&
          incoming.mediaUrl &&
          !incoming.viewOnce
        ) {
          prefetchChatImage(incoming.mediaUrl);
        }
        if (!incoming.undelivered && incoming.sender === "other") {
          socket.emit("chat:read", { otherUserId: id });
        }
      });

      socket.on("chat:image-preview", (msg: any) => {
        if (cancelled) return;
        const clientMsgId = String(msg?.clientMsgId || "");
        if (!clientMsgId) return;
        if (String(msg.senderId) === String(authUser.id)) return;
        const fs = friendshipStatusRef.current;
        if (fs?.iBlocked) return;

        if (msg.cancelled) {
          setMessages((prev) =>
            prev.filter(
              (m) =>
                !(m._id === clientMsgId && m.sender === "other" && !m.mediaUrl),
            ),
          );
          return;
        }

        const thumb =
          typeof msg.mediaThumb === "string" ? msg.mediaThumb : null;
        if (!thumb) return;

        setMessages((prev) => {
          if (prev.some((m) => m._id === clientMsgId)) {
            return prev.map((m) =>
              m._id === clientMsgId && !m.mediaThumb
                ? { ...m, mediaThumb: thumb }
                : m,
            );
          }
          const preview: ChatMsg = {
            _id: clientMsgId,
            sender: "other",
            text: "",
            type: "image",
            mediaThumb: thumb,
            localImageUri: thumb,
            createdAt: Number(msg.createdAt) || Date.now(),
            pending: false,
          };
          return [...prev, preview];
        });
      });

      socket.on(
        "chat:delivered",
        ({ messageIds, by }: { messageIds?: string[]; by?: string }) => {
          if (cancelled || !Array.isArray(messageIds) || !messageIds.length)
            return;
          if (by && String(by) !== String(id)) return;
          const idSet = new Set(messageIds.map(String));
          setMessages((prev) =>
            prev.map((m) =>
              idSet.has(m._id) && m.sender === "me"
                ? { ...m, pending: false, delivered: true, undelivered: false }
                : m,
            ),
          );
        },
      );

      socket.on(
        "chat:read",
        ({ messageIds, by }: { messageIds?: string[]; by?: string }) => {
          if (cancelled) return;
          if (by && String(by) !== String(id)) return;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.sender !== "me") return m;
              if (
                Array.isArray(messageIds) &&
                messageIds.length &&
                !messageIds.map(String).includes(m._id)
              ) {
                return m;
              }
              return {
                ...m,
                pending: false,
                delivered: true,
                read: true,
                undelivered: false,
              };
            }),
          );
        },
      );

      // Delete for everyone — sync from server / other device
      socket.on(
        "chat:deleted",
        ({ messageIds }: { messageIds?: string[]; scope?: string }) => {
          if (cancelled || !Array.isArray(messageIds) || !messageIds.length)
            return;
          const idSet = new Set(messageIds.map(String));
          setMessages((prev) =>
            prev.map((m) =>
              idSet.has(m._id)
                ? {
                    ...m,
                    isDeleted: true,
                    text: "",
                    mediaUrl: null,
                    localImageUri: undefined,
                    localVoiceUri: undefined,
                  }
                : m,
            ),
          );
          setSelectedMessages((prev) => prev.filter((mid) => !idSet.has(mid)));
        },
      );

      // Delete for me — remove from this user's chat only
      socket.on(
        "chat:deleted-for-me",
        ({ messageIds }: { messageIds?: string[] }) => {
          if (cancelled || !Array.isArray(messageIds) || !messageIds.length)
            return;
          const idSet = new Set(messageIds.map(String));
          setMessages((prev) => prev.filter((m) => !idSet.has(m._id)));
          setSelectedMessages((prev) => prev.filter((mid) => !idSet.has(mid)));
        },
      );

      socket.on(
        "chat:view-once-open",
        (payload: {
          messageId?: string;
          mediaUrl?: string | null;
          viewOnceOpened?: boolean;
          error?: string;
        }) => {
          if (cancelled || !payload?.messageId) return;
          const mid = String(payload.messageId);
          if (payload.error === "ALREADY_OPENED" || payload.error) {
            setMessages((prev) =>
              prev.map((m) =>
                m._id === mid
                  ? {
                      ...m,
                      viewOnceOpened: true,
                      mediaUrl: null,
                      localImageUri: undefined,
                    }
                  : m,
              ),
            );
            return;
          }
          const uri =
            resolveMediaUrl(payload.mediaUrl) || payload.mediaUrl || "";
          if (!uri) return;
          setFullScreenImage({ uri, messageId: mid, viewOnce: true });
          setMessages((prev) =>
            prev.map((m) =>
              m._id === mid
                ? {
                    ...m,
                    viewOnceOpened: true,
                    mediaUrl: null,
                    localImageUri: undefined,
                  }
                : m,
            ),
          );
        },
      );

      socket.on("chat:view-once-opened", (payload: { messageId?: string }) => {
        if (cancelled || !payload?.messageId) return;
        const mid = String(payload.messageId);
        setMessages((prev) =>
          prev.map((m) =>
            m._id === mid
              ? {
                  ...m,
                  viewOnceOpened: true,
                  mediaUrl: null,
                  localImageUri: undefined,
                }
              : m,
          ),
        );
      });

      socket.on("chat:error", (payload: any) => {
        console.warn("chat:error", payload?.error || payload);
        if (payload?.code === "INSUFFICIENT_TOKENS") {
          if (typeof payload.tokenBalance === "number") {
            setChatAccess((prev) =>
              prev
                ? {
                    ...prev,
                    ok: false,
                    tokenBalance: payload.tokenBalance,
                    hasActiveSession: false,
                    remainingMs: 0,
                    canChat: false,
                  }
                : null,
            );
            setRemainingMs(0);
          }
          showInsufficientTokensPopup(payload?.error || payload?.message);
        } else if (
          payload?.code === "BLOCKED_MEDIA" ||
          payload?.code === "WAITING_FOR_REPLY" ||
          payload?.code === "WAITING_FOR_REPLY_OTHER" ||
          payload?.code === "MEDIA_NOT_ALLOWED"
        ) {
          if (
            payload?.code !== "BLOCKED_MEDIA" &&
            payload?.code !== "MEDIA_NOT_ALLOWED"
          ) {
            fetchConversationStatus();
          }
          showAlert({
            title: "Cannot send message",
            message: payload?.error || payload?.message || "Message blocked",
            icon: "ban",
          });
        }
      });

      socket.on("connect_error", (err: any) => {
        console.warn("socket connect_error", err?.message || err);
      });

      socket.on("chat:typing", ({ senderId, isTyping: t }: any) => {
        if (String(senderId) === String(id)) {
          setIsTyping(t);
        }
      });

      // Track real-time online/offline status of the other user
      socket.on("user:online", ({ userId }: any) => {
        if (String(userId) !== String(id)) return;
        const fs = friendshipStatusRef.current;
        if (fs?.iBlocked || fs?.theyBlocked) {
          setOtherUserOnline(false);
          return;
        }
        setOtherUserOnline(true);
      });
      socket.on("user:offline", ({ userId }: any) => {
        if (String(userId) === String(id)) setOtherUserOnline(false);
      });
    };

    init();
    return () => {
      cancelled = true;
      // Restore pushes for this conversation (WhatsApp-style)
      try {
        socketRef.current?.emit("chat:leave", { otherUserId: id });
      } catch {
        /* ignore */
      }
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [id, sessionVersion]);

  // Also reflect global presence from SocketContext (instant, even before chat:join)
  useEffect(() => {
    if (presenceTick === 0 || !lastPresence?.userId) return;
    if (String(lastPresence.userId) !== String(id)) return;
    const fs = friendshipStatusRef.current;
    if (fs?.theyBlocked || fs?.iBlocked || privacyHidden) {
      setOtherUserOnline(false);
      return;
    }
    setOtherUserOnline(!!lastPresence.isOnline);
  }, [presenceTick, lastPresence, id, privacyHidden]);

  const dismissChatKeyboard = useCallback(() => {
    Keyboard.dismiss();
    inputRef.current?.blur();
  }, []);

  const handleTyping = (text: string) => {
    setInputText(text);

    const hasTrimmedText = text.trim().length > 0;
    // Throttle typing socket emits (WhatsApp doesn't spam every keystroke)
    if (hasTrimmedText) {
      const now = Date.now();
      if (now - lastTypingEmitAt.current > 900) {
        lastTypingEmitAt.current = now;
        socketRef.current?.emit("chat:typing", {
          receiverId: id,
          isTyping: true,
        });
      }
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        socketRef.current?.emit("chat:typing", {
          receiverId: id,
          isTyping: false,
        });
      }, 1200);
    } else {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      socketRef.current?.emit("chat:typing", {
        receiverId: id,
        isTyping: false,
      });
    }
  };

  // Upload image as raw bytes (faster than base64 JSON)
  const uploadImage = async (uri: string): Promise<string | null> => {
    try {
      const token = await getAuthToken();
      if (!token) return null;
      const ext = uri.split(".").pop()?.toLowerCase()?.split("?")[0] || "jpg";
      const mimeType =
        ext === "png"
          ? "image/png"
          : ext === "gif"
            ? "image/gif"
            : ext === "webp"
              ? "image/webp"
              : "image/jpeg";
      const url = `${API_BASE}/api/upload/image-bin`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": mimeType,
      };

      if (Platform.OS !== "web" && FileSystem.uploadAsync) {
        const result = await FileSystem.uploadAsync(url, uri, {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers,
          sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        });
        if (result.status >= 200 && result.status < 300 && result.body) {
          const json = JSON.parse(result.body);
          return json.url || json.absoluteUrl || null;
        }
        console.error("Image upload failed", result.status, result.body);
        return null;
      }

      const blobRes = await fetch(uri);
      const blob = await blobRes.blob();
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: blob,
      });
      const json = await res.json();
      if (!res.ok) {
        console.error("Image upload failed", json?.error || res.status);
        return null;
      }
      return json.url || json.absoluteUrl || null;
    } catch (e) {
      console.error("Image upload failed", e);
      return null;
    }
  };

  const sendMessage = async () => {
    const trimmedText = inputText.trim();
    if ((!trimmedText && !selectedImage) || !socketRef.current) return;

    // Local gates only — no network wait before the bubble appears (WhatsApp-feel)
    if (
      chatAccess &&
      !chatAccess.unlimitedChat &&
      !chatAccess.hasActiveSession &&
      chatAccess.canChat === false
    ) {
      showInsufficientTokensPopup();
      return;
    }

    if (friendshipStatus?.iBlocked) {
      showAlert({
        title: "Cannot send message",
        message: "Unblock this person to send messages.",
        icon: "ban",
      });
      return;
    }

    if (!conversationStatus.canSend && !friendshipStatus?.theyBlocked) {
      showAlert({
        title: "Cannot send message",
        message:
          conversationStatus.message ||
          "You've reached the message limit. Please wait for a reply.",
        icon: "hand-left",
      });
      return;
    }

    // They blocked you: text only (undelivered single tick)
    if (friendshipStatus?.theyBlocked && selectedImage) {
      showAlert({
        title: "Text only",
        message: "Only text messages can be sent right now.",
        icon: "ban",
      });
      return;
    }

    // Start/refresh session in background if needed
    if (!chatAccess?.unlimitedChat && !chatAccess?.hasActiveSession) {
      void requireChatAccess();
    }

    if (selectedImage) {
      const localUri = selectedImage.uri;
      setSelectedImage(null);
      void sendImageFromUri(localUri);
    }

    if (trimmedText) {
      const optId = `opt-${Date.now()}`;
      const isBlockedChat = !!friendshipStatus?.theyBlocked;
      const optText: ChatMsg = {
        _id: optId,
        sender: "me",
        text: trimmedText,
        type: "text",
        createdAt: Date.now(),
        replyTo: sanitizeReplyQuote(replyingTo),
        pending: true,
        undelivered: isBlockedChat,
        delivered: !isBlockedChat && otherUserOnline,
        read: false,
      };

      // Clear input and bubble in the same frame (WhatsApp)
      setInputText("");
      setMessages((prev) => [...prev, optText]);
      bumpChatPreview({
        otherUserId: String(id),
        lastMessage: trimmedText,
        fromMe: true,
        resetUnread: true,
        name: displayName,
        photo: displayPhoto,
        gender: displayGender,
      });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      socketRef.current.emit("chat:message", {
        receiverId: id,
        text: trimmedText,
        type: "text",
        replyTo: replyTargetId(replyingTo),
        clientMsgId: optId,
      });
    }

    setReplyingTo(null);
    socketRef.current.emit("chat:typing", { receiverId: id, isTyping: false });
  };

  const sendImageFromUri = async (localUri: string, viewOnce = false) => {
    if (!localUri || !socketRef.current) return;
    setSendingPhoto(true);

    if (
      chatAccess &&
      !chatAccess.unlimitedChat &&
      !chatAccess.hasActiveSession &&
      chatAccess.canChat === false
    ) {
      setSendingPhoto(false);
      showInsufficientTokensPopup();
      return;
    }

    if (friendshipStatus?.iBlocked) {
      setSendingPhoto(false);
      showAlert({
        title: "Cannot send message",
        message: "Unblock this person to send messages.",
        icon: "ban",
      });
      return;
    }

    if (friendshipStatus?.theyBlocked) {
      setSendingPhoto(false);
      showAlert({
        title: "Text only",
        message: "Only text messages can be sent right now.",
        icon: "ban",
      });
      return;
    }

    if (!conversationStatus.canSend) {
      setSendingPhoto(false);
      showAlert({
        title: "Cannot send message",
        message:
          conversationStatus.message ||
          "You've reached the message limit. Please wait for a reply.",
        icon: "hand-left",
      });
      return;
    }

    if (!isMatched) {
      setSendingPhoto(false);
      showAlert({
        title: "Friends only",
        message: "Photos unlock when you both like each other.",
        icon: "image",
      });
      return;
    }

    if (!chatAccess?.unlimitedChat && !chatAccess?.hasActiveSession) {
      void requireChatAccess();
    }

    const optId = `opt-img-${Date.now()}`;
    rememberLoadedImage(localUri);
    const reply = sanitizeReplyQuote(replyingTo);
    const optImg: ChatMsg = {
      _id: optId,
      sender: "me",
      text: "",
      type: "image",
      localImageUri: localUri,
      createdAt: Date.now(),
      replyTo: reply,
      pending: true,
      delivered: otherUserOnline,
      read: false,
      viewOnce: !!viewOnce,
      viewOnceOpened: false,
    };
    setPendingPhoto(null);
    setSendingPhoto(false);
    setMessages((prev) => [...prev, optImg]);
    setReplyingTo(null);
    socketRef.current.emit("chat:typing", { receiverId: id, isTyping: false });

    try {
      const thumbPromise = viewOnce
        ? Promise.resolve(undefined)
        : makeChatThumb(localUri);
      const uploadUriPromise = compressChatImage(localUri);

      const thumb = await thumbPromise;
      if (thumb && !viewOnce) {
        rememberLoadedImage(thumb);
        setMessages((prev) =>
          prev.map((m) => (m._id === optId ? { ...m, mediaThumb: thumb } : m)),
        );
        socketRef.current?.emit("chat:image-preview", {
          receiverId: id,
          clientMsgId: optId,
          mediaThumb: thumb,
          viewOnce: false,
        });
      }

      const uploadUri = await uploadUriPromise;
      const uploadedUrl = await uploadImage(uploadUri);
      if (uploadedUrl && socketRef.current) {
        const resolved = resolveMediaUrl(uploadedUrl) || uploadedUrl;
        rememberLoadedImage(localUri, resolved, uploadedUrl);
        setMessages((prev) =>
          prev.map((m) =>
            m._id === optId
              ? {
                  ...m,
                  mediaUrl: resolved,
                  localImageUri: localUri,
                  pending: true,
                  viewOnce: !!viewOnce,
                  mediaThumb: thumb || m.mediaThumb,
                }
              : m,
          ),
        );
        socketRef.current.emit("chat:message", {
          receiverId: id,
          text: "",
          type: "image",
          mediaUrl: uploadedUrl,
          mediaThumb: viewOnce ? undefined : thumb,
          replyTo: replyTargetId(reply),
          clientMsgId: optId,
          viewOnce: !!viewOnce,
        });
      } else {
        if (!viewOnce) {
          socketRef.current?.emit("chat:image-preview", {
            receiverId: id,
            clientMsgId: optId,
            cancelled: true,
          });
        }
        setMessages((prev) =>
          prev.map((m) =>
            m._id === optId
              ? { ...m, pending: false, text: "Image failed to send" }
              : m,
          ),
        );
      }
    } catch (e) {
      console.error("Send image failed", e);
      if (!viewOnce) {
        socketRef.current?.emit("chat:image-preview", {
          receiverId: id,
          clientMsgId: optId,
          cancelled: true,
        });
      }
      setMessages((prev) =>
        prev.map((m) =>
          m._id === optId
            ? { ...m, pending: false, text: "Image failed to send" }
            : m,
        ),
      );
    }
  };

  const confirmSendPhoto = (uri: string) => {
    setPendingViewOnce(false);
    setTimeout(
      () => setPendingPhoto({ uri }),
      Platform.OS === "ios" ? 350 : 120,
    );
  };

  const pickImage = async () => {
    if (!isMatched) {
      showAlert({
        title: "Friends only",
        message: "Photos unlock when you both like each other.",
        icon: "image",
      });
      return;
    }

    Keyboard.dismiss();
    inputRef.current?.blur();

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: false,
      quality: 0.6,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;

    confirmSendPhoto(result.assets[0].uri);
  };

  const takePhoto = async () => {
    if (!isMatched) {
      showAlert({
        title: "Friends only",
        message: "Photos unlock when you both like each other.",
        icon: "image",
      });
      return;
    }

    Keyboard.dismiss();
    inputRef.current?.blur();

    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) {
      showAlert({
        title: "Camera permission",
        message: "Allow camera access to take and send photos.",
        icon: "camera",
      });
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: "images",
      allowsEditing: false,
      quality: 0.6,
      cameraType: ImagePicker.CameraType.back,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;

    confirmSendPhoto(result.assets[0].uri);
  };

  const fmtDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  };

  // Upload voice note to server; returns relative /uploads/... path
  const uploadAudio = async (uri: string): Promise<string | null> => {
    try {
      const token = await getAuthToken();
      if (!token) return null;
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const ext = uri.split(".").pop()?.toLowerCase()?.split("?")[0] || "m4a";
      const mimeType =
        ext === "mp3"
          ? "audio/mpeg"
          : ext === "wav"
            ? "audio/wav"
            : ext === "3gp"
              ? "audio/3gpp"
              : ext === "caf"
                ? "audio/x-caf"
                : ext === "ogg"
                  ? "audio/ogg"
                  : "audio/m4a";
      const dataUri = `data:${mimeType};base64,${base64}`;

      const res = await fetch(`${API_BASE}/api/upload/audio`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ base64: dataUri }),
      });
      const json = await res.json();
      if (!res.ok) {
        console.error("Audio upload failed", json?.error || res.status);
        return null;
      }
      return json.url || null;
    } catch (e) {
      console.error("Audio upload failed", e);
      return null;
    }
  };

  async function startRecording() {
    // Block audio for non-friends (Friends & Match feature)
    if (!isMatched) {
      showAlert({
        title: "Friends Only",
        message: "Voice messages unlock when you both like each other.",
        icon: "people",
      });
      return;
    }

    const keepKeyboard = isKeyboardVisible;

    const perm = await Audio.getPermissionsAsync();
    if (perm.status !== "granted") {
      const np = await Audio.requestPermissionsAsync();
      if (np.status !== "granted") return;
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
    );
    setRecording(recording);
    setIsRecording(true);
    setRecordingDuration(0);
    recording.setOnRecordingStatusUpdate((s) => {
      if (s.isRecording) setRecordingDuration(s.durationMillis);
    });

    if (keepKeyboard) {
      requestAnimationFrame(() => inputRef.current?.focus());
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }

  async function stopRecording() {
    if (!recording) return;
    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    const uri = recording.getURI();
    setRecording(null);
    setRecordingDuration(0);
    if (!uri) return;

    const allowed = await requireChatAccess();
    if (!allowed) return;

    const optId = `voice-${Date.now()}`;
    const reply = sanitizeReplyQuote(replyingTo);
    setReplyingTo(null);
    setMessages((prev) => [
      ...prev,
      {
        _id: optId,
        sender: "me",
        text: "",
        type: "audio",
        localVoiceUri: uri,
        createdAt: Date.now(),
        replyTo: reply,
        pending: true,
        delivered: otherUserOnline,
        read: false,
      },
    ]);

    const uploadedUrl = await uploadAudio(uri);
    if (uploadedUrl && socketRef.current) {
      const resolved = resolveMediaUrl(uploadedUrl) || uploadedUrl;
      setMessages((prev) =>
        prev.map((m) =>
          m._id === optId
            ? { ...m, mediaUrl: resolved, localVoiceUri: uri, pending: true }
            : m,
        ),
      );
      socketRef.current.emit("chat:message", {
        receiverId: id,
        text: "",
        type: "audio",
        mediaUrl: uploadedUrl,
        replyTo: replyTargetId(reply),
        clientMsgId: optId,
      });
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === optId
            ? { ...m, pending: false, text: "Voice failed to send" }
            : m,
        ),
      );
    }
  }

  async function cancelRecording() {
    if (!recording) return;
    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    setRecording(null);
    setRecordingDuration(0);
  }

  const deleteSelected = () => {
    const selected = messages.filter((m) => selectedMessages.includes(m._id));
    if (!selected.length) return;

    const mine = selected.filter((m) => m.sender === "me" && !m.isDeleted);
    const others = selected.filter((m) => m.sender !== "me" && !m.isDeleted);
    const onlyMine = others.length === 0 && mine.length > 0;

    const persistableIds = (list: ChatMsg[]) =>
      list
        .map((m) => m._id)
        .filter(
          (mid) =>
            mid &&
            !String(mid).startsWith("opt-") &&
            !String(mid).startsWith("voice-"),
        );

    const applyDeleteForMe = async (targets: ChatMsg[]) => {
      const idSet = new Set(targets.map((m) => m._id));
      setMessages((prev) => prev.filter((m) => !idSet.has(m._id)));
      setSelectedMessages([]);
      const ids = persistableIds(targets);
      if (!ids.length) return;
      try {
        if (socketRef.current?.connected) {
          socketRef.current.emit("chat:delete", {
            messageIds: ids,
            scope: "me",
          });
        } else {
          const token = await getAuthToken();
          if (token) {
            await apiRequest("/api/chat/delete", token, {
              method: "POST",
              body: JSON.stringify({ messageIds: ids, scope: "me" }),
            });
          }
        }
      } catch (e) {
        console.error("Failed to delete for me", e);
        showAlert({
          title: "Delete failed",
          message: "Could not delete messages. Please try again.",
          icon: "alert-circle",
        });
      }
    };

    const applyDeleteForEveryone = async (targets: ChatMsg[]) => {
      const idSet = new Set(targets.map((m) => m._id));
      setMessages((prev) =>
        prev.map((m) =>
          idSet.has(m._id)
            ? {
                ...m,
                isDeleted: true,
                text: "",
                mediaUrl: null,
                localImageUri: undefined,
                localVoiceUri: undefined,
              }
            : m,
        ),
      );
      setSelectedMessages([]);
      const ids = persistableIds(targets);
      if (!ids.length) return;
      try {
        if (socketRef.current?.connected) {
          socketRef.current.emit("chat:delete", {
            messageIds: ids,
            scope: "everyone",
          });
        } else {
          const token = await getAuthToken();
          if (token) {
            await apiRequest("/api/chat/delete", token, {
              method: "POST",
              body: JSON.stringify({ messageIds: ids, scope: "everyone" }),
            });
          }
        }
      } catch (e) {
        console.error("Failed to delete for everyone", e);
        showAlert({
          title: "Delete failed",
          message: "Could not delete for everyone. Please try again.",
          icon: "alert-circle",
        });
      }
    };

    if (onlyMine) {
      showAlert({
        title: "Delete message?",
        message:
          mine.length > 1
            ? `Delete ${mine.length} messages from this chat?`
            : undefined,
        icon: "trash",
        buttons: [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete for me",
            onPress: () => {
              void applyDeleteForMe(mine);
            },
          },
          {
            text: "Delete for everyone",
            style: "destructive",
            onPress: () => {
              void applyDeleteForEveryone(mine);
            },
          },
        ],
      });
      return;
    }

    // Others' messages (or mix): only delete from my chat — like WhatsApp
    showAlert({
      title: "Delete message?",
      message: undefined,
      icon: "trash",
      buttons: [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete for me",
          style: "destructive",
          onPress: () => {
            void applyDeleteForMe(selected.filter((m) => !m.isDeleted));
          },
        },
      ],
    });
  };

  const avatarName = getDisplayName(displayName);

  return (
    <GestureHandlerRootView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={["top"]} style={{ backgroundColor: "#fff" }}>
        {selectionMode ? (
          <View style={styles.selectionHeader}>
            <View style={styles.selectionHeaderLeft}>
              <TouchableOpacity
                onPress={() => setSelectedMessages([])}
                style={styles.backButton}
              >
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.selectionCountText}>
                {selectedMessages.length} selected
              </Text>
            </View>
            <TouchableOpacity
              onPress={deleteSelected}
              style={styles.actionButton}
            >
              <Ionicons name="trash-outline" size={24} color="#ff4444" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons name="chevron-back" size={28} color="#333" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.userInfo}
              activeOpacity={0.8}
              onPress={async () => {
                const seedPhoto =
                  resolveMediaUrl(displayPhoto) || displayPhoto || "";
                setProfileUser({
                  id: String(id),
                  name: displayName || "User",
                  age: profileUser?.age || 0,
                  bio: displayBio || profileUser?.bio || "",
                  photo: seedPhoto,
                  photos:
                    profileUser?.photos?.length
                      ? profileUser.photos
                      : seedPhoto
                        ? [seedPhoto]
                        : [],
                  gender: displayGender || "",
                  height: profileUser?.height,
                  interests: profileUser?.interests || [],
                  publicId: profileUser?.publicId,
                  isOnline: otherUserOnline,
                  friendshipStatus: friendshipStatus?.status,
                  areFriends: friendshipStatus?.areFriends,
                  iLiked: friendshipStatus?.iLiked,
                  theyLiked: friendshipStatus?.theyLiked,
                });
                setProfileModalVisible(true);
                try {
                  const token = await getAuthToken();
                  if (!token || !id) return;
                  const { user } = await fetchUserProfile(token, String(id));
                  if (user) {
                    setProfileUser({
                      ...user,
                      photo: user.photo || seedPhoto,
                      isOnline: otherUserOnline,
                      friendshipStatus: friendshipStatus?.status,
                      areFriends: friendshipStatus?.areFriends,
                      iLiked: friendshipStatus?.iLiked,
                      theyLiked: friendshipStatus?.theyLiked,
                    });
                  }
                } catch {
                  /* best-effort */
                }
              }}
            >
              <View style={styles.avatarContainer}>
                <WhatsAppAvatar
                  photo={resolveMediaUrl(displayPhoto) || displayPhoto}
                  name={displayName}
                  size={40}
                  online={
                    !privacyHidden &&
                    !friendshipStatus?.theyBlocked &&
                    !friendshipStatus?.iBlocked &&
                    otherUserOnline
                  }
                  privacyHidden={
                    !!privacyHidden || !!friendshipStatus?.theyBlocked
                  }
                />
              </View>
              <View>
                <Text style={styles.userName}>{avatarName}</Text>
                <Text
                  style={[
                    styles.userStatus,
                    (!isTyping && !otherUserOnline) ||
                    friendshipStatus?.theyBlocked ||
                    friendshipStatus?.iBlocked
                      ? { color: "#999" }
                      : null,
                  ]}
                >
                  {friendshipStatus?.theyBlocked || friendshipStatus?.iBlocked
                    ? "Offline"
                    : isTyping
                      ? "Typing..."
                      : otherUserOnline
                        ? "Online"
                        : "Offline"}
                </Text>
              </View>
            </TouchableOpacity>
            <View style={styles.headerActions}>
              {(() => {
                const canCall =
                  isMatched &&
                  !friendshipStatus?.iBlocked &&
                  !friendshipStatus?.theyBlocked;
                const iconColor = canCall ? "#111B21" : "#B0B0B0";
                const startCall = (callType: "voice" | "video") => {
                  if (!canCall) {
                    showAlert({
                      title: "Friends only",
                      message:
                        "Voice and video calls unlock when you both like each other.",
                      icon: callType === "video" ? "videocam" : "call",
                    });
                    return;
                  }
                  void startMediaCall({
                    userId: String(id),
                    name:
                      (displayName &&
                      displayName !== "User" &&
                      displayName.toLowerCase() !== "unknown"
                        ? displayName
                        : "") ||
                      profileUser?.name ||
                      profileUser?.publicId ||
                      avatarName,
                    photo:
                      resolveMediaUrl(displayPhoto) ||
                      displayPhoto ||
                      resolveMediaUrl(profileUser?.photo) ||
                      profileUser?.photo ||
                      "",
                    gender: displayGender || profileUser?.gender || "",
                    publicId: profileUser?.publicId || "",
                    callType,
                  });
                };
                return (
                  <>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => startCall("voice")}
                      hitSlop={8}
                      activeOpacity={canCall ? 0.6 : 1}
                      accessibilityRole="button"
                      accessibilityLabel="Voice call"
                      accessibilityState={{ disabled: !canCall }}
                    >
                      <Ionicons
                        name="call-outline"
                        size={22}
                        color={iconColor}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => startCall("video")}
                      hitSlop={8}
                      activeOpacity={canCall ? 0.6 : 1}
                      accessibilityRole="button"
                      accessibilityLabel="Video call"
                      accessibilityState={{ disabled: !canCall }}
                    >
                      <Ionicons
                        name="videocam-outline"
                        size={22}
                        color={iconColor}
                      />
                    </TouchableOpacity>
                  </>
                );
              })()}
              <View
                ref={moreBtnRef}
                collapsable={false}
                onLayout={computeMenuPosition}
              >
                <Pressable
                  style={styles.actionButton}
                  onTouchStart={() => {
                    keyboardWasOpenRef.current = isKeyboardVisible;
                    openChatMenu();
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="More options"
                >
                  <Ionicons
                    name="ellipsis-vertical"
                    size={22}
                    color="#111B21"
                  />
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>

      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {messages.length === 0 && !loading && (
          <View style={styles.emptyChatBanner}>
            <Text style={styles.emptyChatText}>
              No messages yet. Say hi! 👋
            </Text>
          </View>
        )}
        {loading && messages.length === 0 ? (
          <ChatThreadSkeleton />
        ) : (
          <FlatList
            style={styles.messagesFlatList}
            ref={flatListRef}
            data={listData}
            inverted
            renderItem={({ item }) => (
              <MessageItem
                item={item}
                onReply={handleReplyToMessage}
                onJumpToReply={jumpToRepliedMessage}
                onImagePress={handleImagePress}
                onViewOnceOpen={openViewOncePhoto}
                onToggleSelect={handleToggleSelect}
                isSelected={selectedMessages.includes(item._id)}
                selectionMode={selectionMode}
                highlighted={highlightedMessageId === item._id}
                otherName={displayName || "User"}
              />
            )}
            keyExtractor={(item) => item._id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            onScrollBeginDrag={dismissChatKeyboard}
            onTouchStart={(e) => {
              chatTouchStartRef.current = {
                x: e.nativeEvent.pageX,
                y: e.nativeEvent.pageY,
              };
            }}
            onTouchEnd={(e) => {
              const start = chatTouchStartRef.current;
              chatTouchStartRef.current = null;
              if (!start || !isKeyboardVisible) return;
              const dx = Math.abs(e.nativeEvent.pageX - start.x);
              const dy = Math.abs(e.nativeEvent.pageY - start.y);
              if (dx < 12 && dy < 12) dismissChatKeyboard();
            }}
            removeClippedSubviews={false}
            initialNumToRender={18}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
            windowSize={11}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0.35,
                });
              }, 120);
            }}
            maintainVisibleContentPosition={{
              minIndexForVisible: 0,
              autoscrollToTopThreshold: 80,
            }}
            ListHeaderComponent={
              isTyping ? (
                <View style={styles.messageRow}>
                  <View style={[styles.messageContainer, styles.otherMessage]}>
                    <View
                      style={[
                        styles.messageBubble,
                        styles.otherBubbleBorder,
                        styles.typingBubble,
                      ]}
                    >
                      <TypingDots />
                    </View>
                  </View>
                </View>
              ) : (
                <View style={{ height: 4 }} />
              )
            }
          />
        )}

        <View style={styles.composerAccessoryDock}>
          {friendshipStatus?.iBlocked && (
            <View style={styles.youBlockedBar}>
              <Text style={styles.youBlockedText}>
                You blocked this person
                {friendshipStatus.blockedAt
                  ? ` on ${new Date(
                      friendshipStatus.blockedAt,
                    ).toLocaleDateString([], {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}`
                  : ""}
              </Text>
            </View>
          )}

          {!friendshipStatus?.iBlocked &&
            !friendshipStatus?.theyBlocked &&
            conversationStatus.consecutiveCount >= 8 &&
            conversationStatus.consecutiveCount < 10 && (
              <View style={styles.warningBar}>
                <Ionicons name="warning" size={16} color="#ff9800" />
                <Text style={styles.warningText}>
                  {10 - conversationStatus.consecutiveCount} message
                  {10 - conversationStatus.consecutiveCount === 1
                    ? ""
                    : "s"}{" "}
                  left before waiting for reply
                </Text>
              </View>
            )}
          {!friendshipStatus?.iBlocked &&
            !friendshipStatus?.theyBlocked &&
            !conversationStatus.canSend &&
            conversationStatus.code === "WAITING_FOR_REPLY" && (
              <View style={styles.blockedBar}>
                <Ionicons name="hand-left" size={16} color="#f44336" />
                <Text style={styles.blockedText}>
                  Please wait for the other user to reply before sending more
                  messages
                </Text>
              </View>
            )}
          {!friendshipStatus?.iBlocked &&
            !friendshipStatus?.theyBlocked &&
            !conversationStatus.canSend &&
            conversationStatus.code === "WAITING_FOR_REPLY_OTHER" && (
              <View style={styles.blockedBar}>
                <Ionicons name="hand-left" size={16} color="#f44336" />
                <Text style={styles.blockedText}>
                  You cannot start new conversations while waiting for a reply
                  in another chat
                </Text>
              </View>
            )}
        </View>

        <View style={styles.composerDock}>
          {replyingTo && (
            <View style={styles.replyingToContainer}>
              <View style={styles.replyingToAccent} />
              <View style={styles.replyingToContent}>
                <Text style={styles.replyingToName}>
                  {replyingTo.sender === "me" ? "You" : displayName || "User"}
                </Text>
                <Text style={styles.replyingToText} numberOfLines={1}>
                  {replyPreviewLabel(replyingTo)}
                </Text>
              </View>
              {replyingTo.viewOnce ? (
                <View style={styles.replyingToViewOnceThumb}>
                  <Ionicons name="eye-off" size={18} color="#6750A4" />
                </View>
              ) : isAudioReply(replyingTo) ? (
                <View style={styles.replyingToViewOnceThumb}>
                  <Ionicons name="mic" size={18} color="#6750A4" />
                </View>
              ) : replyThumbUri(replyingTo) ? (
                <RNImage
                  source={{ uri: replyThumbUri(replyingTo)! }}
                  style={styles.replyingToThumb}
                  resizeMode="cover"
                  fadeDuration={0}
                />
              ) : null}
              <TouchableOpacity
                onPress={() => setReplyingTo(null)}
                style={styles.cancelReplyingToButton}
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color="#667781" />
              </TouchableOpacity>
            </View>
          )}

          {selectedImage && (
            <View style={styles.imagePreviewContainer}>
              <Image
                source={{ uri: selectedImage.uri }}
                style={styles.imagePreview}
                contentFit="cover"
              />
              <TouchableOpacity
                onPress={() => setSelectedImage(null)}
                style={styles.cancelImageButton}
              >
                <Ionicons name="close-circle" size={24} color="#ff4444" />
              </TouchableOpacity>
            </View>
          )}

          {friendshipStatus?.iBlocked ? (
            <View style={[styles.inputContainer, { justifyContent: "center" }]}>
              <Text style={styles.composerDisabledHint}>
                Messaging is unavailable
              </Text>
            </View>
          ) : (
            <View style={styles.composerWrap}>
              <View style={styles.inputContainer}>
                <TouchableOpacity
                  onPress={() => {
                    if (!isMatched || friendshipStatus?.theyBlocked) {
                      showAlert({
                        title: "Friends only",
                        message: "Photos unlock when you both like each other.",
                        icon: "image",
                      });
                      return;
                    }
                    void pickImage();
                  }}
                  style={styles.attachButton}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={
                    isMatched && !friendshipStatus?.theyBlocked ? 0.6 : 1
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Attach photo"
                  accessibilityState={{
                    disabled: !isMatched || !!friendshipStatus?.theyBlocked,
                  }}
                >
                  <Ionicons
                    name="add-circle"
                    size={ATTACH_ICON}
                    color={
                      isMatched && !friendshipStatus?.theyBlocked
                        ? "#111B21"
                        : "#B0B0B0"
                    }
                  />
                </TouchableOpacity>

                <View style={styles.composerCenter}>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      ref={inputRef}
                      style={[
                        styles.input,
                        isRecording && styles.inputWhileRecording,
                      ]}
                      placeholder="Message"
                      placeholderTextColor="#999"
                      value={inputText}
                      onChangeText={handleTyping}
                      multiline
                      textAlignVertical="center"
                      blurOnSubmit={false}
                      returnKeyType="default"
                      enablesReturnKeyAutomatically={false}
                      showSoftInputOnFocus
                    />
                  </View>

                  {isRecording && (
                    <View
                      style={styles.recordingOverlay}
                      pointerEvents="box-none"
                    >
                      <View style={styles.recordingWrapper}>
                        <View style={styles.recordingIndicatorContainer}>
                          <View style={styles.recordingDot} />
                          <Text style={styles.recordingTime}>
                            {fmtDuration(recordingDuration)}
                          </Text>
                        </View>
                        <Text style={styles.recordingText} numberOfLines={1}>
                          Recording...
                        </Text>
                        <TouchableOpacity
                          onPress={cancelRecording}
                          style={styles.deleteRecordingButton}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={INPUT_ICON}
                            color="#ff4444"
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>

                {!showSendIcon && !isRecording ? (
                  <TouchableOpacity
                    onPress={() => {
                      if (!isMatched || friendshipStatus?.theyBlocked) {
                        showAlert({
                          title: friendshipStatus?.theyBlocked
                            ? "Text only"
                            : "Friends only",
                          message: friendshipStatus?.theyBlocked
                            ? "Only text messages can be sent right now."
                            : "Photos unlock when you both like each other.",
                          icon: friendshipStatus?.theyBlocked
                            ? "ban"
                            : "camera",
                        });
                        return;
                      }
                      void takePhoto();
                    }}
                    style={styles.cameraButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={
                      isMatched && !friendshipStatus?.theyBlocked ? 0.6 : 1
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Take photo"
                  >
                    <Ionicons
                      name="camera"
                      size={ATTACH_ICON}
                      color={
                        isMatched && !friendshipStatus?.theyBlocked
                          ? "#54656F"
                          : "#B0B0B0"
                      }
                    />
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  onPress={
                    showSendIcon
                      ? sendMessage
                      : isRecording
                        ? stopRecording
                        : friendshipStatus?.theyBlocked
                          ? () =>
                              showAlert({
                                title: "Text only",
                                message:
                                  "Only text messages can be sent right now.",
                                icon: "ban",
                              })
                          : startRecording
                  }
                  style={[
                    styles.sendButton,
                    !conversationStatus.canSend &&
                      !friendshipStatus?.theyBlocked &&
                      styles.sendButtonDisabled,
                  ]}
                  activeOpacity={0.6}
                  disabled={
                    !conversationStatus.canSend &&
                    !friendshipStatus?.theyBlocked &&
                    !isRecording
                  }
                  delayPressIn={0}
                  onPressIn={() => {
                    if (!showSendIcon && !isRecording) {
                      inputRef.current?.focus();
                    }
                  }}
                >
                  <LinearGradient
                    colors={[...LUVSTOR_GRADIENT]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.sendButtonGradient}
                  >
                    <Ionicons
                      name={
                        showSendIcon
                          ? "send"
                          : isRecording
                            ? "stop"
                            : friendshipStatus?.theyBlocked
                              ? "send"
                              : "mic"
                      }
                      size={INPUT_ICON - 3}
                      color="#fff"
                    />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <Reanimated.View
            style={[styles.composerSafeSpacer, safeSpacerStyle]}
          />
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!fullScreenImage} transparent animationType="fade">
        <View style={styles.fullScreenContainer}>
          <TouchableOpacity
            style={styles.closeFullScreenButton}
            onPress={closeFullScreenImage}
          >
            <Ionicons name="close" size={32} color="#fff" />
          </TouchableOpacity>
          {fullScreenImage?.viewOnce ? (
            <View style={styles.viewOnceFullBadge}>
              <Ionicons name="eye" size={14} color="#fff" />
              <Text style={styles.viewOnceFullBadgeText}>View once</Text>
            </View>
          ) : null}
          {fullScreenImage ? (
            <WhatsAppFullScreenPhoto uri={fullScreenImage.uri} />
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={!!pendingPhoto}
        transparent
        animationType="fade"
        onRequestClose={() => !sendingPhoto && setPendingPhoto(null)}
      >
        <View style={styles.pendingPhotoOverlay}>
          <View style={styles.pendingPhotoTopBar}>
            <TouchableOpacity
              onPress={() => !sendingPhoto && setPendingPhoto(null)}
              hitSlop={10}
              disabled={sendingPhoto}
              style={styles.pendingPhotoCloseBtn}
            >
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>

          {pendingPhoto?.uri ? (
            <Image
              source={{ uri: pendingPhoto.uri }}
              style={styles.pendingPhotoFull}
              contentFit="contain"
            />
          ) : null}

          {/* WhatsApp-style bottom bar: eye toggle + send */}
          <View style={styles.pendingPhotoBar}>
            <TouchableOpacity
              onPress={() => setPendingViewOnce((v) => !v)}
              disabled={sendingPhoto}
              style={[
                styles.pendingEyeBtn,
                pendingViewOnce && styles.pendingEyeBtnOn,
              ]}
              hitSlop={8}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={
                pendingViewOnce ? "View once on" : "View once off"
              }
            >
              <Ionicons
                name={pendingViewOnce ? "eye" : "eye-outline"}
                size={22}
                color={pendingViewOnce ? "#fff" : "#E9EDEF"}
              />
              <View
                style={[
                  styles.pendingEyeBadge,
                  pendingViewOnce && styles.pendingEyeBadgeOn,
                ]}
              >
                <Text style={styles.pendingEyeBadgeText}>1</Text>
              </View>
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            <TouchableOpacity
              style={styles.pendingSendCircle}
              disabled={sendingPhoto}
              onPress={() =>
                pendingPhoto &&
                void sendImageFromUri(pendingPhoto.uri, pendingViewOnce)
              }
              activeOpacity={0.85}
            >
              {sendingPhoto ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="send" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* WhatsApp-style chat overflow menu — always mounted for instant open */}
      <View
        ref={menuOverlayRef}
        style={[
          styles.chatMenuOverlay,
          {
            opacity: menuOpen ? 1 : 0,
            pointerEvents: menuOpen ? "box-none" : "none",
          },
        ]}
        collapsable={false}
      >
        <Pressable
          style={styles.chatMenuBackdrop}
          onPress={() => {
            if (menuOpenGuardRef.current) return;
            closeChatMenu();
          }}
        >
          <View
            style={[
              styles.chatMenuCard,
              {
                top: menuPos.top,
                right: menuPos.right,
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            {(() => {
              const blocked =
                friendshipStatus?.status === "blocked" ||
                !!friendshipStatus?.iBlocked;
              const liked =
                !!friendshipStatus?.areFriends || !!friendshipStatus?.iLiked;
              return (
                <>
                  {!blocked && (
                    <>
                      <TouchableOpacity
                        style={styles.chatMenuItem}
                        onPress={handleMenuLike}
                        activeOpacity={0.55}
                        disabled={likingHeader}
                      >
                        <Text style={styles.chatMenuText}>
                          {liked ? "Unlike" : "Like"}
                        </Text>
                      </TouchableOpacity>
                      <View style={styles.chatMenuDivider} />
                    </>
                  )}
                  <TouchableOpacity
                    style={styles.chatMenuItem}
                    onPress={handleMuteChat}
                    activeOpacity={0.55}
                  >
                    <Text style={styles.chatMenuText}>
                      {chatMuted ? "Unmute" : "Mute"}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.chatMenuDivider} />
                  <TouchableOpacity
                    style={styles.chatMenuItem}
                    onPress={handleReportUser}
                    activeOpacity={0.55}
                  >
                    <Text style={styles.chatMenuText}>Report</Text>
                  </TouchableOpacity>
                  <View style={styles.chatMenuDivider} />
                  <TouchableOpacity
                    style={styles.chatMenuItem}
                    onPress={
                      friendshipStatus?.iBlocked
                        ? () =>
                            closeChatMenu(async () => {
                              try {
                                const token = await getAuthToken();
                                if (!token || !id) return;
                                await unblockUser(token, String(id));
                                await fetchFriendshipStatus();
                                showAlert({
                                  title: "User unblocked",
                                  message: "You can message them again.",
                                  icon: "checkmark-circle",
                                });
                              } catch (e: any) {
                                showAlert({
                                  title: "Could not unblock",
                                  message: e?.message || "Please try again.",
                                  icon: "alert-circle",
                                });
                              }
                            })
                        : handleBlockUser
                    }
                    activeOpacity={0.55}
                  >
                    <Text style={[styles.chatMenuText, styles.chatMenuDanger]}>
                      {friendshipStatus?.iBlocked ? "Unblock" : "Block"}
                    </Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </Pressable>
      </View>

      {/* Report reason picker */}
      <Modal
        visible={reportOpen}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => closeReportSheet()}
      >
        <View style={styles.reportBackdrop}>
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              {
                backgroundColor: "rgba(11, 20, 26, 0.42)",
                opacity: reportAnim,
              },
            ]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => closeReportSheet()}
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.reportSheet,
              {
                transform: [
                  {
                    translateY: reportAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [48, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.reportHandle} />
            <Text style={styles.reportTitle}>Report</Text>
            <Text style={styles.reportSubtitle}>
              Why are you reporting {getDisplayName(displayName) || "this user"}
              ?
            </Text>
            {(
              [
                { key: "spam", label: "Spam" },
                { key: "harassment", label: "Harassment or bullying" },
                { key: "inappropriate", label: "Inappropriate content" },
                { key: "fake_profile", label: "Fake profile" },
                { key: "underage", label: "Underage user" },
                { key: "other", label: "Other" },
              ] as { key: ReportReason; label: string }[]
            ).map((item, idx, arr) => (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.reportRow,
                  idx < arr.length - 1 && styles.reportRowBorder,
                ]}
                activeOpacity={0.55}
                onPress={() => {
                  closeReportSheet(() => {
                    showAlert({
                      title: "Submit report?",
                      message:
                        "Reports are anonymous. You can also block this user so they can't message you.",
                      icon: "flag",
                      buttons: [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Report only",
                          style: "default",
                          onPress: () => submitReport(item.key, false),
                        },
                        {
                          text: "Report & block",
                          style: "destructive",
                          onPress: () => submitReport(item.key, true),
                        },
                      ],
                    });
                  });
                }}
              >
                <Text style={styles.reportRowText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.reportCancel}
              onPress={() => closeReportSheet()}
              activeOpacity={0.6}
            >
              <Text style={styles.reportCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      <UserProfileModal
        visible={profileModalVisible}
        user={
          profileUser ||
          (id
            ? {
                id: String(id),
                name: displayName || "User",
                age: profileUser?.age || 0,
                bio: displayBio || profileUser?.bio || "",
                photo: resolveMediaUrl(displayPhoto) || displayPhoto || "",
                photos: profileUser?.photos || [],
                gender: displayGender || "",
                height: profileUser?.height,
                interests: profileUser?.interests || [],
                publicId: profileUser?.publicId,
                isOnline: otherUserOnline,
                friendshipStatus: friendshipStatus?.status,
                areFriends: friendshipStatus?.areFriends,
                iLiked: friendshipStatus?.iLiked,
                theyLiked: friendshipStatus?.theyLiked,
              }
            : null)
        }
        onClose={() => {
          setProfileModalVisible(false);
          setProfileUser(null);
        }}
        onLike={toggleHeaderLike}
        onUnlike={toggleHeaderLike}
        likingInProgress={likingHeader}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  backButton: { padding: 5 },
  userInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 10,
  },
  avatarContainer: { position: "relative" },
  avatar: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: "#F5F5F5",
  },
  onlineIndicator: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#4CAF50",
    borderWidth: 2,
    borderColor: "#fff",
  },
  userName: { fontSize: 16, fontWeight: "700", color: "#333", marginLeft: 12 },
  userStatus: {
    fontSize: 12,
    color: "#4CAF50",
    marginLeft: 12,
    fontWeight: "500",
  },
  selectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
    backgroundColor: "#fff",
  },
  selectionHeaderLeft: { flexDirection: "row", alignItems: "center" },
  selectionCountText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginLeft: 15,
  },
  headerActions: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  actionButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  chatMenuOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
  },
  chatMenuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(11, 20, 26, 0.06)",
  },
  chatMenuCard: {
    position: "absolute",
    width: 86,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    paddingVertical: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(11, 20, 26, 0.18)",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  chatMenuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 38,
    justifyContent: "center",
    alignItems: "stretch",
    backgroundColor: "#FFFFFF",
  },
  chatMenuDivider: {
    height: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: "#D1D7DB",
  },
  chatMenuText: {
    fontSize: 14,
    color: "#111B21",
    letterSpacing: 0.05,
    textAlign: "left",
  },
  chatMenuDanger: {
    color: "#EA4335",
  },
  reportBackdrop: {
    flex: 1,
    backgroundColor: "transparent",
    justifyContent: "flex-end",
  },
  reportSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
    paddingTop: 6,
  },
  reportHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D7DB",
    marginBottom: 12,
  },
  reportTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111B21",
    paddingHorizontal: 18,
    marginBottom: 2,
  },
  reportSubtitle: {
    fontSize: 13,
    color: "#667781",
    paddingHorizontal: 18,
    marginBottom: 8,
    lineHeight: 18,
  },
  reportRow: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: "center",
  },
  reportRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E9EDEF",
  },
  reportRowText: {
    fontSize: 16,
    color: "#111B21",
  },
  reportCancel: {
    marginTop: 8,
    marginHorizontal: 16,
    alignItems: "center",
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: "#F0F2F5",
  },
  reportCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#667781",
  },
  chatContainer: { flex: 1 },
  messagesFlatList: { flex: 1, minHeight: 0 },
  composerAccessoryDock: {
    width: "100%",
    backgroundColor: "#FFFFFF",
  },
  composerDock: {
    width: "100%",
    backgroundColor: "#FFFFFF",
  },
  composerSafeSpacer: {
    width: "100%",
    backgroundColor: "#FFFFFF",
  },
  composerSticky: {
    width: "100%",
    backgroundColor: "#FFFFFF",
  },
  messagesList: {
    flexGrow: 1,
    paddingVertical: 8,
  },
  emptyChatBanner: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 4,
    alignItems: "center",
  },
  emptyChatText: {
    color: "#54656F",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  composerWrap: {
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.06)",
  },
  tokenStatusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: "#FAFAFA",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#EEEEEE",
  },
  tokenStatusText: {
    fontSize: 11,
    color: "#777",
    fontWeight: "500",
  },
  warningBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#fff3e0",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ffcc80",
  },
  warningText: {
    fontSize: 12,
    color: "#e65100",
    fontWeight: "500",
    flex: 1,
  },
  blockedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#ffebee",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ef9a9a",
  },
  blockedText: {
    fontSize: 12,
    color: "#c62828",
    fontWeight: "600",
    flex: 1,
  },
  youBlockedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E9EDEF",
  },
  youBlockedText: {
    flex: 1,
    fontSize: 13,
    color: "#667781",
    lineHeight: 18,
    textAlign: "center",
  },
  composerDisabledHint: {
    flex: 1,
    textAlign: "center",
    fontSize: 14,
    color: "#8696A0",
    paddingVertical: 12,
    fontWeight: "500",
  },
  messageRow: {
    width: "100%",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  highlightedMessageRow: {
    backgroundColor: "rgba(103, 80, 164, 0.18)",
  },
  selectedMessageRow: { backgroundColor: "rgba(142,45,226,0.06)" },
  mediaSelected: {
    opacity: 0.85,
    borderWidth: 2,
    borderColor: "#8E2DE2",
    borderRadius: 12,
  },
  checkboxContainer: { marginRight: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
  },
  checkboxSelected: { backgroundColor: "#8E2DE2", borderColor: "#8E2DE2" },
  messageContainer: {
    marginBottom: 3,
    maxWidth: "82%",
    flexShrink: 1,
  },
  myMessage: { alignSelf: "flex-end", marginLeft: "auto" },
  otherMessage: { alignSelf: "flex-start", marginRight: "auto" },
  bubbleWrapper: { flexDirection: "row", alignItems: "flex-start" },
  myBubbleWrapper: { flexDirection: "row" },
  otherBubbleWrapper: { flexDirection: "row-reverse" },
  // Luvstor text bubbles
  messageBubble: {
    alignSelf: "flex-start",
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 6,
    paddingBottom: 5,
    borderRadius: 12,
    maxWidth: "100%",
  },
  myBubbleBorder: {
    backgroundColor: SENDER_BUBBLE_BLACK,
    borderTopRightRadius: 2,
    borderWidth: 1,
    borderColor: SENDER_BUBBLE_BLACK,
  },
  otherBubbleBorder: {
    backgroundColor: "#F0F0F0",
    borderTopLeftRadius: 2,
  },
  messageTextWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  messageText: {
    fontSize: 15.5,
    lineHeight: 20.5,
    flexShrink: 1,
  },
  messageMetaInline: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
    paddingLeft: 6,
    marginBottom: 1,
    flexShrink: 0,
  },
  messageMetaInlineMultiLine: {
    flexBasis: "100%",
    justifyContent: "flex-end",
    paddingLeft: 0,
    marginTop: -1,
  },
  messageTime: {
    fontSize: 11,
    fontWeight: "400",
    lineHeight: 14,
    includeFontPadding: false,
  },
  myMessageTime: { color: "rgba(255,255,255,0.75)" },
  otherMessageTime: { color: "#667781" },
  singleDeliveryTick: {
    marginLeft: 3,
  },
  doubleDeliveryTicks: {
    width: 16,
    height: 12,
    marginLeft: 3,
    position: "relative",
  },
  doubleDeliveryTickBack: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  doubleDeliveryTickFront: {
    position: "absolute",
    left: 5,
    top: -1,
  },
  myMessageText: { color: "#fff" },
  otherMessageText: { color: "#333" },
  myDeletedBubble: {
    backgroundColor: "rgba(17,17,17,0.72)",
    borderTopRightRadius: 2,
  },
  otherDeletedBubble: {
    backgroundColor: "#F0F0F0",
    borderTopLeftRadius: 2,
  },
  deletedMessageContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
    paddingRight: 2,
  },
  deletedMessageText: { fontSize: 14, fontStyle: "italic", lineHeight: 18 },
  myDeletedMessageText: { color: "rgba(255,255,255,0.75)" },
  otherDeletedMessageText: { color: "#999" },
  typingBubble: {
    backgroundColor: "#F0F0F0",
    minWidth: 52,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  typingDotsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 9,
  },
  typingDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
    backgroundColor: "#8696A0",
    marginHorizontal: 1.5,
  },
  imageBubble: { borderRadius: 12, overflow: "hidden" },
  myImageBubble: { borderTopRightRadius: 3 },
  otherImageBubble: { borderTopLeftRadius: 3 },
  // WhatsApp-style compact voice note (no overflow)
  voiceBubble: {
    maxWidth: 210,
    minWidth: 160,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 10,
    borderRadius: 12,
  },
  myVoiceBubble: {
    backgroundColor: SENDER_BUBBLE_BLACK,
    borderTopRightRadius: 2,
  },
  otherVoiceBubble: {
    backgroundColor: "#F0F0F0",
    borderTopLeftRadius: 2,
  },
  voicePlayBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    flexShrink: 0,
  },
  myVoicePlayBtn: { backgroundColor: "#fff" },
  otherVoicePlayBtn: { backgroundColor: "#8E2DE2" },
  voiceBody: {
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  voiceWaveRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 18,
    overflow: "hidden",
    gap: 1.5,
  },
  voiceWaveBar: { width: 2.2, borderRadius: 1.5, flexShrink: 0 },
  voiceMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 3,
  },
  voiceDuration: { fontSize: 10, fontWeight: "500" },
  myVoiceDuration: { color: "rgba(255,255,255,0.9)" },
  otherVoiceDuration: { color: "#667781" },
  voiceTimeRow: { flexDirection: "row", alignItems: "center", marginLeft: 8 },
  voiceTime: { fontSize: 9, fontWeight: "400" },
  myVoiceTime: { color: "rgba(255,255,255,0.75)" },
  otherVoiceTime: { color: "#999" },
  imageTimeOverlay: {
    position: "absolute",
    bottom: 5,
    right: 5,
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  imageBufferOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.32)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageBufferRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.55)",
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewOncePhotoBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingLeft: 7,
    paddingRight: 6,
    paddingVertical: 4,
    borderRadius: 14,
    gap: 4,
  },
  viewOncePhotoOne: {
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  viewOncePhotoOneText: {
    color: "#111",
    fontSize: 9,
    fontWeight: "800",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: IS_WIDE ? 20 : IS_COMPACT ? 8 : 10,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: "#FFFFFF",
    gap: IS_COMPACT ? 6 : 8,
    width: "100%",
    maxWidth: IS_WIDE ? 720 : undefined,
    alignSelf: "center",
  },
  attachButton: {
    width: INPUT_BTN,
    height: INPUT_BTN,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
  cameraButton: {
    width: INPUT_BTN - 4,
    height: INPUT_BTN,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
    flexShrink: 0,
  },
  composerCenter: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    position: "relative",
  },
  inputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.12)",
    paddingHorizontal: IS_COMPACT ? 12 : 14,
    minHeight: INPUT_BTN,
    maxHeight: IS_WIDE ? 120 : 100,
  },
  inputWhileRecording: {
    opacity: 0,
  },
  recordingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
  },
  input: {
    flex: 1,
    paddingTop: Platform.OS === "ios" ? 8 : 6,
    paddingBottom: Platform.OS === "ios" ? 8 : 6,
    maxHeight: IS_WIDE ? 110 : 90,
    fontSize: IS_COMPACT ? 14 : 15,
    lineHeight: IS_COMPACT ? 18 : 20,
    color: "#111",
    includeFontPadding: false,
  },
  sendButton: {
    width: SEND_BTN,
    height: SEND_BTN,
    borderRadius: SEND_BTN / 2,
    overflow: "hidden",
    marginBottom: 1,
    flexShrink: 0,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonGradient: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  recordingWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.12)",
    paddingHorizontal: IS_COMPACT ? 12 : 14,
    minHeight: INPUT_BTN,
    justifyContent: "space-between",
  },
  recordingIndicatorContainer: { flexDirection: "row", alignItems: "center" },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ff4444",
    marginRight: 6,
  },
  recordingTime: {
    fontSize: IS_COMPACT ? 13 : 14,
    color: "#333",
    fontWeight: "600",
  },
  recordingText: {
    fontSize: IS_COMPACT ? 12 : 13,
    color: "#666",
    flex: 1,
    marginLeft: 8,
  },
  deleteRecordingButton: { padding: 4 },
  imagePreviewContainer: {
    marginHorizontal: Math.max(12, SCREEN_WIDTH * 0.04),
    marginBottom: 8,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
    height: IMAGE_PREVIEW_SIZE,
    width: IMAGE_PREVIEW_SIZE * 0.85,
    maxWidth: SCREEN_WIDTH * 0.35,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8E2DE2",
    alignSelf: "flex-start",
  },
  imagePreview: { width: "100%", height: "100%", borderRadius: 12 },
  cancelImageButton: {
    position: "absolute",
    top: 5,
    right: 5,
    backgroundColor: "#fff",
    borderRadius: 15,
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeFullScreenButton: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  fullScreenImage: { width: "100%", height: "100%" },
  fullScreenPhotoWrap: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  },
  fullScreenBuffer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  viewOnceBubble: {
    minWidth: 158,
    maxWidth: 210,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignSelf: "flex-start",
  },
  viewOnceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  viewOnceIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  viewOnceIconCircleMe: {
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  viewOnceIconCircleOther: {
    backgroundColor: "rgba(103,80,164,0.12)",
  },
  viewOnceOneBadge: {
    position: "absolute",
    right: -3,
    bottom: -2,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: "#FF4B6E",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#6750A4",
  },
  viewOnceOneBadgeOther: {
    borderColor: "#F0F0F0",
  },
  viewOnceOneBadgeText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "800",
    lineHeight: 10,
  },
  viewOnceTextCol: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 72,
    justifyContent: "center",
  },
  viewOnceLabel: {
    fontSize: 13.5,
    fontWeight: "600",
    lineHeight: 17,
  },
  viewOnceLabelMe: { color: "#fff" },
  viewOnceLabelOther: { color: "#111" },
  viewOnceMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 0,
    gap: 6,
  },
  viewOnceMeta: {
    fontSize: 11,
    flexShrink: 1,
  },
  viewOnceMetaMe: { color: "rgba(255,255,255,0.75)" },
  viewOnceMetaOther: { color: "#667781" },
  viewOnceTimeWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
    flexShrink: 0,
    gap: 1,
  },
  viewOnceFullBadge: {
    position: "absolute",
    top: 58,
    alignSelf: "center",
    zIndex: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(103,80,164,0.92)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  viewOnceFullBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  pendingPhotoOverlay: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "space-between",
  },
  pendingPhotoTopBar: {
    paddingTop: Platform.OS === "ios" ? 54 : 28,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  pendingPhotoCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pendingPhotoFull: {
    flex: 1,
    width: "100%",
  },
  pendingPhotoBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
    gap: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  pendingEyeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pendingEyeBtnOn: {
    backgroundColor: "#6750A4",
  },
  pendingEyeBadge: {
    position: "absolute",
    right: 4,
    bottom: 4,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  pendingEyeBadgeOn: {
    backgroundColor: "#FF4B6E",
  },
  pendingEyeBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    lineHeight: 11,
  },
  pendingSendCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#6750A4",
    alignItems: "center",
    justifyContent: "center",
  },
  replyActionContainer: {
    justifyContent: "center",
    alignItems: "center",
    width: 64,
    paddingLeft: 8,
  },
  replyActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#8E2DE2",
    justifyContent: "center",
    alignItems: "center",
  },
  replyBubble: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    marginBottom: 6,
    overflow: "hidden",
    minHeight: 40,
  },
  replyBubbleVoice: {
    minWidth: 158,
  },
  replyBubbleAccent: {
    width: 3,
    alignSelf: "stretch",
  },
  myReplyBubbleAccent: {
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  otherReplyBubbleAccent: {
    backgroundColor: "#6750A4",
  },
  replyBubbleBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  replyBubbleThumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    marginRight: 6,
  },
  replyBubbleViewOnceThumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    marginRight: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  replyBubbleViewOnceThumbMe: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  replyBubbleViewOnceThumbOther: {
    backgroundColor: "rgba(103,80,164,0.12)",
  },
  myReplyBubble: {
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  otherReplyBubble: {
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  replyBubbleName: { fontSize: 12, fontWeight: "700", marginBottom: 2 },
  myReplyBubbleName: { color: "#fff" },
  otherReplyBubbleName: { color: "#6750A4" },
  replyBubbleTextRow: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  replyBubbleText: { fontSize: 13, flexShrink: 1 },
  myReplyBubbleText: { color: "rgba(255,255,255,0.85)" },
  otherReplyBubbleText: { color: "#555" },
  replyingToContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E9EDEF",
    gap: 10,
  },
  replyingToAccent: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
    backgroundColor: "#6750A4",
  },
  replyingToContent: { flex: 1, minWidth: 0 },
  replyingToName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6750A4",
    marginBottom: 2,
  },
  replyingToText: { fontSize: 13, color: "#667781" },
  replyingToThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  replyingToViewOnceThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(103,80,164,0.1)",
  },
  cancelReplyingToButton: { padding: 4 },
});
