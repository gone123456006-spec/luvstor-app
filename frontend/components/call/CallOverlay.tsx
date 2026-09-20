import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCall } from '../../contexts/CallContext';
import { useExplore } from '../../contexts/ExploreContext';
import { getRTCView } from '../../services/webrtc';
import { resolveMediaUrl } from '../../utils/media';
import WhatsAppAvatar, { getDisplayName } from '../WhatsAppAvatar';

const PIP_W = 112;
const PIP_H = 168;

/** WhatsApp-style free-drag PiP that snaps to the nearest corner on release */
function DraggablePip({
  children,
  insetsTop,
  insetsBottom,
}: {
  children: React.ReactNode;
  insetsTop: number;
  insetsBottom: number;
}) {
  const { width: winW, height: winH } = Dimensions.get('window');
  const margin = 12;
  const bottomReserve = Math.max(insetsBottom, 12) + 100;
  const minX = margin;
  const maxX = Math.max(minX, winW - PIP_W - margin);
  const minY = insetsTop + 56;
  const maxY = Math.max(minY, winH - PIP_H - bottomReserve);

  const pan = useRef(
    new Animated.ValueXY({ x: maxX, y: minY + 8 }),
  ).current;
  const startXY = useRef({ x: maxX, y: minY + 8 });

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        pan.stopAnimation((v: { x: number; y: number }) => {
          startXY.current = { x: v.x, y: v.y };
        });
      },
      onPanResponderMove: (_, g) => {
        const nx = Math.min(
          maxX,
          Math.max(minX, startXY.current.x + g.dx),
        );
        const ny = Math.min(
          maxY,
          Math.max(minY, startXY.current.y + g.dy),
        );
        pan.setValue({ x: nx, y: ny });
      },
      onPanResponderRelease: (_, g) => {
        const curX = startXY.current.x + g.dx;
        const curY = startXY.current.y + g.dy;
        const snapX = curX + PIP_W / 2 < winW / 2 ? minX : maxX;
        const snapY = Math.min(maxY, Math.max(minY, curY));
        startXY.current = { x: snapX, y: snapY };
        Animated.spring(pan, {
          toValue: { x: snapX, y: snapY },
          useNativeDriver: false,
          friction: 8,
          tension: 80,
        }).start();
      },
    }),
  ).current;

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[
        styles.pip,
        {
          width: PIP_W,
          height: PIP_H,
          transform: pan.getTranslateTransform(),
        },
      ]}
    >
      {children}
    </Animated.View>
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
  accept: '#FF4B6E',
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
  opts?: { peerOffline?: boolean; callType?: 'voice' | 'video' | null },
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
      if (endReason === 'decline' || endReason === 'rejected') return 'Declined';
      if (endReason === 'cancel') return 'Cancelled';
      if (endReason === 'timeout' || endReason === 'missed') {
        return 'No answer';
      }
      if (endReason === 'busy') return 'Busy on another call';
      if (endReason === 'offline') return 'Missed call — they’re offline';
      if (endReason === 'error') return 'Call failed';
      return 'Call ended';
    default:
      return '';
  }
}

/** WhatsApp-style dark circle control */
function WaCircle({
  icon,
  onPress,
  size = 46,
  bg = 'rgba(30,30,30,0.55)',
  color = '#fff',
  disabled,
  iconRotate,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  size?: number;
  bg?: string;
  color?: string;
  disabled?: boolean;
  iconRotate?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
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
  color = T.text,
  bg = T.control,
  size = 52,
  disabled,
  iconRotate,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  color?: string;
  bg?: string;
  size?: number;
  disabled?: boolean;
  iconRotate?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
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
  color,
  bg,
  size = 52,
  iconRotate,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
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
  return (
    <Animated.View
      style={[styles.avatarRing, { transform: [{ scale: pulse }] }]}
    >
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={styles.avatarImg}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <WhatsAppAvatar
          name={name}
          publicId={publicId}
          photo={null}
          gender={gender}
          size={AVATAR_SIZE}
        />
      )}
    </Animated.View>
  );
}

