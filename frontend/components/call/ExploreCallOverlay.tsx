import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
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

/** WhatsApp call screen + Luvstor purple accent */
const WA = {
  bg: '#0B141A',
  text: '#E9EDEF',
  textSecondary: '#8696A0',
  end: '#F15C6D',
  controlBg: 'rgba(255,255,255,0.14)',
  controlActive: '#FFFFFF',
  border: 'rgba(255,255,255,0.12)',
};

const PURPLE = '#6750A4';
const PURPLE_LIGHT = '#8E2DE2';

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function statusLabel(phase: string) {
  switch (phase) {
    case 'ringing':
      return 'Ringing…';
    case 'incoming':
      return 'Incoming Explore call';
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'connected':
      return '';
    default:
      return 'Explore call';
  }
}

function CircleBtn({
  icon,
  onPress,
  color = WA.text,
  bg = WA.controlBg,
  size = 56,
  disabled,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  color?: string;
  bg?: string;
  size?: number;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label || icon}
      style={({ pressed }) => [
        styles.circleBtn,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.82 : 1,
        },
      ]}>
      <Ionicons name={icon} size={size * 0.4} color={color} />
    </Pressable>
  );
}

export default function ExploreCallOverlay() {
  const insets = useSafeAreaInsets();
  const call = useCall();
  const { skipWithCooldown, cooldownSec } = useExplore();
  const [tick, setTick] = useState(0);
  const pulse = React.useRef(new Animated.Value(1)).current;
  const RTCView = useMemo(() => getRTCView(), []);

  const visible = call.isExplore && call.phase !== 'idle' && call.phase !== 'ended';

  useEffect(() => {
    if (call.phase !== 'connected' || !call.connectedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [call.phase, call.connectedAt]);

  useEffect(() => {
    if (call.phase === 'connected') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [call.phase, pulse]);

  if (!visible) return null;

  const photo = resolveMediaUrl(call.peer?.photo) || call.peer?.photo || '';
  const name = getDisplayName(call.peer?.name, call.peer?.publicId);
  const publicId = call.peer?.publicId || '';
  void tick;

  const duration =
    call.phase === 'connected' && call.connectedAt
      ? formatDuration(Date.now() - call.connectedAt)
      : '';

  const subtitle =
    call.phase === 'connected'
      ? duration || 'Connected'
      : statusLabel(call.phase);

  const showVideo =
    call.callType === 'video' &&
    (call.phase === 'connected' ||
      call.phase === 'connecting' ||
      call.phase === 'reconnecting');

  const skipDisabled = cooldownSec > 0;
  const showControls =
    call.phase === 'connected' ||
    call.phase === 'connecting' ||
    call.phase === 'reconnecting' ||
    call.phase === 'ringing' ||
    call.phase === 'incoming';

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={styles.fullscreen}>
        {showVideo && RTCView && call.remoteStream ? (
          <RTCView
            streamURL={call.remoteStream.toURL?.() || call.remoteStream.toURL()}
            style={styles.remoteVideo}
            objectFit="cover"
            mirror={false}
          />
        ) : photo ? (
          <>
            <Image
              source={{ uri: photo }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              blurRadius={22}
            />
            <View style={styles.dimOverlay} />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: WA.bg }]} />
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

        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <View style={styles.exploreBadge}>
            <Ionicons name="compass" size={14} color={PURPLE_LIGHT} />
            <Text style={styles.exploreBadgeText}>Explore</Text>
          </View>
        </View>

        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {publicId ? (
            <Text style={styles.publicId}>{publicId}</Text>
          ) : null}
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.center}>
          {!showVideo || !call.remoteStream ? (
            <Animated.View style={{ transform: [{ scale: pulse }] }}>
              <WhatsAppAvatar
                name={call.peer?.name}
                publicId={call.peer?.publicId}
                photo={photo}
                gender={call.peer?.gender}
                size={120}
              />
            </Animated.View>
          ) : null}
        </View>

        {showControls ? (
          <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={styles.row}>
              <View style={styles.actionCol}>
                <CircleBtn
                  icon={call.muted ? 'mic-off' : 'mic'}
                  label="Mute"
                  bg={call.muted ? WA.controlActive : WA.controlBg}
                  color={call.muted ? WA.bg : WA.text}
                  onPress={call.toggleMute}
                />
                <Text style={styles.actionLabel}>{call.muted ? 'Unmute' : 'Mute'}</Text>
              </View>
              {call.callType === 'video' ? (
                <View style={styles.actionCol}>
                  <CircleBtn
                    icon={call.cameraOff ? 'videocam-off' : 'videocam'}
                    label="Camera"
                    bg={call.cameraOff ? WA.controlActive : WA.controlBg}
                    color={call.cameraOff ? WA.bg : WA.text}
                    onPress={call.toggleCamera}
                  />
                  <Text style={styles.actionLabel}>Camera</Text>
                </View>
              ) : null}
              <View style={styles.actionCol}>
                <CircleBtn
                  icon={call.speakerOn ? 'volume-high' : 'volume-mute'}
                  label="Speaker"
                  bg={call.speakerOn ? WA.controlActive : WA.controlBg}
                  color={call.speakerOn ? WA.bg : WA.text}
                  onPress={call.toggleSpeaker}
                />
                <Text style={styles.actionLabel}>Speaker</Text>
              </View>
              {call.callType === 'video' ? (
                <View style={styles.actionCol}>
                  <CircleBtn
                    icon="camera-reverse"
                    label="Flip"
                    onPress={call.switchCamera}
                  />
                  <Text style={styles.actionLabel}>Flip</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.row, { marginTop: 24 }]}>
              <View style={styles.actionCol}>
                <Pressable
                  onPress={skipWithCooldown}
                  disabled={skipDisabled}
                  style={({ pressed }) => [
                    styles.skipBtn,
                    skipDisabled && styles.skipBtnDisabled,
                    pressed && !skipDisabled && { opacity: 0.85 },
                  ]}>
                  <Ionicons name="play-skip-forward" size={22} color="#EADDFF" />
                  <Text style={styles.skipBtnText}>
                    {skipDisabled ? `Skip (${cooldownSec}s)` : 'Skip'}
                  </Text>
                </Pressable>
                <Text style={styles.actionLabel}>Next person</Text>
              </View>
              <View style={styles.actionCol}>
                <CircleBtn
                  icon="call"
                  label="End"
                  bg={WA.end}
                  color="#fff"
                  onPress={call.endCall}
                  size={64}
                />
                <Text style={styles.actionLabel}>End</Text>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9998,
    elevation: 9998,
  },
  fullscreen: {
    flex: 1,
    backgroundColor: WA.bg,
  },
  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 20, 26, 0.72)',
  },
  pip: {
    position: 'absolute',
    right: 14,
    width: 108,
    height: 156,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: WA.border,
    zIndex: 5,
  },
  pipVideo: {
    width: '100%',
    height: '100%',
  },
  topBar: {
    alignItems: 'center',
    zIndex: 6,
  },
  exploreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(103, 80, 164, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(142, 45, 226, 0.4)',
  },
  exploreBadgeText: {
    color: '#EADDFF',
    fontSize: 12,
    fontWeight: '600',
  },
  identity: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    zIndex: 2,
  },
  name: {
    fontSize: 26,
    fontWeight: '500',
    color: WA.text,
    textAlign: 'center',
  },
  publicId: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '500',
    color: '#C4B5FD',
    letterSpacing: 0.3,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 15,
    color: WA.textSecondary,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    paddingHorizontal: 16,
    zIndex: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
  },
  actionCol: {
    alignItems: 'center',
    minWidth: 80,
  },
  actionLabel: {
    marginTop: 8,
    color: WA.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
  circleBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 120,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: PURPLE_LIGHT,
    backgroundColor: 'rgba(103, 80, 164, 0.25)',
  },
  skipBtnDisabled: {
    opacity: 0.55,
    borderColor: WA.textSecondary,
  },
  skipBtnText: {
    color: '#EADDFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
