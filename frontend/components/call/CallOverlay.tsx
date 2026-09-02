import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
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

/** WhatsApp call screen palette */
const WA = {
  bg: '#0B141A',
  bgAlt: '#111B21',
  panel: '#1F2C34',
  text: '#E9EDEF',
  textSecondary: '#8696A0',
  accept: '#25D366',
  decline: '#F15C6D',
  end: '#F15C6D',
  controlBg: 'rgba(255,255,255,0.14)',
  controlActive: '#FFFFFF',
  border: 'rgba(255,255,255,0.12)',
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

function statusLabel(phase: string, endReason: string | null) {
  switch (phase) {
    case 'outgoing':
      return 'Calling…';
    case 'ringing':
      return 'Ringing…';
    case 'incoming':
      return 'Incoming call';
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'connected':
      return '';
    case 'ended':
      if (endReason === 'decline' || endReason === 'rejected') return 'Declined';
      if (endReason === 'cancel') return 'Cancelled';
      if (endReason === 'timeout' || endReason === 'missed') return 'No answer';
      if (endReason === 'busy') return 'Busy';
      if (endReason === 'offline') return 'Unavailable';
      if (endReason === 'error') return 'Call failed';
      return 'Call ended';
    default:
      return '';
  }
}

function qualityIcon(q: string) {
  if (q === 'excellent' || q === 'good') return 'cellular';
  if (q === 'fair') return 'cellular-outline';
  return 'warning-outline';
}

function CircleBtn({
  icon,
  label,
  onPress,
  color = WA.text,
  bg = WA.controlBg,
  size = 56,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  color?: string;
  bg?: string;
  size?: number;
  disabled?: boolean;
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
      <Ionicons name={icon} size={size * 0.4} color={color} />
    </Pressable>
  );
}

export default function CallOverlay() {
  const insets = useSafeAreaInsets();
  const call = useCall();
  const [tick, setTick] = useState(0);
  const pulse = React.useRef(new Animated.Value(1)).current;
  const RTCView = useMemo(() => getRTCView(), []);

  const visible = call.phase !== 'idle';

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
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
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
      : statusLabel(call.phase, call.endReason);

  if (call.minimized && call.phase !== 'incoming' && call.phase !== 'ended') {
    return (
      <Pressable
        style={[styles.miniBar, { top: insets.top + 8 }]}
        onPress={() => call.setMinimized(false)}
      >
        <View style={styles.miniInner}>
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
            color={WA.accept}
          />
        </View>
      </Pressable>
    );
  }

  const showVideo =
    call.callType === 'video' &&
    (call.phase === 'connected' ||
      call.phase === 'connecting' ||
      call.phase === 'reconnecting');

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
          <View style={StyleSheet.absoluteFill} />
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

        <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
          {(call.phase === 'connected' ||
            call.phase === 'connecting' ||
            call.phase === 'reconnecting') && (
            <Pressable
              onPress={() => call.setMinimized(true)}
              hitSlop={12}
              style={styles.iconHit}
            >
              <Ionicons name="chevron-down" size={26} color={WA.text} />
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          {call.phase === 'connected' ? (
            <View style={styles.qualityPill}>
              <Ionicons
                name={qualityIcon(call.quality) as any}
                size={14}
                color={WA.textSecondary}
              />
              <Text style={styles.qualityText}>{call.quality}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {call.error ? (
            <Text style={styles.error} numberOfLines={2}>
              {call.error}
            </Text>
          ) : null}
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

        <View
          style={[
            styles.controls,
            { paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}
        >
          {call.phase === 'incoming' ? (
            <View style={styles.rowWide}>
              <View style={styles.actionCol}>
                <CircleBtn
                  icon="call"
                  label="Decline"
                  bg={WA.decline}
                  color="#fff"
                  onPress={call.declineCall}
                  size={64}
                />
                <Text style={styles.actionLabel}>Decline</Text>
              </View>
              <View style={styles.actionCol}>
                <CircleBtn
                  icon={call.callType === 'video' ? 'videocam' : 'call'}
                  label="Accept"
                  bg={WA.accept}
                  color="#fff"
                  onPress={call.acceptCall}
                  size={64}
                />
                <Text style={styles.actionLabel}>Accept</Text>
              </View>
            </View>
          ) : call.phase === 'outgoing' || call.phase === 'ringing' ? (
            <View style={styles.row}>
              <View style={styles.actionCol}>
                <CircleBtn
                  icon="call"
                  label="Cancel"
                  bg={WA.end}
                  color="#fff"
                  onPress={call.cancelCall}
                  size={64}
                />
                <Text style={styles.actionLabel}>Cancel</Text>
              </View>
            </View>
          ) : call.phase === 'ended' ? (
            <View style={styles.row}>
              <Text style={styles.endedHint}>Returning…</Text>
            </View>
          ) : (
            <>
              <View style={styles.row}>
                <View style={styles.actionCol}>
                  <CircleBtn
                    icon={call.muted ? 'mic-off' : 'mic'}
                    label="Mute"
                    bg={call.muted ? WA.controlActive : WA.controlBg}
                    color={call.muted ? WA.bgAlt : WA.text}
                    onPress={call.toggleMute}
                  />
                  <Text style={styles.actionLabel}>
                    {call.muted ? 'Unmute' : 'Mute'}
                  </Text>
                </View>
                {call.callType === 'video' ? (
                  <View style={styles.actionCol}>
                    <CircleBtn
                      icon={call.cameraOff ? 'videocam-off' : 'videocam'}
                      label="Camera"
                      bg={call.cameraOff ? WA.controlActive : WA.controlBg}
                      color={call.cameraOff ? WA.bgAlt : WA.text}
                      onPress={call.toggleCamera}
                    />
                    <Text style={styles.actionLabel}>Camera</Text>
                  </View>
                ) : (
                  <View style={styles.actionCol}>
                    <CircleBtn
                      icon="videocam"
                      label="Video"
                      onPress={call.switchToVideo}
                    />
                    <Text style={styles.actionLabel}>Video</Text>
                  </View>
                )}
                <View style={styles.actionCol}>
                  <CircleBtn
                    icon={call.speakerOn ? 'volume-high' : 'volume-mute'}
                    label="Speaker"
                    bg={call.speakerOn ? WA.controlActive : WA.controlBg}
                    color={call.speakerOn ? WA.bgAlt : WA.text}
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
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    zIndex: 6,
  },
  iconHit: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  qualityText: {
    color: WA.textSecondary,
    fontSize: 12,
    textTransform: 'capitalize',
  },
  identity: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    zIndex: 2,
  },
  name: {
    fontSize: 26,
    fontWeight: '500',
    color: WA.text,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 15,
    color: WA.textSecondary,
    textAlign: 'center',
  },
  error: {
    marginTop: 8,
    color: '#FFB4BC',
    textAlign: 'center',
    paddingHorizontal: 16,
    fontSize: 13,
    lineHeight: 18,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
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
  rowWide: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
  },
  actionCol: {
    alignItems: 'center',
    minWidth: 72,
  },
  actionLabel: {
    marginTop: 8,
    color: WA.textSecondary,
    fontSize: 12,
  },
  circleBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  endedHint: {
    color: WA.textSecondary,
    fontSize: 14,
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
    borderRadius: 12,
    backgroundColor: WA.panel,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 6 },
    }),
  },
  miniName: {
    color: WA.text,
    fontSize: 15,
    fontWeight: '500',
  },
  miniSub: {
    color: WA.accept,
    fontSize: 12,
    marginTop: 2,
  },
});
