/**
 * WebRTC peer connection wrapper for Luvstor calling.
 * Uses react-native-webrtc on native (dev/production builds).
 * Expo Go cannot load native WebRTC — isWebRTCAvailable() returns false there.
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';
import {
  NativeModules,
  PermissionsAndroid,
  Platform,
  TurboModuleRegistry,
} from 'react-native';

// Optional — iOS mic prompt before getUserMedia
let expoAudioPerms: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  expoAudioPerms = require('expo-audio');
} catch {
  expoAudioPerms = null;
}

export type CallMediaType = 'voice' | 'video';

export type NetworkQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

/** WhatsApp-style adaptive encode presets (send-side). */
const VIDEO_QUALITY: Record<
  NetworkQuality,
  { width: number; height: number; frameRate: number; maxBitrate: number }
> = {
  excellent: { width: 720, height: 1280, frameRate: 30, maxBitrate: 1_500_000 },
  good: { width: 540, height: 960, frameRate: 24, maxBitrate: 900_000 },
  fair: { width: 360, height: 640, frameRate: 18, maxBitrate: 450_000 },
  poor: { width: 240, height: 426, frameRate: 12, maxBitrate: 200_000 },
  unknown: { width: 540, height: 960, frameRate: 24, maxBitrate: 900_000 },
};

type PeerHandlers = {
  onLocalStream?: (stream: any) => void;
  onRemoteStream?: (stream: any) => void;
  onIceCandidate?: (candidate: any) => void;
  onConnectionState?: (state: string) => void;
  onIceConnectionState?: (state: string) => void;
  onNegotiationNeeded?: () => void;
  onError?: (err: Error) => void;
};

let WebRTC: any = null;
let loadError: string | null = null;

/** True only inside the real Expo Go client (not standalone / APK / dev-client). */
function isExpoGoRuntime(): boolean {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return true;
  }
  // Fallback for older Constants shapes
  return Constants.appOwnership === 'expo';
}

/** Resolve native WebRTC under bridgeless / New Architecture. */
function probeNativeWebRTCModule(): any {
  try {
    const fromNative = (NativeModules as any)?.WebRTCModule;
    if (fromNative != null) return fromNative;
  } catch {
    /* RN 0.80+ TurboModule interop can throw while parsing WebRTCModule */
  }
  try {
    return TurboModuleRegistry.get('WebRTCModule');
  } catch {
    return null;
  }
}

