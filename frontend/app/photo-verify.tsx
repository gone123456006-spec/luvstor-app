import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiBase } from '../utils/api';
import { getAuthToken } from '../utils/auth';
import { uploadImageDurable } from '../utils/uploadMedia';
import { userFacingMessage } from '../utils/userFacingError';
import {
  fetchPhotoChallenge,
  fetchPhotoVerification,
  PhotoChallenge,
  PhotoVerification,
  submitPhotoVerification,
} from '../utils/verification';

const ANALYSIS_MS = 30 * 60 * 1000;
const POLL_MS = 20_000;
const COUNTDOWN_SEC = 3;
const BRAND = '#370372';

type PoseId = 'smile' | 'turn_left' | 'turn_right';

const POSE_SEQUENCE: {
  id: PoseId;
  label: string;
  instruction: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    id: 'smile',
    label: 'Smile',
    instruction: 'Look at the camera and smile naturally.',
    icon: 'happy-outline',
  },
  {
    id: 'turn_left',
    label: 'Turn left',
    instruction: 'Turn your head slightly to your left, then hold.',
    icon: 'arrow-back-circle-outline',
  },
  {
    id: 'turn_right',
    label: 'Turn right',
    instruction: 'Turn your head slightly to your right, then hold.',
    icon: 'arrow-forward-circle-outline',
  },
];

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type CapturedPose = { pose: PoseId; uri: string; base64?: string };

/**
 * Live front camera: smile → left → right, each auto-captures after countdown.
 */
