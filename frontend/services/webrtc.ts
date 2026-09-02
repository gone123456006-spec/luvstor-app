/**
 * WebRTC peer connection wrapper for Luvstor calling.
 * Uses react-native-webrtc on native (dev/production builds).
 * Expo Go cannot load native WebRTC — isWebRTCAvailable() returns false there.
 */

import { Platform } from 'react-native';

export type CallMediaType = 'voice' | 'video';

export type NetworkQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

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
let loadAttempted = false;

function loadWebRTC() {
  if (loadAttempted) return WebRTC;
  loadAttempted = true;
  try {
    // Native module — fails in Expo Go
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    WebRTC = require('react-native-webrtc');
  } catch (err) {
    console.warn(
      '[WebRTC] Native module unavailable (use a development build for calls):',
      (err as Error)?.message
    );
    WebRTC = null;
  }
  return WebRTC;
}

export function isWebRTCAvailable(): boolean {
  if (Platform.OS === 'web') {
    return typeof (globalThis as any).RTCPeerConnection === 'function';
  }
  return !!loadWebRTC();
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
  if (!mod) throw new Error('WebRTC is not available on this build');
  return mod;
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
        stats.forEach((report: any) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = report.currentRoundTripTime
              ? report.currentRoundTripTime * 1000
              : report.currentRoundTripTime;
          }
          if (report.type === 'inbound-rtp' && !report.isRemote) {
            packetsLost += report.packetsLost || 0;
            packetsReceived += report.packetsReceived || 0;
          }
        });
        const loss =
          packetsReceived + packetsLost > 0
            ? packetsLost / (packetsReceived + packetsLost)
            : 0;
        let q: NetworkQuality = 'good';
        if (rtt > 400 || loss > 0.08) q = 'poor';
        else if (rtt > 250 || loss > 0.04) q = 'fair';
        else if (rtt < 120 && loss < 0.01) q = 'excellent';
        this.onQuality?.(q);
      } catch {
        /* ignore */
      }
    }, 4000);
  }

  async createOffer() {
    const { RTCSessionDescription } = getRTC();
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await this.pc.setLocalDescription(offer);
    return {
      type: this.pc.localDescription.type,
      sdp: this.pc.localDescription.sdp,
    };
  }

  async createAnswer() {
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
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
  }

  setCameraEnabled(enabled: boolean) {
    this.localStream?.getVideoTracks?.().forEach((t: any) => {
      t.enabled = enabled;
    });
  }

  async switchCamera() {
    const videoTrack = this.localStream?.getVideoTracks?.()?.[0];
    if (!videoTrack) return;
    // react-native-webrtc
    if (typeof (videoTrack as any)._switchCamera === 'function') {
      (videoTrack as any)._switchCamera();
      return;
    }
    // Web fallback: reacquire opposite facingMode
    try {
      const { mediaDevices } = getRTC();
      const currentFacing = videoTrack.getSettings?.()?.facingMode || 'user';
      const next = currentFacing === 'environment' ? 'user' : 'environment';
      const fresh = await mediaDevices.getUserMedia({
        video: { facingMode: next },
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