function CallBackdrop({ photo }: { photo?: string | null }) {
  if (photo) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Image
          source={{ uri: photo }}
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
  const visible =
    call.phase !== 'idle' && call.phase !== 'ended';
  const isVideo = call.callType === 'video';
  const isVoice = call.callType === 'voice';
  const panelBottomRef = React.useRef<number | null>(null);
  if (!visible) {
    panelBottomRef.current = null;
  } else if (panelBottomRef.current == null) {
    panelBottomRef.current = Math.max(insets.bottom, 16) + 28;
  }
  const panelBottom = panelBottomRef.current ?? Math.max(insets.bottom, 16) + 28;

  // Smooth open — same chrome for friend + Explore
  useEffect(() => {
    const open = visible;
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
    if (!open) {
      enterOpacity.setValue(0);
      enterScale.setValue(1.02);
      enterY.setValue(0);
    }
    wasOpen.current = open;
  }, [visible, enterOpacity, enterScale, enterY]);

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

  const name = isExplore
    ? 'Anonymous'
    : getDisplayName(call.peer?.name, call.peer?.publicId);
  const photo = isExplore
    ? ''
    : resolveMediaUrl(call.peer?.photo) || call.peer?.photo || '';
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
          });

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

  const hasRemoteVideo =
    isVideo &&
    !!RTCView &&
    !!remoteUrl &&
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
  /** After pickup (or remote video): local → draggable PiP */
  const localPip =
    hasLocalPreview &&
    (hasRemoteVideo ||
      call.phase === 'connected' ||
      call.phase === 'reconnecting');

  /** Peer DP — video fallback when camera isn't filling the screen */
  const showPeerDp = isVideo && !hasRemoteVideo && !localFullscreen;
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
    return (
      <Modal visible transparent animationType="none" statusBarTranslucent>
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
              publicId={isExplore ? '' : call.peer?.publicId}
              photo={photo}
              gender={call.peer?.gender}
              size={36}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.miniName} numberOfLines={1}>
                {isExplore ? 'Explore · Anonymous' : name}
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
      </Modal>
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
        {call.error ? (
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
          {call.error ? (
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
          <WaCircle
            icon="play-skip-forward"
            size={44}
            bg="rgba(103, 80, 164, 0.75)"
            onPress={onSkip}
            disabled={skipDisabled}
          />
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
        ) : call.phase === 'ended' ? (
          <Text style={styles.endedHint}>Returning…</Text>
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
                icon={call.speakerOn ? 'volume-high' : 'volume-mute'}
                label="Speaker"
                bg={call.speakerOn ? T.controlOn : T.control}
                color={call.speakerOn ? T.controlOnInk : T.text}
                onPress={call.toggleSpeaker}
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
                icon={call.speakerOn ? 'volume-high' : 'volume-mute'}
                label="Speaker"
                bg={call.speakerOn ? T.controlOn : T.control}
                color={call.speakerOn ? T.controlOnInk : T.text}
                onPress={call.toggleSpeaker}
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
        <View style={styles.waPill}>
          <Text style={styles.endedHint}>Returning…</Text>
        </View>
      ) : showActiveControls ? (
        <View style={styles.waPill}>
          {isExplore ? (
            <WaCircle
              icon="play-skip-forward"
              size={52}
              bg={skipDisabled ? 'rgba(55,55,55,0.5)' : 'rgba(103, 80, 164, 0.9)'}
              color="#fff"
              onPress={onSkip}
              disabled={skipDisabled}
            />
          ) : null}
          <WaCircle
            icon={call.cameraOff ? 'videocam-off' : 'videocam'}
            size={52}
            bg={call.cameraOff ? '#fff' : 'rgba(55,55,55,0.85)'}
            color={call.cameraOff ? '#111' : '#fff'}
            onPress={() => call.toggleCamera()}
          />
          <WaCircle
            icon={call.speakerOn ? 'volume-high' : 'volume-mute'}
            size={52}
            bg={call.speakerOn ? '#fff' : 'rgba(55,55,55,0.85)'}
            color={call.speakerOn ? '#111' : '#fff'}
            onPress={() => {
              void call.toggleSpeaker();
            }}
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
      publicId={isExplore ? '' : call.peer?.publicId}
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
    <View style={styles.fullscreen}>
      {/* Always keep peer DP under video so fallback never blanks */}
      {(showPeerDp || !hasRemoteVideo) && <CallBackdrop photo={photo} />}

      {hasRemoteVideo ? (
        <RTCView
          streamURL={remoteUrl}
          style={styles.remoteVideo}
          objectFit="cover"
          mirror={false}
          zOrder={0}
        />
      ) : localFullscreen ? (
        <RTCView
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
            streamURL={localUrl}
            style={styles.pipVideo}
            objectFit="cover"
            mirror={call.localMirrored !== false}
            zOrder={1}
          />
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
  bgPhoto: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    transform: [{ scale: 1.12 }],
  },
  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26, 6, 46, 0.72)',
  },
  pip: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    zIndex: 15,
    elevation: 15,
    backgroundColor: '#111',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 16 },
    }),
  },
  pipVideo: {
    width: '100%',
    height: '100%',
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
    backgroundColor: 'rgba(26, 6, 46, 0.35)',
  },
  avatarImg: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  panel: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: T.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.panelBorder,
    height: 76,
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
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 12,
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
