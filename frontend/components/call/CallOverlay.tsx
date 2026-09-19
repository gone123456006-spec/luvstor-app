import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCall } from '../../contexts/CallContext';
import { getRTCView } from '../../services/webrtc';
import { resolveMediaUrl } from '../../utils/media';
import WhatsAppAvatar, { getDisplayName } from '../WhatsAppAvatar';

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
  opts?: { peerOffline?: boolean },
) {
  switch (phase) {
    case 'outgoing':
      return 'Calling…';
    case 'ringing':
      return opts?.peerOffline ? 'They’re offline' : 'Ringing…';
    case 'incoming':
      return 'Incoming voice call';
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
  bg?: string;
  size?: number;
  iconRotate?: string;
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
  const [tick, setTick] = useState(0);
  const pulse = React.useRef(new Animated.Value(1)).current;
  const enterOpacity = React.useRef(new Animated.Value(0)).current;
  const enterScale = React.useRef(new Animated.Value(0.94)).current;
  const enterY = React.useRef(new Animated.Value(22)).current;
  const wasOpen = React.useRef(false);
  const RTCView = useMemo(() => getRTCView(), []);

  const visible = call.phase !== 'idle';
  const isVoice = call.callType !== 'video';
  const panelBottomRef = React.useRef<number | null>(null);
  if (!visible) {
    panelBottomRef.current = null;
  } else if (panelBottomRef.current == null) {
    panelBottomRef.current = Math.max(insets.bottom, 16) + 28;
  }
  const panelBottom = panelBottomRef.current ?? Math.max(insets.bottom, 16) + 28;

  // Smooth open — crossfade over chat (chat fades out in messages screen)
  useEffect(() => {
    const open = visible && !call.isExplore;
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
  }, [visible, call.isExplore, enterOpacity, enterScale, enterY]);

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

  if (!visible || call.isExplore) return null;

  const name = getDisplayName(call.peer?.name, call.peer?.publicId);
  const photo = resolveMediaUrl(call.peer?.photo) || call.peer?.photo || '';
  const duration =
    call.phase === 'connected' && call.connectedAt
      ? formatDuration(Date.now() - call.connectedAt)
      : '';
  void tick;
  const subtitle =
    call.phase === 'connected'
      ? duration || 'Connected'
      : statusLabel(call.phase, call.endReason, {
          peerOffline: !!call.peerOffline,
        });

  const openPeerChat = () => {
    const id = call.peer?.id;
    if (!id || id === 'explore') return;
    call.setMinimized(true);
    router.push(`/messages/${id}` as any);
  };

  const canMinimize =
    call.phase === 'connected' ||
    call.phase === 'connecting' ||
    call.phase === 'reconnecting' ||
    call.phase === 'outgoing' ||
    call.phase === 'ringing';

  const showVideo =
    !isVoice &&
    (call.phase === 'connected' ||
      call.phase === 'connecting' ||
      call.phase === 'reconnecting');

  const showActiveControls =
    call.phase === 'outgoing' ||
    call.phase === 'ringing' ||
    call.phase === 'connecting' ||
    call.phase === 'reconnecting' ||
    call.phase === 'connected';

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
              name={call.peer?.name}
              publicId={call.peer?.publicId}
              photo={photo}
              gender={call.peer?.gender}
              size={36}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.miniName} numberOfLines={1}>
                {name}
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

      <Pressable
        onPress={openPeerChat}
        hitSlop={10}
        style={styles.topBtn}
        disabled={!call.peer?.id || call.peer.id === 'explore'}
      >
        <Ionicons name="chatbubble-outline" size={20} color={T.text} />
      </Pressable>
    </View>
  );

  const controlPill = (
    <View
      pointerEvents="box-none"
      style={[styles.panelFixed, { bottom: panelBottom }]}
    >
      <BlurView intensity={48} tint="dark" style={styles.panel}>
        {call.phase === 'incoming' ? (
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
            {!isVoice ? (
              <>
                <ActionCell
                  icon={call.muted ? 'mic-off' : 'mic'}
                  label={call.muted ? 'Unmute' : 'Mute'}
                  bg={call.muted ? T.controlOn : T.control}
                  color={call.muted ? T.controlOnInk : T.text}
                  onPress={call.toggleMute}
                />
                <ActionCell
                  icon={call.cameraOff ? 'videocam-off' : 'videocam'}
                  label="Camera"
                  bg={call.cameraOff ? T.controlOn : T.control}
                  color={call.cameraOff ? T.controlOnInk : T.text}
                  onPress={call.toggleCamera}
                />
                <ActionCell
                  icon={call.speakerOn ? 'volume-high' : 'volume-mute'}
                  label="Speaker"
                  bg={call.speakerOn ? T.controlOn : T.control}
                  color={call.speakerOn ? T.controlOnInk : T.text}
                  onPress={call.toggleSpeaker}
                />
              </>
            ) : (
              <>
                <ActionCell
                  icon={call.speakerOn ? 'volume-high' : 'volume-mute'}
                  label="Speaker"
                  bg={call.speakerOn ? T.controlOn : T.control}
                  color={call.speakerOn ? T.controlOnInk : T.text}
                  onPress={call.toggleSpeaker}
                />
                <ActionCell
                  icon={call.muted ? 'mic-off' : 'mic'}
                  label={call.muted ? 'Unmute' : 'Mute'}
                  bg={call.muted ? T.controlOn : T.control}
                  color={call.muted ? T.controlOnInk : T.text}
                  onPress={call.toggleMute}
                />
              </>
            )}
            <ActionCell
              icon="call"
              label="End"
              bg={T.end}
              color="#fff"
              iconRotate="135deg"
              onPress={
                call.phase === 'outgoing' || call.phase === 'ringing'
                  ? call.cancelCall
                  : call.endCall
              }
            />
          </View>
        ) : null}
      </BlurView>
    </View>
  );

  const peerAvatar = (
    <CenterPeerAvatar
      name={call.peer?.name}
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
    <View style={styles.fullscreen}>
      {showVideo && RTCView && call.remoteStream ? (
        <RTCView
          streamURL={call.remoteStream.toURL?.() || call.remoteStream.toURL()}
          style={styles.remoteVideo}
          objectFit="cover"
          mirror={false}
        />
      ) : (
        <CallBackdrop photo={photo} />
      )}

      {showVideo && RTCView && call.localStream && !call.cameraOff ? (
        <View style={[styles.pip, { top: insets.top + 52 }]}>
          <RTCView
            streamURL={call.localStream.toURL?.() || call.localStream.toURL()}
            style={styles.pipVideo}
            objectFit="cover"
            mirror
          />
        </View>
      ) : null}

      {topBar}

      {!(showVideo && call.remoteStream) ? (
        <View style={centerAvatarStyle} pointerEvents="none">
          {peerAvatar}
        </View>
      ) : null}

      {controlPill}
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
        {isVoice ? voiceBody : videoBody}
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
    right: 14,
    width: 108,
    height: 156,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    zIndex: 5,
  },
  pipVideo: {
    width: '100%',
    height: '100%',
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