function loadWebRTC() {
  if (WebRTC) return WebRTC;

  if (Platform.OS === 'web') {
    return null;
  }

  const nativeMod = probeNativeWebRTCModule();

  // Real Expo Go has no WebRTC native module — stop early with a clear reason.
  // Standalone APKs must never be treated as Expo Go just because of Constants quirks.
  if (isExpoGoRuntime() && nativeMod == null) {
    loadError = 'expo-go';
    return null;
  }

  if (nativeMod != null && (NativeModules as any).WebRTCModule == null) {
    try {
      (NativeModules as any).WebRTCModule = nativeMod;
    } catch {
      /* Proxy NativeModules may ignore assignment — library patch covers that */
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    WebRTC = require('react-native-webrtc');
    loadError = null;
  } catch (err) {
    loadError = (err as Error)?.message || 'load-failed';
    console.warn('[WebRTC] Native module failed to load:', loadError);
    WebRTC = null;
  }
  return WebRTC;
}

export function isWebRTCAvailable(): boolean {
  if (Platform.OS === 'web') {
    return typeof (globalThis as any).RTCPeerConnection === 'function';
  }
  // Retry on each check until success — native modules can be late on cold start
  return !!loadWebRTC();
}

/** User-facing reason when calls cannot start. */
export function getWebRTCUnavailableMessage(): string {
  if (loadError === 'expo-go' || (isExpoGoRuntime() && !probeNativeWebRTCModule())) {
    return 'Voice/video calls need the Luvstor APK (Expo Go does not include WebRTC).';
  }
  if (loadError) {
    return (
      'Voice/video calls could not start (WebRTC failed to load). ' +
      'Install the latest Luvstor APK rebuild.'
    );
  }
  return 'Voice/video calls are not available on this install. Update to the latest APK.';
}

export class CallPermissionError extends Error {
  kind: 'microphone' | 'camera';
  /** True when Android won't show the system dialog again — open Settings. */
  needsSettings: boolean;
  constructor(kind: 'microphone' | 'camera', needsSettings = false) {
    super(
      kind === 'microphone'
        ? 'Microphone permission is required to call.'
        : 'Camera permission is required for video calls.'
    );
    this.name = 'CallPermissionError';
    this.kind = kind;
    this.needsSettings = needsSettings;
  }
}

function isAndroidGranted(
  result: string | undefined | null
): boolean {
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function isAndroidBlocked(
  result: string | undefined | null
): boolean {
  return (
    result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
    // Some OEM / RN builds return denied with no re-prompt
    result === 'never_ask_again'
  );
}

/**
 * Production release APKs always enforce mic/camera.
 * Local Metro / `__DEV__` builds skip so emulator testing isn't blocked.
 */
function shouldEnforceCallPermissions(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return false;
  return true;
}

/**
 * Ask for mic (and camera / Bluetooth for speaker routing) BEFORE the calling UI.
 * WhatsApp-style: permission dialogs first, then ring.
 * Skipped on local/dev — enforced only for production API builds.
 */
export async function ensureCallPermissions(
  callType: CallMediaType
): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!shouldEnforceCallPermissions()) return;

  if (Platform.OS === 'ios') {
    const req =
      expoAudioPerms?.requestRecordingPermissionsAsync ||
      expoAudioPerms?.AudioModule?.requestRecordingPermissionsAsync;
    if (typeof req === 'function') {
      const result = await req();
      const granted =
        result?.granted === true ||
        result?.status === 'granted' ||
        String(result?.status || '').toLowerCase() === 'granted';
      if (!granted) throw new CallPermissionError('microphone', true);
    }
    if (callType === 'video') {
      // Camera is prompted by getUserMedia / expo-camera when needed
    }
    return;
  }

  // Android — request one-by-one so the mic dialog always appears
  const mic = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  const cam = PermissionsAndroid.PERMISSIONS.CAMERA;
  const bt = (PermissionsAndroid.PERMISSIONS as any).BLUETOOTH_CONNECT as
    | string
    | undefined;

  const micAlready = await PermissionsAndroid.check(mic);
  if (!micAlready) {
    const micResult = await PermissionsAndroid.request(mic, {
      title: 'Microphone',
      message: 'Luvstor needs the microphone for voice calls.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    });
    if (!isAndroidGranted(micResult)) {
      throw new CallPermissionError('microphone', isAndroidBlocked(micResult));
    }
  }

  if (callType === 'video') {
    const camAlready = await PermissionsAndroid.check(cam);
    if (!camAlready) {
      const camResult = await PermissionsAndroid.request(cam, {
        title: 'Camera',
        message: 'Luvstor needs the camera for video calls.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      });
      if (!isAndroidGranted(camResult)) {
        throw new CallPermissionError('camera', isAndroidBlocked(camResult));
      }
    }
  }

  // Speaker / headset routing on Android 12+ (optional)
  if (bt && Number(Platform.Version) >= 31) {
    try {
      const btOk = await PermissionsAndroid.check(bt);
      if (!btOk) {
        await PermissionsAndroid.request(bt, {
          title: 'Nearby devices',
          message: 'Optional — used to connect Bluetooth headsets during calls.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        });
      }
    } catch {
      /* optional */
    }
  }
}

function getRTC() {
  if (Platform.OS === 'web') {
    return {
      RTCPeerConnection: (globalThis as any).RTCPeerConnection,
      mediaDevices: (globalThis as any).navigator?.mediaDevices,
      MediaStream: (globalThis as any).MediaStream,
      RTCSessionDescription: (globalThis as any).RTCSessionDescription,
      RTCIceCandidate: (globalThis as any).RTCIceCandidate,
    };
  }
  const mod = loadWebRTC();
  if (!mod) throw new Error(getWebRTCUnavailableMessage());
  return mod;
}

/**
 * Prefer Opus for voice (WhatsApp-quality narrowband→wideband path).
 * Reorders payload types in the audio m-line so Opus is first.
 */
function preferOpusSdp(sdp: string): string {
  if (!sdp) return sdp;
  const lines = sdp.split(/\r?\n/);
  const opusPt = lines
    .map((l) => /^a=rtpmap:(\d+)\s+opus\/48000/i.exec(l))
    .find(Boolean)?.[1];
  if (!opusPt) return sdp;

  return lines
    .map((line) => {
      if (!line.startsWith('m=audio ')) return line;
      const parts = line.split(' ');
      // m=audio port proto pt pt pt…
      if (parts.length < 4) return line;
      const head = parts.slice(0, 3);
      const pts = parts.slice(3).filter(Boolean);
      const rest = pts.filter((p) => p !== opusPt);
      return [...head, opusPt, ...rest].join(' ');
    })
    .join('\r\n');
}

export class CallPeer {
  private pc: any = null;
  private localStream: any = null;
  private remoteStream: any = null;
  private handlers: PeerHandlers;
  private iceServers: any[];
  private isCaller: boolean;
  private callType: CallMediaType;
  private disposed = false;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private onQuality?: (q: NetworkQuality) => void;
  private lastQuality: NetworkQuality = 'unknown';
  private facingFront = true;
  private adaptBusy = false;

  constructor(opts: {
    iceServers: any[];
    isCaller: boolean;
    callType: CallMediaType;
    handlers: PeerHandlers;
    onQuality?: (q: NetworkQuality) => void;
  }) {
    this.iceServers = opts.iceServers?.length
      ? opts.iceServers
      : [{ urls: 'stun:stun.l.google.com:19302' }];
    this.isCaller = opts.isCaller;
    this.callType = opts.callType;
    this.handlers = opts.handlers;
    this.onQuality = opts.onQuality;
  }

  /** Update ICE (TURN) without tearing down the local camera preview. */
  updateIceServers(iceServers: any[]) {
    if (!iceServers?.length) return;
    this.iceServers = iceServers;
    try {
      this.pc?.setConfiguration?.({ iceServers: this.iceServers });
    } catch (err) {
      console.warn('[WebRTC] setConfiguration:', (err as Error).message);
    }
  }

  isFrontCamera() {
    return this.facingFront;
  }

  async start() {
    const {
      RTCPeerConnection,
      mediaDevices,
    } = getRTC();

    const constraints: any = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Prefer telephony-quality mono Opus path (WhatsApp-like)
        channelCount: 1,
        sampleRate: 48000,
        // Android WebRTC goog* hints (ignored harmlessly elsewhere)
        googEchoCancellation: true,
        googNoiseSuppression: true,
        googAutoGainControl: true,
        googHighpassFilter: true,
        googTypingNoiseDetection: true,
      },
      video:
        this.callType === 'video'
          ? {
              facingMode: 'user',
              width: { ideal: 720 },
              height: { ideal: 1280 },
              frameRate: { ideal: 30, max: 30 },
            }
          : false,
    };

    await ensureCallPermissions(this.callType);

    this.localStream = await mediaDevices.getUserMedia(constraints);
    this.handlers.onLocalStream?.(this.localStream);

    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    for (const track of this.localStream.getTracks()) {
      this.pc.addTrack(track, this.localStream);
    }

    this.pc.onicecandidate = (ev: any) => {
      if (ev.candidate) this.handlers.onIceCandidate?.(ev.candidate);
    };

    this.pc.ontrack = (ev: any) => {
      if (ev.streams && ev.streams[0]) {
        this.remoteStream = ev.streams[0];
        this.handlers.onRemoteStream?.(this.remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.handlers.onConnectionState?.(this.pc?.connectionState || 'closed');
    };

    this.pc.oniceconnectionstatechange = () => {
      this.handlers.onIceConnectionState?.(
        this.pc?.iceConnectionState || 'closed'
      );
    };

    this.startStats();
  }

  private startStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = setInterval(async () => {
      if (!this.pc || this.disposed) return;
      try {
        const stats = await this.pc.getStats();
        let rtt = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        let outboundBitrate = 0;
        stats.forEach((report: any) => {
          if (
            (report.type === 'candidate-pair' || report.type === 'transport') &&
            (report.state === 'succeeded' || report.selected)
          ) {
            if (report.currentRoundTripTime != null) {
              rtt = report.currentRoundTripTime * 1000;
            }
          }
          if (
            report.type === 'inbound-rtp' &&
            (report.kind === 'video' || report.mediaType === 'video')
          ) {
            packetsLost += report.packetsLost || 0;
            packetsReceived += report.packetsReceived || 0;
          }
          if (
            report.type === 'outbound-rtp' &&
            (report.kind === 'video' || report.mediaType === 'video')
          ) {
            // bytesSent delta approximated via timestamp if available
            if (report.bytesSent && report.timestamp) {
              outboundBitrate = report.bytesSent;
            }
          }
        });
        void outboundBitrate;
        const loss =
          packetsReceived + packetsLost > 0
            ? packetsLost / (packetsReceived + packetsLost)
            : 0;
        let q: NetworkQuality = 'good';
        if (rtt > 450 || loss > 0.1) q = 'poor';
        else if (rtt > 280 || loss > 0.05) q = 'fair';
        else if (rtt > 0 && rtt < 100 && loss < 0.01) q = 'excellent';
        else if (rtt === 0 && loss === 0) q = this.lastQuality === 'unknown' ? 'good' : this.lastQuality;
        this.onQuality?.(q);
        void this.applyAdaptiveVideo(q);
      } catch {
        /* ignore */
      }
    }, 3000);
  }

  /** Lower resolution / bitrate when the network is weak (WhatsApp-like). */
  private async applyAdaptiveVideo(q: NetworkQuality) {
    if (this.callType !== 'video' || this.disposed || this.adaptBusy) return;
    if (q === this.lastQuality || q === 'unknown') return;
    this.adaptBusy = true;
    this.lastQuality = q;
    const preset = VIDEO_QUALITY[q] || VIDEO_QUALITY.good;
    try {
      const track = this.localStream?.getVideoTracks?.()?.[0];
      if (track && typeof track.applyConstraints === 'function') {
        await track.applyConstraints({
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.frameRate, max: preset.frameRate },
        });
      }
      const sender = this.pc
        ?.getSenders?.()
        ?.find((s: any) => s.track && s.track.kind === 'video');
      if (sender && typeof sender.getParameters === 'function') {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = preset.maxBitrate;
        params.encodings[0].maxFramerate = preset.frameRate;
        if (params.degradationPreference !== undefined) {
          params.degradationPreference = 'balanced';
        }
        await sender.setParameters(params);
      }
    } catch (err) {
      console.warn('[WebRTC] adapt video:', (err as Error).message);
    } finally {
      this.adaptBusy = false;
    }
  }

  async createOffer() {
    const { RTCSessionDescription } = getRTC();
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.callType === 'video',
      voiceActivityDetection: true,
    });
    const preferred = preferOpusSdp(offer.sdp || '');
    await this.pc.setLocalDescription(
      preferred !== offer.sdp
        ? new RTCSessionDescription({ type: offer.type, sdp: preferred })
        : offer,
    );
    return {
      type: this.pc.localDescription.type,
      sdp: this.pc.localDescription.sdp,
    };
  }

  async createAnswer() {
    const answer = await this.pc.createAnswer();
    const preferred = preferOpusSdp(answer.sdp || '');
    const { RTCSessionDescription } = getRTC();
    await this.pc.setLocalDescription(
      preferred !== answer.sdp
        ? new RTCSessionDescription({ type: answer.type, sdp: preferred })
        : answer,
    );
    return {
      type: this.pc.localDescription.type,
      sdp: this.pc.localDescription.sdp,
    };
  }

  async setRemoteDescription(sdp: { type: string; sdp: string }) {
    const { RTCSessionDescription } = getRTC();
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async addIceCandidate(candidate: any) {
    if (!candidate || !this.pc) return;
    try {
      const { RTCIceCandidate } = getRTC();
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTC] addIceCandidate:', (err as Error).message);
    }
  }

  setMuted(muted: boolean) {
    this.localStream?.getAudioTracks?.().forEach((t: any) => {
      t.enabled = !muted;
    });
    // Also mute senders in case track was replaced
    try {
      this.pc?.getSenders?.()?.forEach((s: any) => {
        if (s.track?.kind === 'audio') s.track.enabled = !muted;
      });
    } catch {
      /* ignore */
    }
  }

  setCameraEnabled(enabled: boolean) {
    this.localStream?.getVideoTracks?.().forEach((t: any) => {
      t.enabled = enabled;
    });
    try {
      this.pc?.getSenders?.()?.forEach((s: any) => {
        if (s.track?.kind === 'video') s.track.enabled = enabled;
      });
    } catch {
      /* ignore */
    }
  }

  async switchCamera() {
    const videoTrack = this.localStream?.getVideoTracks?.()?.[0];
    if (!videoTrack) return;
    // react-native-webrtc
    if (typeof (videoTrack as any)._switchCamera === 'function') {
      (videoTrack as any)._switchCamera();
      this.facingFront = !this.facingFront;
      this.handlers.onLocalStream?.(this.localStream);
      return;
    }
    // Web fallback: reacquire opposite facingMode
    try {
      const { mediaDevices } = getRTC();
      const currentFacing = videoTrack.getSettings?.()?.facingMode || 'user';
      const next = currentFacing === 'environment' ? 'user' : 'environment';
      const fresh = await mediaDevices.getUserMedia({
        video: { facingMode: { exact: next } },
        audio: false,
      });
      const newTrack = fresh.getVideoTracks()[0];
      const sender = this.pc
        ?.getSenders?.()
        ?.find((s: any) => s.track && s.track.kind === 'video');
      if (sender && newTrack) {
        await sender.replaceTrack(newTrack);
        videoTrack.stop();
        this.localStream.removeTrack(videoTrack);
        this.localStream.addTrack(newTrack);
        this.facingFront = next === 'user';
        this.handlers.onLocalStream?.(this.localStream);
      }
    } catch (err) {
      console.warn('[WebRTC] switchCamera:', (err as Error).message);
    }
  }

  async upgradeToVideo() {
    if (this.callType === 'video') return null;
    const { mediaDevices } = getRTC();
    const cam = await mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 720 },
        height: { ideal: 1280 },
      },
      audio: false,
    });
    const track = cam.getVideoTracks()[0];
    if (!track) return null;
    this.localStream.addTrack(track);
    this.pc.addTrack(track, this.localStream);
    this.callType = 'video';
    this.handlers.onLocalStream?.(this.localStream);
    return this.createOffer();
  }

  async downgradeToAudio() {
    const senders = this.pc?.getSenders?.() || [];
    for (const sender of senders) {
      if (sender.track?.kind === 'video') {
        try {
          this.pc.removeTrack(sender);
        } catch {
          sender.track.stop();
          sender.track.enabled = false;
        }
      }
    }
    this.localStream?.getVideoTracks?.().forEach((t: any) => {
      t.stop();
      this.localStream.removeTrack(t);
    });
    this.callType = 'voice';
    this.handlers.onLocalStream?.(this.localStream);
    return this.createOffer();
  }

  getLocalStream() {
    return this.localStream;
  }

  getRemoteStream() {
    return this.remoteStream;
  }

  dispose() {
    this.disposed = true;
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    try {
      this.localStream?.getTracks?.().forEach((t: any) => t.stop());
    } catch {
      /* ignore */
    }
    try {
      this.remoteStream?.getTracks?.().forEach((t: any) => t.stop());
    } catch {
      /* ignore */
    }
    try {
      // Detach first so late native events can't fire into a closed peer
      if (this.pc) {
        this.pc.onicecandidate = null;
        this.pc.ontrack = null;
        this.pc.onconnectionstatechange = null;
        this.pc.oniceconnectionstatechange = null;
        this.pc.onnegotiationneeded = null;
      }
      this.pc?.close?.();
    } catch {
      /* ignore */
    }
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
  }
}

export function getRTCView() {
  if (Platform.OS === 'web') return null;
  const mod = loadWebRTC();
  return mod?.RTCView || null;
}