function LiveAutoCaptureModal({
  visible,
  onClose,
  onComplete,
}: {
  visible: boolean;
  onClose: () => void;
  onComplete: (shots: CapturedPose[]) => void;
}) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [stepIndex, setStepIndex] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const shotsRef = useRef<CapturedPose[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);

  const clearCountdown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetSession = useCallback(() => {
    clearCountdown();
    shotsRef.current = [];
    setStepIndex(0);
    setCountdown(null);
    setCapturing(false);
    setReady(false);
    setFlash(false);
    startedRef.current = false;
  }, [clearCountdown]);

  useEffect(() => {
    if (!visible) {
      resetSession();
      return;
    }
    void (async () => {
      if (!permission?.granted) {
        await requestPermission();
      }
    })();
  }, [visible, permission?.granted, requestPermission, resetSession]);

  const captureCurrent = useCallback(async () => {
    if (capturing) return;
    const pose = POSE_SEQUENCE[stepIndex];
    if (!pose || !cameraRef.current) return;

    setCapturing(true);
    setFlash(true);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.55,
        base64: false,
        shutterSound: false,
        mirror: true,
      });
      if (!photo?.uri) throw new Error('Capture failed');

      shotsRef.current = [
        ...shotsRef.current.filter((s) => s.pose !== pose.id),
        {
          pose: pose.id,
          uri: photo.uri,
        },
      ];

      await new Promise((r) => setTimeout(r, 450));
      setFlash(false);

      const next = stepIndex + 1;
      if (next >= POSE_SEQUENCE.length) {
        onComplete([...shotsRef.current]);
        return;
      }
      setStepIndex(next);
      setCountdown(null);
      setCapturing(false);
      startedRef.current = false;
    } catch (err: any) {
      setFlash(false);
      setCapturing(false);
      Alert.alert('Capture failed', err?.message || 'Try again.');
      onClose();
    }
  }, [capturing, stepIndex, onComplete, onClose]);

  // Start countdown once camera is ready for each pose step
  useEffect(() => {
    if (!visible || !ready || !permission?.granted || capturing) return;
    if (startedRef.current) return;

    startedRef.current = true;
    let left = COUNTDOWN_SEC;
    setCountdown(left);

    clearCountdown();
    timerRef.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearCountdown();
        setCountdown(0);
        void captureCurrent();
      } else {
        setCountdown(left);
        void Haptics.selectionAsync();
      }
    }, 1000);

    return clearCountdown;
  }, [
    visible,
    ready,
    permission?.granted,
    capturing,
    stepIndex,
    captureCurrent,
    clearCountdown,
  ]);

  const pose = POSE_SEQUENCE[stepIndex];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={live.root}>
        <StatusBar barStyle="light-content" />
        {permission?.granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="front"
            mirror
            onCameraReady={() => setReady(true)}
          />
        ) : (
          <View style={live.permBox}>
            <Text style={live.permTitle}>Camera permission needed</Text>
            <Text style={live.permCopy}>
              Allow camera access for live photo verification.
            </Text>
            <TouchableOpacity
              style={live.permBtn}
              onPress={() => void requestPermission()}
            >
              <Text style={live.permBtnText}>Allow camera</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={{ marginTop: 16 }}>
              <Text style={live.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {flash ? <View style={live.flash} pointerEvents="none" /> : null}

        <SafeAreaView style={live.overlay} edges={['top', 'bottom']}>
          <View style={live.topBar}>
            <TouchableOpacity
              onPress={onClose}
              style={live.closeBtn}
              hitSlop={12}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={live.stepMeta}>
              Step {stepIndex + 1} of {POSE_SEQUENCE.length}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={live.progressRow}>
            {POSE_SEQUENCE.map((p, i) => (
              <View
                key={p.id}
                style={[
                  live.progressDot,
                  i < stepIndex && live.progressDone,
                  i === stepIndex && live.progressActive,
                ]}
              />
            ))}
          </View>

          <View style={live.ovalWrap} pointerEvents="none">
            <View style={live.oval} />
          </View>

          <View style={live.bottomCard}>
            <Ionicons name={pose?.icon || 'camera-outline'} size={36} color="#fff" />
            <Text style={live.poseLabel}>{pose?.label}</Text>
            <Text style={live.poseHint}>{pose?.instruction}</Text>

            {capturing ? (
              <Text style={live.countdown}>Capturing…</Text>
            ) : countdown !== null && countdown > 0 ? (
              <Text style={live.countdown}>{countdown}</Text>
            ) : countdown === 0 ? (
              <Text style={live.countdown}>Smile · hold</Text>
            ) : (
              <Text style={live.holdHint}>Hold still — auto capture</Text>
            )}

            <Text style={live.autoNote}>
              Camera clicks automatically. No button needed.
            </Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/**
 * Profile → Photo verification
 * Auto live poses: smile → left → right → submit.
 */
export default function PhotoVerifyScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<PhotoVerification | null>(null);
  const [challenge, setChallenge] = useState<PhotoChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dueAtRef = useRef<number | null>(null);
  const resultAlertedRef = useRef(false);
  const challengeRef = useRef<PhotoChallenge | null>(null);

  useEffect(() => {
    challengeRef.current = challenge;
  }, [challenge]);

  const clearTimers = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const watchPending = useCallback(
    (data: PhotoVerification, token: string) => {
      if (data.status !== 'pending') {
        clearTimers();
        setRemainingMs(0);
        dueAtRef.current = null;
        return;
      }

      const fromServer =
        typeof data.analysisInMs === 'number'
          ? data.analysisInMs
          : typeof data.autoApproveInMs === 'number'
            ? data.autoApproveInMs
            : data.submittedAt
              ? Math.max(
                  0,
                  new Date(data.submittedAt).getTime() + ANALYSIS_MS - Date.now(),
                )
              : ANALYSIS_MS;

      dueAtRef.current = Date.now() + fromServer;
      setRemainingMs(fromServer);

      if (!tickRef.current) {
        tickRef.current = setInterval(() => {
          if (!dueAtRef.current) return;
          setRemainingMs(Math.max(0, dueAtRef.current - Date.now()));
        }, 1000);
      }

      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          try {
            const next = await fetchPhotoVerification(token);
            setStatus(next);
            if (next.status === 'approved' || next.status === 'rejected') {
              clearTimers();
              setRemainingMs(0);
              if (!resultAlertedRef.current) {
                resultAlertedRef.current = true;
                if (next.status === 'approved') {
                  Alert.alert(
                    'Photo verified!',
                    'Analysis complete. Your profile now shows a verified badge.',
                  );
                } else {
                  Alert.alert(
                    'Not verified',
                    next.reviewNote ||
                      'Try again with a clearer live selfie.',
                  );
                }
              }
            } else if (next.status === 'pending') {
              const rem =
                typeof next.analysisInMs === 'number'
                  ? next.analysisInMs
                  : typeof next.autoApproveInMs === 'number'
                    ? next.autoApproveInMs
                    : 0;
              dueAtRef.current = Date.now() + rem;
              setRemainingMs(rem);
            }
          } catch {
            /* keep waiting */
          }
        }, POLL_MS);
      }
    },
    [clearTimers],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const token = await getAuthToken();
      if (!token) {
        setLoadError('Sign in required to verify your photo.');
        setStatus({ status: 'none' });
        return;
      }

      const me = await fetchPhotoVerification(token);
      setStatus(me);

      if (me.status === 'approved' || me.photoVerified) {
        resultAlertedRef.current = true;
        setChallenge(null);
        return;
      }

      if (me.status === 'pending') {
        setChallenge(null);
        watchPending(me, token);
        return;
      }

      try {
        const ch = await fetchPhotoChallenge(token);
        if (ch.alreadyVerified) {
          setStatus({ ...me, status: 'approved', photoVerified: true });
          return;
        }
        if ((ch as any).pending || ch.status === 'pending') {
          setStatus({ ...me, ...ch, status: 'pending' });
          watchPending({ ...me, ...ch, status: 'pending' }, token);
          return;
        }
        setChallenge(ch);
      } catch {
        setChallenge(null);
      }
    } catch (err: any) {
      setLoadError(userFacingMessage(err, 'Couldn’t load verification. Please try again.'));
      setStatus({ status: 'none' });
    } finally {
      setLoading(false);
    }
  }, [watchPending]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => clearTimers();
    }, [load, clearTimers]),
  );

  const refreshChallenge = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) return null;
    try {
      const ch = await fetchPhotoChallenge(token);
      if (!(ch as any).pending && !ch.alreadyVerified) {
        setChallenge(ch);
      }
      return ch;
    } catch (err: any) {
      Alert.alert('Could not get pose', err?.message || 'Try again.');
      return null;
    }
  }, []);

  const startAutoVerify = useCallback(async () => {
    if (uploading || status?.status === 'pending') return;
    const token = await getAuthToken();
    if (!token) {
      Alert.alert('Sign in required');
      return;
    }

    let ch = challenge;
    if (!ch?.challengeToken || !ch.pose) {
      ch = await refreshChallenge();
    }
    if (!ch?.challengeToken || !ch.pose) {
      Alert.alert('Could not start', 'Get a pose challenge first.');
      return;
    }
    challengeRef.current = ch;
    setCameraOpen(true);
  }, [uploading, status, challenge, refreshChallenge]);

  const onAutoCaptureComplete = useCallback(
    async (shots: CapturedPose[]) => {
      setCameraOpen(false);
      const token = await getAuthToken();
      if (!token) {
        Alert.alert('Sign in required');
        return;
      }

      let ch = challengeRef.current;
      if (!ch?.challengeToken || !ch.pose) {
        ch = await refreshChallenge();
      }
      if (!ch?.challengeToken || !ch.pose) {
        Alert.alert('Could not submit', 'Challenge expired — try again.');
        return;
      }

      const wanted = String(ch.pose) as PoseId;
      const match =
        shots.find((s) => s.pose === wanted) ||
        shots.find((s) => s.pose === 'smile') ||
        shots[shots.length - 1];

      if (!match) {
        Alert.alert('Could not submit', 'No selfie was captured.');
        return;
      }

      setUploading(true);
      try {
        if (!match.uri) throw new Error('Could not read selfie image');
        const url = await uploadImageDurable(match.uri, token);
        if (!url) throw new Error('Upload failed');

        const result = await submitPhotoVerification(token, url, {
          pose: ch.pose,
          challengeToken: ch.challengeToken,
        });
        setStatus(result);
        resultAlertedRef.current = false;

        if (result.status === 'pending' || result.decision === 'pending') {
          setChallenge(null);
          Alert.alert(
            'Selfie submitted',
            'Smile, left, and right captured. We are analysing for about 30 minutes.',
          );
          watchPending(result, token);
        } else if (result.status === 'approved') {
          Alert.alert('Photo verified!', result.message || 'You are verified.');
        } else if (result.status === 'rejected') {
          Alert.alert(
            'Try again',
            result.message || result.reviewNote || 'Try again.',
          );
          void refreshChallenge();
        }
      } catch (err: any) {
        Alert.alert('Could not submit', err?.message || 'Try again.');
        void refreshChallenge();
      } finally {
        setUploading(false);
      }
    },
    [refreshChallenge, watchPending],
  );

  const isApproved = status?.photoVerified || status?.status === 'approved';
  const isRejected = status?.status === 'rejected';
  const isPending = status?.status === 'pending';
  const canTakeSelfie = !isApproved && !isPending && !uploading;

  const poseIcon =
    challenge?.pose === 'smile'
      ? 'happy-outline'
      : challenge?.pose === 'turn_left'
        ? 'arrow-back-circle-outline'
        : challenge?.pose === 'turn_right'
          ? 'arrow-forward-circle-outline'
          : 'camera-outline';

  const heading = isApproved
    ? 'Photo verified'
    : isPending
      ? remainingMs > 0
        ? `Analysing · ${formatRemaining(remainingMs)} left`
        : 'Finishing analysis…'
      : isRejected
        ? 'Not matched — try again'
        : 'Auto live verification';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back" size={24} color="#1C1B1F" />
        </TouchableOpacity>
        <Text style={styles.title}>Photo verification</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND} />
          <Text style={styles.loadingText}>Loading verification…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.badge}>
            <Ionicons
              name={isApproved ? 'shield-checkmark' : 'shield-outline'}
              size={40}
              color={isApproved ? '#22C55E' : BRAND}
            />
          </View>
          <Text style={styles.heading}>{heading}</Text>
          <Text style={styles.copy}>
            {isApproved
              ? 'Your live selfie matched your profile photos. Badge is on Nearby and Explore.'
              : isPending
                ? 'We are comparing your display photo, gallery images, and this live selfie. About 30 minutes.'
                : 'Front camera opens and auto-clicks for Smile, Turn left, and Turn right. Hold each pose — no shutter button.'}
          </Text>

          {loadError ? <Text style={styles.note}>{loadError}</Text> : null}

          {!isApproved ? (
            <View style={styles.steps}>
              <Text style={styles.stepsTitle}>How it works</Text>
              <Text style={styles.stepLine}>1. Keep a clear face photo as your DP</Text>
              <Text style={styles.stepLine}>2. Smile — camera auto-clicks</Text>
              <Text style={styles.stepLine}>3. Turn left — auto-clicks</Text>
              <Text style={styles.stepLine}>4. Turn right — auto-clicks</Text>
              <Text style={styles.stepLine}>5. Wait ~30 min for approve or reject</Text>
            </View>
          ) : null}

          {canTakeSelfie ? (
            <View style={styles.poseCard}>
              <Ionicons name={poseIcon as any} size={40} color={BRAND} />
              <Text style={styles.poseLabel}>
                {challenge?.label || 'Ready when you are'}
              </Text>
              <Text style={styles.poseHint}>
                {challenge?.instruction ||
                  'Tap Start auto verify. The camera will guide Smile → Left → Right and click for you.'}
              </Text>
              <TouchableOpacity
                onPress={() => void refreshChallenge()}
                hitSlop={12}
                style={styles.newPoseBtn}
              >
                <Ionicons name="refresh" size={16} color={BRAND} />
                <Text style={styles.newPose}>
                  {challenge ? 'Refresh challenge' : 'Get challenge'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {status?.selfieUrl ? (
            <Image
              source={{
                uri: status.selfieUrl.startsWith('http')
                  ? status.selfieUrl
                  : `${getApiBase()}${status.selfieUrl}`,
              }}
              style={styles.preview}
              contentFit="cover"
            />
          ) : null}

          {isRejected && status?.reviewNote ? (
            <Text style={styles.note}>{status.reviewNote}</Text>
          ) : null}

          {uploading ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={BRAND} />
              <Text style={styles.busyText}>Uploading live selfie…</Text>
            </View>
          ) : null}

          {isPending ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={BRAND} />
              <Text style={styles.busyText}>
                {remainingMs > 0
                  ? `Analysing DP + photos + selfie · ${formatRemaining(remainingMs)}`
                  : 'Almost done…'}
              </Text>
            </View>
          ) : null}

          {canTakeSelfie ? (
            <TouchableOpacity
              style={styles.btn}
              onPress={() => void startAutoVerify()}
              activeOpacity={0.85}
            >
              <Ionicons name="scan-outline" size={22} color="#fff" />
              <Text style={styles.btnText}>
                {isRejected ? 'Retake auto verify' : 'Start auto verify'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {loadError ? (
            <TouchableOpacity style={styles.linkBtn} onPress={() => void load()}>
              <Text style={styles.newPose}>Retry</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}

      <LiveAutoCaptureModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onComplete={(shots) => void onAutoCaptureComplete(shots)}
      />
    </SafeAreaView>
  );
}

const live = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepMeta: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  progressDot: {
    width: 28,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  progressDone: {
    backgroundColor: '#78DE45',
  },
  progressActive: {
    backgroundColor: '#fff',
  },
  ovalWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oval: {
    width: 260,
    height: 340,
    borderRadius: 130,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  bottomCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  poseLabel: {
    marginTop: 10,
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },
  poseHint: {
    marginTop: 6,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
  },
  countdown: {
    marginTop: 14,
    fontSize: 48,
    fontWeight: '800',
    color: '#fff',
  },
  holdHint: {
    marginTop: 14,
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  autoNote: {
    marginTop: 10,
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.85)',
    zIndex: 5,
  },
  permBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#111',
  },
  permTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  permCopy: {
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: 20,
  },
  permBtn: {
    backgroundColor: BRAND,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permBtnText: { color: '#fff', fontWeight: '700' },
  cancelText: { color: 'rgba(255,255,255,0.7)' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E7E0EC',
  },
  back: { padding: 6, marginRight: 4 },
  title: { fontSize: 18, fontWeight: '700', color: '#1C1B1F' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { color: '#49454F' },
  scroll: { padding: 24, alignItems: 'center', paddingBottom: 48 },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#EFE8F8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1B1F',
    marginBottom: 8,
    textAlign: 'center',
  },
  copy: {
    textAlign: 'center',
    color: '#49454F',
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  steps: {
    width: '100%',
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E7E0EC',
  },
  stepsTitle: {
    fontWeight: '700',
    color: '#1C1B1F',
    marginBottom: 8,
    fontSize: 15,
  },
  stepLine: { color: '#49454F', lineHeight: 22, fontSize: 14 },
  poseCard: {
    width: '100%',
    backgroundColor: '#EFE8F8',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    marginBottom: 16,
  },
  poseLabel: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1B1F',
  },
  poseHint: {
    marginTop: 6,
    textAlign: 'center',
    color: '#49454F',
    lineHeight: 20,
  },
  newPoseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    padding: 6,
  },
  newPose: { color: BRAND, fontWeight: '600', fontSize: 15 },
  preview: {
    width: 160,
    height: 160,
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: '#eee',
  },
  note: {
    color: '#B3261E',
    marginBottom: 12,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 10,
    paddingHorizontal: 8,
  },
  busyText: { color: BRAND, fontWeight: '600', flexShrink: 1 },
  btn: {
    marginTop: 12,
    backgroundColor: BRAND,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 14,
    minWidth: 220,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  linkBtn: { marginTop: 16, padding: 8 },
});
