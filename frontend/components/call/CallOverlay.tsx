import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCall } from '../../contexts/CallContext';
import { useExplore } from '../../contexts/ExploreContext';
import type { CallAudioRoute } from '../../utils/callAudio';
import { getRTCView } from '../../services/webrtc';
import { resolveMediaUrl } from '../../utils/media';
import WhatsAppAvatar, {
  getDisplayName,
  hasProfilePhoto,
} from '../WhatsAppAvatar';

const PIP_W = 112;
const PIP_H = 168;
const CONTROL_PANEL_H = 76;

type PipBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function computePipBounds(
  winW: number,
  winH: number,
  insetsTop: number,
  insetsBottom: number,
): PipBounds {
  const margin = 12;
  // Keep PiP fully above the capsule control bar (no corner clash)
  const panelBottom = Math.max(insetsBottom, 16) + 28;
  const bottomReserve = panelBottom + CONTROL_PANEL_H + 14;
  const minX = margin;
  const maxX = Math.max(minX, winW - PIP_W - margin);
  const minY = insetsTop + 56;
  const maxY = Math.max(minY, winH - PIP_H - bottomReserve);
  return { minX, maxX, minY, maxY };
}

const PIP_SPRING = { damping: 22, stiffness: 260, mass: 0.7, overshootClamping: false };

/** WhatsApp-style free-drag PiP — Reanimated for 60fps, snaps to nearest corner */
function DraggablePip({
  children,
  insetsTop,
  insetsBottom,
}: {
  children: React.ReactNode;
  insetsTop: number;
  insetsBottom: number;
}) {
  const win = Dimensions.get('window');
  const initial = computePipBounds(win.width, win.height, insetsTop, insetsBottom);
  const startX = initial.minX; // default top-left
  const startY = initial.minY;

  const translateX = useSharedValue(startX);
  const translateY = useSharedValue(startY);
  const dragOriginX = useSharedValue(startX);
  const dragOriginY = useSharedValue(startY);
  const boundsSV = useSharedValue(initial);

  useEffect(() => {
    const apply = ({ window: w }: { window: { width: number; height: number } }) => {
      const next = computePipBounds(w.width, w.height, insetsTop, insetsBottom);
      boundsSV.value = next;
      const nx = Math.min(next.maxX, Math.max(next.minX, translateX.value));
      const ny = Math.min(next.maxY, Math.max(next.minY, translateY.value));
      translateX.value = nx;
      translateY.value = ny;
    };
    apply({ window: Dimensions.get('window') });
    const sub = Dimensions.addEventListener('change', apply);
    return () => sub?.remove?.();
  }, [insetsTop, insetsBottom, boundsSV, translateX, translateY]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(1)
        .onBegin(() => {
          'worklet';
          dragOriginX.value = translateX.value;
          dragOriginY.value = translateY.value;
        })
        .onUpdate((e) => {
          'worklet';
          const b = boundsSV.value;
          translateX.value = Math.min(
            b.maxX,
            Math.max(b.minX, dragOriginX.value + e.translationX),
          );
          translateY.value = Math.min(
            b.maxY,
            Math.max(b.minY, dragOriginY.value + e.translationY),
          );
        })
        .onEnd(() => {
          'worklet';
          const b = boundsSV.value;
          const curX = translateX.value;
          const curY = translateY.value;
          const corners = [
            { x: b.minX, y: b.minY },
            { x: b.maxX, y: b.minY },
            { x: b.minX, y: b.maxY },
            { x: b.maxX, y: b.maxY },
          ];
          let best = corners[0];
          let bestD = Number.POSITIVE_INFINITY;
          for (const c of corners) {
            const d = (c.x - curX) ** 2 + (c.y - curY) ** 2;
            if (d < bestD) {
              bestD = d;
              best = c;
            }
          }
          translateX.value = withSpring(best.x, PIP_SPRING);
          translateY.value = withSpring(best.y, PIP_SPRING);
        }),
    [boundsSV, dragOriginX, dragOriginY, translateX, translateY],
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View
        style={[
          styles.pip,
          { width: PIP_W, height: PIP_H },
          animStyle,
        ]}
      >
        <View style={styles.pipClip} collapsable={false} pointerEvents="none">
          {children}
        </View>
      </Reanimated.View>
    </GestureDetector>
  );
}

