/**
 * WhatsApp-style voice note bubble — play/pause, progress, seek, one-at-a-time.
 */
import { Ionicons } from '@expo/vector-icons';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { resolveMediaUrl } from '../utils/media';
import {
  claimVoicePlayback,
  releaseVoicePlayback,
} from '../utils/voiceMessages';

const VOICE_WAVE_HEIGHTS = [
  7, 12, 9, 15, 11, 14, 8, 13, 10, 16, 12, 8, 14, 9, 13, 11,
];

const SENDER_BUBBLE_BLACK = '#111111';

function fmtVoice(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

type TickProps = {
  pending?: boolean;
  failed?: boolean;
  undelivered?: boolean;
  delivered?: boolean;
  read?: boolean;
};

type Props = {
  messageId: string;
  uri: string;
  isMe: boolean;
  createdAt: number;
  pending?: boolean;
  failed?: boolean;
  undelivered?: boolean;
  delivered?: boolean;
  read?: boolean;
  /** Optional delivery ticks rendered by parent (keeps chat styles consistent) */
  renderTicks?: (p: TickProps) => React.ReactNode;
};

export default function VoiceMessageBubble({
  messageId,
  uri,
  isMe,
  createdAt,
  pending,
  failed,
  undelivered,
  delivered,
  read,
  renderTicks,
}: Props) {
  const [sound, setSound] = useState<AudioPlayer | null>(null);
  const soundRef = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [playError, setPlayError] = useState(false);
  const waveWidthRef = useRef(140);
  const playableUri = resolveMediaUrl(uri) || uri;
  const voiceId = messageId || playableUri;

  const pauseLocal = useCallback(() => {
    try {
      soundRef.current?.pause();
    } catch {
      /* ignore */
    }
    setPlaying(false);
  }, []);

  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  useEffect(
    () => () => {
      releaseVoicePlayback(voiceId);
      try {
        soundRef.current?.pause();
        soundRef.current?.remove();
      } catch {
        /* ignore */
      }
      soundRef.current = null;
    },
    [voiceId],
  );

  async function ensurePlayer(): Promise<AudioPlayer | null> {
    if (soundRef.current) return soundRef.current;
    if (!playableUri) return null;
    if (playableUri.startsWith('file://') && !isMe) return null;

    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      shouldRouteThroughEarpiece: false,
    });
    const s = createAudioPlayer(
      { uri: playableUri },
      { updateInterval: 80 },
    );
    soundRef.current = s;
    setSound(s);
    (s as AudioPlayer & {
      addListener: (
        event: string,
        listener: (status: {
          duration?: number;
          currentTime?: number;
          playing?: boolean;
          didJustFinish?: boolean;
        }) => void,
      ) => { remove: () => void };
    }).addListener('playbackStatusUpdate', (st) => {
      if (typeof st.duration === 'number' && st.duration > 0) {
        setDurationMs(st.duration * 1000);
      }
      if (typeof st.currentTime === 'number') {
        setPositionMs(st.currentTime * 1000);
      }
      setPlaying(!!st.playing);
      if (st.didJustFinish) {
        setPlaying(false);
        setPositionMs(0);
        releaseVoicePlayback(voiceId);
        void s.seekTo(0);
      }
    });
    return s;
  }

  async function toggle() {
    try {
      setPlayError(false);
      if (soundRef.current?.playing) {
        pauseLocal();
        releaseVoicePlayback(voiceId);
        return;
      }

      setLoading(true);
      const s = await ensurePlayer();
      if (!s) {
        setPlayError(true);
        return;
      }

      claimVoicePlayback(voiceId, pauseLocal);

      if (s.duration > 0 && s.currentTime >= s.duration - 0.05) {
        await s.seekTo(0);
      }
      s.play();
      setPlaying(true);
    } catch (e) {
      console.warn('Voice playback failed', e);
      setPlaying(false);
      setPlayError(true);
      releaseVoicePlayback(voiceId);
    } finally {
      setLoading(false);
    }
  }

  async function seekToRatio(ratio: number) {
    try {
      const s = await ensurePlayer();
      if (!s) return;
      const dur =
        s.duration > 0
          ? s.duration
          : durationMs > 0
            ? durationMs / 1000
            : 0;
      if (dur <= 0) return;
      const t = Math.max(0, Math.min(dur, ratio * dur));
      await s.seekTo(t);
      setPositionMs(t * 1000);
      if (!s.playing) {
        claimVoicePlayback(voiceId, pauseLocal);
        s.play();
        setPlaying(true);
      }
    } catch (e) {
      console.warn('Voice seek failed', e);
    }
  }

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const displayMs = playing || positionMs > 0 ? positionMs : durationMs;
  const barActiveColor = isMe ? '#FFFFFF' : '#8E2DE2';
  const barIdleColor = isMe ? 'rgba(255,255,255,0.35)' : '#C4B5D4';

  return (
    <View
      style={[
        styles.voiceBubble,
        isMe ? styles.myVoiceBubble : styles.otherVoiceBubble,
        playError && styles.voiceBubbleError,
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
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {loading ? (
          <ActivityIndicator size="small" color={isMe ? '#8E2DE2' : '#fff'} />
        ) : (
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={15}
            color={isMe ? '#8E2DE2' : '#fff'}
            style={!playing ? { marginLeft: 1 } : undefined}
          />
        )}
      </TouchableOpacity>

      <View style={styles.voiceBody}>
        <Pressable
          style={styles.voiceWaveRow}
          onLayout={(e) => {
            waveWidthRef.current = e.nativeEvent.layout.width || 140;
          }}
          onPress={(e) => {
            const x = e.nativeEvent.locationX;
            const w = waveWidthRef.current || 1;
            void seekToRatio(Math.max(0, Math.min(1, x / w)));
          }}
          accessibilityRole="adjustable"
          accessibilityLabel="Voice message progress"
        >
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
        </Pressable>
        <View style={styles.voiceMetaRow}>
          <Text
            style={[
              styles.voiceDuration,
              isMe ? styles.myVoiceDuration : styles.otherVoiceDuration,
            ]}
          >
            {playError ? "Can't play" : fmtVoice(displayMs || 0)}
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
            {isMe &&
              (renderTicks
                ? renderTicks({
                    pending,
                    failed,
                    undelivered,
                    delivered,
                    read,
                  })
                : null)}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  voiceBubble: {
    maxWidth: 210,
    minWidth: 160,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
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
    backgroundColor: '#F0F0F0',
    borderTopLeftRadius: 2,
  },
  voiceBubbleError: {
    opacity: 0.92,
  },
  voicePlayBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  myVoicePlayBtn: { backgroundColor: '#fff' },
  otherVoicePlayBtn: { backgroundColor: '#8E2DE2' },
  voiceBody: { flex: 1, minWidth: 0 },
  voiceWaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 22,
    gap: 2,
  },
  voiceWaveBar: {
    width: 2.5,
    borderRadius: 1.5,
  },
  voiceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  voiceDuration: { fontSize: 11, fontWeight: '500' },
  myVoiceDuration: { color: 'rgba(255,255,255,0.85)' },
  otherVoiceDuration: { color: '#667781' },
  voiceTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  voiceTime: { fontSize: 10 },
  myVoiceTime: { color: 'rgba(255,255,255,0.55)' },
  otherVoiceTime: { color: '#8696A0' },
});