function qualityLabel(q: string) {
  switch (q) {
    case 'excellent':
      return null;
    case 'good':
      return null;
    case 'fair':
      return 'Weak network';
    case 'poor':
      return 'Poor connection';
    default:
      return null;
  }
}

/** Luvstor call palette — matches Explore / Chat brand */
const T = {
  deep: '#1A062E',
  primary: '#370372',
  primaryMid: '#5A2FC7',
  rose: '#FF4B6E',
  text: '#F8F5FF',
  textMuted: 'rgba(248,245,255,0.62)',
  panel: 'rgba(42, 10, 72, 0.88)',
  panelBorder: 'rgba(255,255,255,0.10)',
  control: 'rgba(255,255,255,0.12)',
  controlOn: '#FFFFFF',
  controlOnInk: '#370372',
  end: '#E53935',
  /** WhatsApp-style accept — green (must not match end/decline red) */
  accept: '#25D366',
  live: '#C4B5FD',
  avatarRing: 'rgba(255,255,255,0.28)',
};

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function statusLabel(
  phase: string,
  endReason: string | null,
  opts?: {
    peerOffline?: boolean;
    callType?: 'voice' | 'video' | null;
    error?: string | null;
  },
) {
  switch (phase) {
    case 'outgoing':
      return 'Calling…';
    case 'ringing':
      return 'Ringing…';
    case 'incoming':
      return opts?.callType === 'video' ? 'Incoming video call' : 'Incoming voice call';
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'connected':
      return '';
    case 'ended':
      // Prefer short status — long error text is shown once via Alert / subtitle below
      if (endReason === 'permission') return 'Permission needed';
      if (
        opts?.error &&
        /permission is required|Enable it in Settings/i.test(opts.error)
      ) {
        return 'Permission needed';
      }
      if (endReason === 'decline' || endReason === 'rejected') return 'Declined';
      if (endReason === 'cancel' || endReason === 'superseded') return 'Cancelled';
      if (endReason === 'timeout' || endReason === 'missed') {
        return 'No answer';
      }
      if (endReason === 'busy' || endReason === 'not_friends' || endReason === 'blocked') {
        return opts?.error || (endReason === 'busy' ? 'Busy on another call' : 'Call failed');
      }
      if (endReason === 'offline') return 'Missed call — they’re offline';
      if (endReason === 'error' || endReason === 'media') {
        return opts?.error || 'Call failed';
      }
      if (opts?.error) return opts.error;
      return 'Call ended';
    default:
      return '';
  }
}

const AUDIO_ROUTE_LABEL: Record<CallAudioRoute, string> = {
  bluetooth: 'Bluetooth',
  wired: 'Headset',
  earpiece: 'Phone',
  speaker: 'Speaker',
};

function speakerIcon(
  route: CallAudioRoute,
  speakerOn: boolean,
): keyof typeof Ionicons.glyphMap {
  if (speakerOn || route === 'speaker') return 'volume-high';
  if (route === 'bluetooth') return 'bluetooth';
  if (route === 'wired') return 'headset';
  return 'volume-mute';
}

function speakerLabel(route: CallAudioRoute, speakerOn: boolean) {
  if (speakerOn || route === 'speaker') return 'Speaker';
  return AUDIO_ROUTE_LABEL[route] || 'Speaker';
}

function openAudioRoutePicker(call: {
  audioRoute: CallAudioRoute;
  availableAudioRoutes: CallAudioRoute[];
  setAudioRoute: (route: CallAudioRoute) => Promise<void>;
}) {
  const routes = call.availableAudioRoutes.length
    ? call.availableAudioRoutes
    : (['earpiece', 'speaker'] as CallAudioRoute[]);
  Alert.alert(
    'Call audio',
    'Choose where you hear this call',
    [
      ...routes.map((route) => ({
        text: `${route === call.audioRoute ? '✓  ' : ''}${AUDIO_ROUTE_LABEL[route]}`,
        onPress: () => {
          void call.setAudioRoute(route);
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ],
  );
}

/** WhatsApp-style dark circle control */
function WaCircle({
  icon,
  onPress,
  onLongPress,
  size = 46,
  bg = 'rgba(30,30,30,0.55)',
  color = '#fff',
  disabled,
  iconRotate,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  onLongPress?: () => void;
  size?: number;
  bg?: string;
  color?: string;
  disabled?: boolean;
  iconRotate?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      disabled={disabled}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.35 : pressed ? 0.75 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={icon}
    >
      <Ionicons
        name={icon}
        size={size * 0.42}
        color={color}
        style={iconRotate ? { transform: [{ rotate: iconRotate }] } : undefined}
      />
    </Pressable>
  );
}

function CircleBtn({
  icon,
  label,
  onPress,
  onLongPress,
  color = T.text,
  bg = T.control,
  size = 52,
  disabled,
  iconRotate,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  onLongPress?: () => void;
  color?: string;
  bg?: string;
  size?: number;
  disabled?: boolean;
  iconRotate?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      disabled={disabled}
      style={({ pressed }) => [
        styles.circleBtn,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.82 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label || icon}
    >
      <Ionicons
        name={icon}
        size={size * 0.42}
        color={color}
        style={iconRotate ? { transform: [{ rotate: iconRotate }] } : undefined}
      />
    </Pressable>
  );
}

function ActionCell({
  icon,
  label,
  onPress,
  onLongPress,
  color,
  bg,
  size = 52,
  iconRotate,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  color?: string;
  bg?: string;
  size?: number;
  iconRotate?: string;
  disabled?: boolean;
}) {
  return (
    <CircleBtn
      icon={icon}
      label={label}
      onPress={onPress}
      onLongPress={onLongPress}
      color={color}
      bg={bg}
      size={size}
      iconRotate={iconRotate}
      disabled={disabled}
    />
  );
}

const AVATAR_SIZE = 160;
const AVATAR_RING = AVATAR_SIZE + 10;

function CenterPeerAvatar({
  name,
  publicId,
  photo,
  gender,
  pulse,
}: {
  name?: string | null;
  publicId?: string | null;
  photo?: string | null;
  gender?: string | null;
  pulse: Animated.Value;
}) {
  // Always WhatsAppAvatar — real DP when set, gray default person when not / load fails
  return (
    <Animated.View
      style={[styles.avatarRing, { transform: [{ scale: pulse }] }]}
    >
      <WhatsAppAvatar
        name={name}
        publicId={publicId}
        photo={hasProfilePhoto(photo) ? photo : null}
        gender={gender}
        size={AVATAR_SIZE}
      />
    </Animated.View>
  );
}

function CallBackdrop({ photo }: { photo?: string | null }) {
  if (hasProfilePhoto(photo)) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Image
          source={{ uri: String(photo) }}
          style={styles.bgPhoto}
          contentFit="cover"
          blurRadius={Platform.OS === 'ios' ? 28 : 22}
          transition={200}
        />
        {/* Brand wash so controls stay readable */}
        <LinearGradient
          colors={[
            'rgba(26, 6, 46, 0.55)',
            'rgba(55, 3, 114, 0.45)',
            'rgba(26, 6, 46, 0.72)',
          ]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }
  return (
    <LinearGradient
      colors={[T.deep, T.primary, T.primaryMid]}
      locations={[0, 0.55, 1]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

export default function CallOverlay() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const call = useCall();
  const explore = useExplore();
  const [tick, setTick] = useState(0);
  const pulse = React.useRef(new Animated.Value(1)).current;
  const enterOpacity = React.useRef(new Animated.Value(0)).current;
  const enterScale = React.useRef(new Animated.Value(0.94)).current;
  const enterY = React.useRef(new Animated.Value(22)).current;
  const wasOpen = React.useRef(false);
  const RTCView = useMemo(() => getRTCView(), []);

  const isExplore = !!call.isExplore;
  const exploreFindingNext =
    isExplore &&
    (explore.status === 'cooldown' || explore.status === 'searching');
  // Friend calls keep a brief ended screen. Explore skip hides immediately
  // so the Explore tab can show "Finding someone".
  const visible =
    call.phase !== 'idle' &&
    !exploreFindingNext &&
    !(isExplore && call.phase === 'ended');
  const isVideo = call.callType === 'video';
  const isVoice = call.callType === 'voice';
  const panelBottomRef = React.useRef<number | null>(null);
  if (!visible || call.phase === 'ended') {
    if (call.phase !== 'ended') panelBottomRef.current = null;
  } else if (panelBottomRef.current == null) {
    panelBottomRef.current = Math.max(insets.bottom, 16) + 28;
  }
  const panelBottom = panelBottomRef.current ?? Math.max(insets.bottom, 16) + 28;

  // Smooth open — same chrome for friend + Explore
  useEffect(() => {
    const open = call.phase !== 'idle' && call.phase !== 'ended';
    if (open && !wasOpen.current) {
      enterOpacity.setValue(0);
      enterScale.setValue(1.02);
      enterY.setValue(0);
      Animated.sequence([
        Animated.delay(40),
        Animated.parallel([
          Animated.timing(enterOpacity, {
            toValue: 1,
            duration: 480,
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            useNativeDriver: true,
          }),
          Animated.timing(enterScale, {
            toValue: 1,
            duration: 520,
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }
    if (call.phase === 'idle') {
      enterOpacity.setValue(0);
      enterScale.setValue(1.02);
      enterY.setValue(0);
    } else if (call.phase === 'ended') {
      // Keep fully visible for the ended / error screen
      enterOpacity.setValue(1);
      enterScale.setValue(1);
    }
    wasOpen.current = open;
  }, [call.phase, enterOpacity, enterScale, enterY]);

  useEffect(() => {
    if (call.phase !== 'connected' || !call.connectedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [call.phase, call.connectedAt]);

  useEffect(() => {
    if (
      call.phase !== 'incoming' &&
      call.phase !== 'outgoing' &&
      call.phase !== 'ringing'
    ) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.04,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [call.phase, pulse]);

  if (!visible) return null;

  const exploreId = String(call.peer?.publicId || '').trim().toUpperCase();
  const name = isExplore
    ? exploreId || 'Anonymous'
    : getDisplayName(call.peer?.name, call.peer?.publicId);
  const photoRaw = resolveMediaUrl(call.peer?.photo) || call.peer?.photo || '';
  const photo = hasProfilePhoto(photoRaw) ? photoRaw : '';
  const duration =
    call.phase === 'connected' && call.connectedAt
      ? formatDuration(Date.now() - call.connectedAt)
      : '';
  void tick;
  const subtitle =
    call.phase === 'connected'
      ? duration || 'Connected'
      : call.phase === 'reconnecting'
        ? 'Reconnecting…'
        : statusLabel(call.phase, call.endReason, {
            peerOffline: !!call.peerOffline,
            callType: call.callType,
            error: call.error,
          });

  // Avoid duplicating the same message in white status + red error (screenshot bug)
  const showInlineError =
    !!call.error &&
    call.phase !== 'ended' &&
    call.error.trim() !== String(subtitle || '').trim();

  const openPeerChat = () => {
    if (isExplore) return;
    const id = call.peer?.id;
    if (!id || id === 'explore') return;
    call.setMinimized(true);
    router.push(`/messages/${id}` as any);
  };

  const onSkip = () => {
    if (!isExplore) return;
    explore.skipWithCooldown();
  };

  const skipDisabled = isExplore && explore.cooldownSec > 0;

  const canMinimize =
    call.phase === 'connected' ||
    call.phase === 'connecting' ||
    call.phase === 'reconnecting' ||
    call.phase === 'outgoing' ||
    call.phase === 'ringing';

  /** Remote fills screen once we have a real stream URL (after pickup) */
  const remoteUrl = (() => {
    try {
      return typeof call.remoteStream?.toURL === 'function'
        ? call.remoteStream.toURL()
        : '';
    } catch {
      return '';
    }
  })();
  const localUrl = (() => {
    try {
      return typeof call.localStream?.toURL === 'function'
        ? call.localStream.toURL()
        : '';
    } catch {
      return '';
    }
  })();

  const hasRemoteVideoTrack = (() => {
    try {
      const tracks = call.remoteStream?.getVideoTracks?.() || [];
      return tracks.some(
        (t: { readyState?: string; enabled?: boolean }) =>
          !!t && t.readyState !== 'ended' && t.enabled !== false,
      );
    } catch {
      return false;
    }
  })();

  const hasRemoteVideo =
    isVideo &&
    !!RTCView &&
    !!remoteUrl &&
    hasRemoteVideoTrack &&
    (call.phase === 'connected' ||
      call.phase === 'connecting' ||
      call.phase === 'reconnecting');

  /** Local camera fullscreen while ringing / before remote video arrives */
  const hasLocalPreview =
    isVideo && !!RTCView && !!localUrl && !call.cameraOff;
  const localFullscreen =
    hasLocalPreview &&
    !hasRemoteVideo &&
    call.phase !== 'connected' &&
    call.phase !== 'reconnecting';
  /** After pickup (or remote video): local → draggable PiP (or black if cam off) */
  const showPipSlot =
    isVideo &&
    !!RTCView &&
    (hasRemoteVideo ||
      call.phase === 'connected' ||
      call.phase === 'reconnecting');
  const localPip = showPipSlot && hasLocalPreview;
  const localPipCamOff = showPipSlot && call.cameraOff;

  /** Video place/accept: black until own camera — never purple/DP */
  const outgoingVideoWaiting =
    isVideo &&
    !hasLocalPreview &&
    !hasRemoteVideo &&
    (call.phase === 'outgoing' ||
      call.phase === 'ringing' ||
      call.phase === 'connecting');

  /** Peer DP only when not placing/answering a video call */
  const showPeerDp =
    isVideo &&
    !hasRemoteVideo &&
    !localFullscreen &&
    !outgoingVideoWaiting;
  const netHint = isVideo ? qualityLabel(call.quality) : null;

  const showActiveControls =
    call.phase === 'outgoing' ||
    call.phase === 'ringing' ||
    call.phase === 'connecting' ||
    call.phase === 'reconnecting' ||
    call.phase === 'connected';

  const endOrCancel =
    call.phase === 'outgoing' || call.phase === 'ringing'
      ? call.cancelCall
      : call.endCall;

  if (call.minimized && call.phase !== 'incoming' && call.phase !== 'ended') {
    // Not a Modal — a RN Modal steals focus and blocks the chat keyboard.
    return (
      <View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, styles.miniHost]}
      >
        <Pressable
          style={[styles.miniBar, { top: insets.top + 8 }]}
          onPress={() => call.setMinimized(false)}
        >
          <LinearGradient
            colors={[T.primary, T.primaryMid]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.miniInner}
          >
            <WhatsAppAvatar
              name={name}
              publicId={call.peer?.publicId}
              photo={photo}
              gender={call.peer?.gender}
              size={36}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.miniName} numberOfLines={1}>
                {isExplore
                  ? exploreId
                    ? `Explore · ${exploreId}`
                    : 'Explore · Anonymous'
                  : name}
              </Text>
              <Text style={styles.miniSub}>
                {call.phase === 'connected' ? duration || 'On call' : subtitle}
              </Text>
            </View>
            <Ionicons
              name={call.callType === 'video' ? 'videocam' : 'call'}
              size={18}
              color={T.live}
            />
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  const topBar = (
    <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
      <Pressable
        onPress={() => canMinimize && call.setMinimized(true)}
        hitSlop={10}
        style={[styles.topBtn, !canMinimize && { opacity: 0.35 }]}
        disabled={!canMinimize}
      >
        <Ionicons name="chevron-down" size={22} color={T.text} />
      </Pressable>

      <View style={styles.titleBlock}>
        {isExplore ? (
          <Text style={styles.exploreTag}>Explore</Text>
        ) : null}
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.sub}>{subtitle || ' '}</Text>
        {showInlineError ? (
          <Text style={styles.error} numberOfLines={2}>
            {call.error}
          </Text>
        ) : null}
      </View>

      {isExplore ? (
        <Pressable
          onPress={onSkip}
          hitSlop={10}
          style={[styles.topBtn, skipDisabled && { opacity: 0.4 }]}
          disabled={skipDisabled}
          accessibilityLabel="Skip to next person"
        >
          <Ionicons name="play-skip-forward" size={20} color={T.text} />
        </Pressable>
      ) : (
        <Pressable
          onPress={openPeerChat}
          hitSlop={10}
          style={styles.topBtn}
          disabled={!call.peer?.id || call.peer.id === 'explore'}
        >
          <Ionicons name="chatbubble-outline" size={20} color={T.text} />
        </Pressable>
      )}
    </View>
  );

  /** WhatsApp video chrome: minimize · name · right-side add / chat|skip / flip */
  const videoTopChrome = (
    <View
      pointerEvents="box-none"
      style={[styles.waTop, { paddingTop: insets.top + 8 }]}
    >
      <View style={styles.waTopRow}>
        <WaCircle
          icon="scan-outline"
          size={40}
          bg="rgba(20,20,20,0.45)"
          onPress={() => canMinimize && call.setMinimized(true)}
          disabled={!canMinimize}
        />
        <View style={styles.waTitleBlock}>
          {isExplore ? (
            <Text style={styles.exploreTagLight}>Explore</Text>
          ) : null}
          <Text style={styles.waName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.waSub}>{subtitle || ' '}</Text>
          {showInlineError ? (
            <Text style={styles.error} numberOfLines={2}>
              {call.error}
            </Text>
          ) : null}
        </View>
        {/* spacer matches left button so title stays centered */}
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.waRightRail, { top: insets.top + 56 }]}>
        {!isExplore ? (
          <WaCircle
            icon="person-add-outline"
            size={44}
            bg="rgba(20,20,20,0.45)"
            disabled
            onPress={() => {}}
          />
        ) : null}
        {isExplore ? (
          <View style={styles.exploreSkipRail}>
            <WaCircle
              icon="play-skip-forward"
              size={44}
              bg={
                skipDisabled
                  ? 'rgba(55,55,55,0.55)'
                  : 'rgba(103, 80, 164, 0.92)'
              }
              onPress={onSkip}
              disabled={skipDisabled}
            />
            <Text style={styles.exploreSkipLabel}>
              {skipDisabled ? `${explore.cooldownSec}s` : 'Skip'}
            </Text>
          </View>
        ) : (
          <WaCircle
            icon="chatbubble"
            size={44}
            bg="rgba(20,20,20,0.45)"
            onPress={openPeerChat}
            disabled={!call.peer?.id || call.peer.id === 'explore'}
          />
        )}
        <WaCircle
          icon="camera-reverse"
          size={44}
          bg="rgba(20,20,20,0.45)"
          onPress={() => {
            void call.switchCamera();
          }}
          disabled={call.cameraOff || !call.localStream}
        />
      </View>

      {netHint ? (
        <View style={[styles.netBanner, { top: insets.top + 52 }]}>
          <Ionicons name="wifi" size={14} color="#FFE082" />
          <Text style={styles.netBannerText}>{netHint}</Text>
        </View>
      ) : null}
    </View>
  );

  const controlPill = (
    <View
      pointerEvents="box-none"
      style={[styles.panelFixed, { bottom: panelBottom }]}
    >
      {call.phase === 'ended' ? (
        <View style={styles.endedPill}>
          <Text style={styles.endedHint}>Returning…</Text>
        </View>
      ) : (
      <BlurView intensity={48} tint="dark" style={styles.panel}>
        {call.phase === 'incoming' && !isExplore ? (
          <View style={styles.panelRow}>
            <ActionCell
              icon="call"
              label="Decline"
              bg={T.end}
              color="#fff"
              iconRotate="135deg"
              onPress={call.declineCall}
            />
            <ActionCell
              icon={isVoice ? 'call' : 'videocam'}
              label="Accept"
              bg={T.accept}
              color="#fff"
              onPress={call.acceptCall}
            />
          </View>
        ) : showActiveControls ? (
          <View style={styles.panelRow}>
            {isExplore ? (
              <ActionCell
                icon="play-skip-forward"
                label={skipDisabled ? `${explore.cooldownSec}s` : 'Skip'}
                bg={T.control}
                color={T.text}
                onPress={onSkip}
                disabled={skipDisabled}
              />
            ) : (
              <ActionCell
                icon={speakerIcon(call.audioRoute, call.speakerOn)}
                label={speakerLabel(call.audioRoute, call.speakerOn)}
                bg={call.speakerOn ? T.controlOn : T.control}
                color={call.speakerOn ? T.controlOnInk : T.text}
                onPress={call.toggleSpeaker}
                onLongPress={() => openAudioRoutePicker(call)}
              />
            )}
            <ActionCell
              icon={call.muted ? 'mic-off' : 'mic'}
              label={call.muted ? 'Unmute' : 'Mute'}
              bg={call.muted ? T.controlOn : T.control}
              color={call.muted ? T.controlOnInk : T.text}
              onPress={call.toggleMute}
            />
            {isExplore ? (
              <ActionCell
                icon={speakerIcon(call.audioRoute, call.speakerOn)}
                label={speakerLabel(call.audioRoute, call.speakerOn)}
                bg={call.speakerOn ? T.controlOn : T.control}
                color={call.speakerOn ? T.controlOnInk : T.text}
                onPress={call.toggleSpeaker}
                onLongPress={() => openAudioRoutePicker(call)}
              />
            ) : null}
            <ActionCell
              icon="call"
              label="End"
              bg={T.end}
              color="#fff"
              iconRotate="135deg"
              onPress={endOrCancel}
            />
          </View>
        ) : null}
      </BlurView>
      )}
    </View>
  );

  /** WhatsApp video bottom bar — video · speaker · mute · end (+ skip for Explore) */
  const videoControlPill = (
    <View
      pointerEvents="box-none"
      style={[styles.waPanelFixed, { bottom: Math.max(insets.bottom, 12) + 10 }]}
    >
      {call.phase === 'incoming' && !isExplore ? (
        <View style={styles.waPill}>
          <WaCircle
            icon="call"
            size={56}
            bg={T.end}
            color="#fff"
            iconRotate="135deg"
            onPress={call.declineCall}
          />
          <WaCircle
            icon="videocam"
            size={56}
            bg="#25D366"
            color="#fff"
            onPress={call.acceptCall}
          />
        </View>
      ) : call.phase === 'ended' ? (
        <View style={styles.endedPill}>
          <Text style={styles.endedHint}>Returning…</Text>
        </View>
      ) : showActiveControls ? (
        <View style={styles.waPill}>
          <WaCircle
            icon={call.cameraOff ? 'videocam-off' : 'videocam'}
            size={52}
            bg={call.cameraOff ? '#fff' : 'rgba(55,55,55,0.85)'}
            color={call.cameraOff ? '#111' : '#fff'}
            onPress={() => call.toggleCamera()}
          />
          <WaCircle
            icon={speakerIcon(call.audioRoute, call.speakerOn)}
            size={52}
            bg={call.speakerOn ? '#fff' : 'rgba(55,55,55,0.85)'}
            color={call.speakerOn ? '#111' : '#fff'}
            onPress={() => {
              void call.toggleSpeaker();
            }}
            onLongPress={() => openAudioRoutePicker(call)}
          />
          <WaCircle
            icon={call.muted ? 'mic-off' : 'mic'}
            size={52}
            bg={call.muted ? '#fff' : 'rgba(55,55,55,0.85)'}
            color={call.muted ? '#111' : '#fff'}
            onPress={() => call.toggleMute()}
          />
          <WaCircle
            icon="call"
            size={52}
            bg="#E53935"
            color="#fff"
            iconRotate="135deg"
            onPress={() => endOrCancel()}
          />
        </View>
      ) : null}
    </View>
  );

  const peerAvatar = (
    <CenterPeerAvatar
      name={name}
      publicId={call.peer?.publicId}
      photo={photo}
      gender={call.peer?.gender}
      pulse={pulse}
    />
  );

  /** Geometrically centered on screen (above control pill) */
  const { height: winH, width: winW } = Dimensions.get('window');
  const centerAvatarStyle = {
    position: 'absolute' as const,
    left: (winW - AVATAR_RING) / 2,
    top: (winH - AVATAR_RING) / 2 - 24,
    width: AVATAR_RING,
    height: AVATAR_RING,
    zIndex: 12,
    elevation: 12,
  };

  const voiceBody = (
    <View style={styles.fullscreen}>
      <CallBackdrop photo={photo} />
      {topBar}
      <View style={centerAvatarStyle} pointerEvents="none">
        {peerAvatar}
      </View>
      {controlPill}
    </View>
  );

  const videoBody = (
    <View style={[styles.fullscreen, styles.videoStage]}>
      {/* Purple/DP only when waiting on incoming — never for outgoing video */}
      {showPeerDp ? <CallBackdrop photo={photo} /> : null}
      {outgoingVideoWaiting ? (
        <View style={styles.cameraWarmup} pointerEvents="none">
          <Text style={styles.cameraWarmupText}>Starting camera…</Text>
        </View>
      ) : null}

      {hasRemoteVideo ? (
        <RTCView
          key={`remote-${remoteUrl}`}
          streamURL={remoteUrl}
          style={styles.remoteVideo}
          objectFit="cover"
          mirror={false}
          zOrder={0}
        />
      ) : localFullscreen ? (
        <RTCView
          key={`local-full-${localUrl}`}
          streamURL={localUrl}
          style={styles.remoteVideo}
          objectFit="cover"
          mirror={call.localMirrored !== false}
          zOrder={0}
        />
      ) : null}

      {localPip ? (
        <DraggablePip
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
        >
          <RTCView
            key={`local-pip-${localUrl}`}
            streamURL={localUrl}
            style={styles.pipVideo}
            objectFit="cover"
            mirror={call.localMirrored !== false}
            // No zOrder — TextureView-friendly; square PiP (no rounded clip)
          />
        </DraggablePip>
      ) : localPipCamOff ? (
        <DraggablePip
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
        >
          <View style={styles.pipCamOff}>
            <Ionicons name="videocam-off" size={28} color="rgba(255,255,255,0.7)" />
          </View>
        </DraggablePip>
      ) : null}

      {videoTopChrome}

      {showPeerDp ? (
        <View style={centerAvatarStyle} pointerEvents="none">
          {peerAvatar}
        </View>
      ) : null}

      {videoControlPill}
    </View>
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={() => {
        if (canMinimize) call.setMinimized(true);
      }}
    >
      <GestureHandlerRootView style={styles.enterRoot}>
        <Animated.View
          style={[
            styles.enterRoot,
            {
              opacity: enterOpacity,
              transform: [{ scale: enterScale }],
            },
          ]}
        >
          {isVideo ? videoBody : voiceBody}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  enterRoot: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  fullscreen: {
    flex: 1,
    backgroundColor: T.deep,
  },
  videoStage: {
    backgroundColor: '#000',
  },
  cameraWarmup: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  cameraWarmupText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 15,
    fontWeight: '500',
  },
  bgPhoto: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
    transform: [{ scale: 1.12 }],
  },
  remoteVideo: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
  },
  dimOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(26, 6, 46, 0.72)',
  },
  pip: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
    borderWidth: 0,
    borderRadius: 0,
    zIndex: 40,
    elevation: 40,
    backgroundColor: '#111',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 40 },
    }),
  },
  pipClip: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  pipVideo: {
    width: '100%',
    height: '100%',
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  pipCamOff: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
  },
  netBanner: {
    position: 'absolute',
    alignSelf: 'center',
    left: 60,
    right: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    zIndex: 10,
  },
  netBannerText: {
    color: '#FFE082',
    fontSize: 12,
    fontWeight: '600',
  },
  waTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 8,
  },
  waTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
  },
  waTitleBlock: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  waName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  waSub: {
    marginTop: 3,
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  waRightRail: {
    position: 'absolute',
    right: 14,
    gap: 14,
    alignItems: 'center',
    zIndex: 9,
  },
  exploreSkipRail: {
    alignItems: 'center',
    gap: 4,
  },
  exploreSkipLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  waPanelFixed: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 20,
    elevation: 20,
  },
  waPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    backgroundColor: 'rgba(35,35,35,0.72)',
    borderRadius: 40,
    paddingHorizontal: 22,
    paddingVertical: 14,
    minHeight: 80,
    alignSelf: 'stretch',
  },
  endedPill: {
    alignSelf: 'center',
    backgroundColor: 'rgba(35,35,35,0.55)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 0,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    zIndex: 6,
  },
  topBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  titleBlock: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  name: {
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 0.2,
    color: T.text,
    textAlign: 'center',
  },
  exploreTag: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: T.live,
    marginBottom: 2,
    textAlign: 'center',
  },
  exploreTagLight: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: 'rgba(196, 181, 253, 0.95)',
    marginBottom: 2,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  sub: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '400',
    color: T.textMuted,
    textAlign: 'center',
  },
  error: {
    marginTop: 6,
    color: '#FFB4C0',
    textAlign: 'center',
    paddingHorizontal: 8,
    fontSize: 12,
    lineHeight: 16,
  },
  center: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
  },
  avatarRing: {
    width: AVATAR_RING,
    height: AVATAR_RING,
    borderRadius: AVATAR_RING / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.55)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DFE5E7',
  },
  panel: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: T.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.panelBorder,
    height: CONTROL_PANEL_H,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  panelFixed: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
    zIndex: 20,
    elevation: 20,
  },
  panelRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    height: 52,
  },
  circleBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  endedHint: {
    color: T.textMuted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  miniHost: {
    backgroundColor: 'transparent',
    zIndex: 9999,
    elevation: 9999,
  },
  miniBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 9999,
  },
  miniInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    ...Platform.select({
      ios: {
        shadowColor: T.primary,
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 8 },
    }),
  },
  miniName: {
    color: T.text,
    fontSize: 15,
    fontWeight: '600',
  },
  miniSub: {
    color: T.live,
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
});
