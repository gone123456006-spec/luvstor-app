import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  AppStateStatus,
  Alert,
  Linking,
  Vibration,
} from 'react-native';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { apiRequest } from '../utils/api';
import { getAuthToken } from '../utils/auth';
import {
  CallPeer,
  CallMediaType,
  CallPermissionError,
  NetworkQuality,
  ensureCallPermissions,
  isWebRTCAvailable,
  getWebRTCUnavailableMessage,
} from '../services/webrtc';
import { resolveMediaUrl } from '../utils/media';
import {
  dismissCallNotifications,
  presentIncomingCallLocalNotification,
} from '../utils/push';
import {
  clearPendingIncomingCall,
  getPendingIncomingCall,
  setPendingIncomingCall,
  subscribePendingIncomingCall,
} from '../utils/pendingIncomingCall';
import {
  reinforceCallAudio,
  setCallMicMuted,
  setCallSpeaker,
  startCallAudio,
  startCallRingback,
  startIncomingRingtone,
  stopCallAudio,
  stopCallRingback,
  stopIncomingRingtone,
} from '../utils/callAudio';

function generateClientCallId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`.slice(
          0,
          12,
        );
  return `c_${Date.now().toString(36)}_${rand}`;
}

export type CallPhase =
  | 'idle'
  | 'outgoing'
  | 'ringing'
  | 'incoming'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended';

export type CallPeerInfo = {
  id: string;
  name: string;
  photo?: string;
  gender?: string;
  publicId?: string;
};

type CallState = {
  phase: CallPhase;
  callId: string | null;
  callType: CallMediaType;
  direction: 'outgoing' | 'incoming' | null;
  peer: CallPeerInfo | null;
  isExplore: boolean;
  muted: boolean;
  cameraOff: boolean;
  speakerOn: boolean;
  minimized: boolean;
  connectedAt: number | null;
  endReason: string | null;
  quality: NetworkQuality;
  localStream: any;
  remoteStream: any;
  error: string | null;
  webrtcReady: boolean;
  /** True when server reported callee had no live socket at invite time */
  peerOffline: boolean;
};

type StartCallOpts = {
  userId: string;
  name: string;
  photo?: string;
  gender?: string;
  publicId?: string;
  callType: CallMediaType;
};

type CallContextValue = CallState & {
  startCall: (opts: StartCallOpts) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  cancelCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => Promise<void>;
  switchCamera: () => Promise<void>;
  setMinimized: (v: boolean) => void;
  switchToVideo: () => Promise<void>;
  switchToAudio: () => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);

const initialState: CallState = {
  phase: 'idle',
  callId: null,
  callType: 'voice',
  direction: null,
  peer: null,
  isExplore: false,
  muted: false,
  cameraOff: false,
  speakerOn: false,
  minimized: false,
  connectedAt: null,
  endReason: null,
  quality: 'unknown',
  localStream: null,
  remoteStream: null,
  error: null,
  webrtcReady: isWebRTCAvailable(),
  peerOffline: false,
};

function isBlankName(name?: string | null) {
  const n = (name || '').trim().toLowerCase();
  return !n || n === 'user' || n === 'unknown' || n === 'anonymous' || n === 'luvstor user';
}

function formatExplorePeer(p: any): CallPeerInfo {
  const photo = resolveMediaUrl(p?.photo) || p?.photo || '';
  const publicId = (p?.publicId || '').trim();
  const rawName = (p?.name || '').trim();
  return {
    id: 'explore',
    name: rawName || publicId || 'User',
    photo,
    gender: p?.gender || '',
    publicId,
  };
}

function formatPeer(p: any, fallbackId: string): CallPeerInfo {
  const photo = resolveMediaUrl(p?.photo) || p?.photo || '';
  const publicId = p?.publicId || '';
  const rawName = (p?.name || '').trim();
  return {
    id: String(p?.id || p?.from || fallbackId),
    name: rawName || publicId || '',
    photo,
    gender: p?.gender || '',
    publicId,
  };
}

/** Prefer richer local peer info; fill gaps from server payload */
function mergePeer(
  current: CallPeerInfo | null | undefined,
  incoming: CallPeerInfo
): CallPeerInfo {
  const name = !isBlankName(incoming.name)
    ? incoming.name
    : !isBlankName(current?.name)
      ? (current?.name as string)
      : incoming.publicId || current?.publicId || 'User';
  return {
    id: incoming.id || current?.id || '',
    name,
    photo: incoming.photo || current?.photo || '',
    gender: incoming.gender || current?.gender || '',
    publicId: incoming.publicId || current?.publicId || '',
  };
}

function peerFromOpts(opts: StartCallOpts): CallPeerInfo {
  return {
    id: String(opts.userId),
    name: (opts.name || '').trim(),
    photo: resolveMediaUrl(opts.photo) || opts.photo || '',
    gender: opts.gender || '',
    publicId: opts.publicId || '',
  };
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [state, setState] = useState<CallState>(initialState);
  const peerRef = useRef<CallPeer | null>(null);
  const stateRef = useRef(state);
  const pendingCandidates = useRef<any[]>([]);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const endClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteDescSet = useRef(false);
  const acceptCallRef = useRef<() => Promise<void>>(async () => {});
  const declineCallRef = useRef<() => void>(() => {});
  /** Cancel tapped before call:ringing arrived */
  const pendingCancelRef = useRef(false);
  /** ICE servers from ringing — used when creating offer after accept */
  const iceServersRef = useRef<any[]>([]);
  /** Auto accept/decline once from notification button */
  const pendingNotifIntentRef = useRef<'accept' | 'decline' | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const patch = useCallback((partial: Partial<CallState>) => {
    setState((s) => ({ ...s, ...partial }));
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(
    (callId: string) => {
      stopHeartbeat();
      heartbeatTimer.current = setInterval(() => {
        socket?.emit('call:heartbeat', { callId });
      }, 5000);
    },
    [socket, stopHeartbeat]
  );

  const disposePeer = useCallback(() => {
    try {
      peerRef.current?.dispose();
    } catch {
      /* ignore */
    }
    peerRef.current = null;
    pendingCandidates.current = [];
    remoteDescSet.current = false;
  }, []);

  const resetSoon = useCallback(() => {
    if (endClearTimer.current) clearTimeout(endClearTimer.current);
    endClearTimer.current = setTimeout(() => {
      setState({ ...initialState, webrtcReady: isWebRTCAvailable() });
    }, 1600);
  }, []);

  const finishCall = useCallback(
    (endReason: string | null) => {
      const endedId = stateRef.current.callId;
      pendingCancelRef.current = false;
      iceServersRef.current = [];
      stopHeartbeat();
      disposePeer();
      Vibration.cancel();
      stopCallRingback();
      stopIncomingRingtone();
      void dismissCallNotifications(endedId);
      clearPendingIncomingCall(endedId);
      void stopCallAudio();
      patch({
        phase: 'ended',
        endReason,
        localStream: null,
        remoteStream: null,
        minimized: false,
      });
      resetSoon();
    },
    [disposePeer, patch, resetSoon, stopHeartbeat]
  );

  const createPeer = useCallback(
    async (opts: {
      iceServers: any[];
      isCaller: boolean;
      callType: CallMediaType;
      callId: string;
    }) => {
      disposePeer();
      const peer = new CallPeer({
        iceServers: opts.iceServers,
        isCaller: opts.isCaller,
        callType: opts.callType,
        onQuality: (quality) => {
          patch({ quality });
          socket?.emit('call:quality', { callId: opts.callId, quality });
        },
        handlers: {
          onLocalStream: (stream) => patch({ localStream: stream }),
          onRemoteStream: (stream) => patch({ remoteStream: stream }),
          onIceCandidate: (candidate) => {
            const plain = {
              candidate: candidate?.candidate,
              sdpMLineIndex: candidate?.sdpMLineIndex,
              sdpMid: candidate?.sdpMid,
              usernameFragment: candidate?.usernameFragment,
            };
            if (!plain.candidate) return;
            socket?.emit('call:ice-candidate', {
              callId: opts.callId,
              candidate: plain,
            });
          },
          onConnectionState: (conn) => {
            if (conn === 'connected' || conn === 'completed') {
              patch({ phase: 'connected', connectedAt: Date.now() });
              socket?.emit('call:connected', { callId: opts.callId });
              // WebRTC overwrites the audio session — re-apply speaker/earpiece
              void reinforceCallAudio(stateRef.current.speakerOn);
            } else if (conn === 'connecting') {
              patch({ phase: 'connecting' });
            } else if (conn === 'disconnected') {
              patch({ phase: 'reconnecting' });
            } else if (conn === 'failed' || conn === 'closed') {
              if (stateRef.current.phase !== 'ended' && stateRef.current.phase !== 'idle') {
                socket?.emit('call:end', { callId: opts.callId });
                finishCall('disconnect');
              }
            }
          },
          onIceConnectionState: (ice) => {
            if (ice === 'disconnected') patch({ phase: 'reconnecting' });
            if (ice === 'connected' || ice === 'completed') {
              patch({
                phase: 'connected',
                connectedAt: stateRef.current.connectedAt || Date.now(),
              });
              void reinforceCallAudio(stateRef.current.speakerOn);
            }
          },
          onError: (err) => patch({ error: err.message }),
        },
      });
      peerRef.current = peer;
      await peer.start();
      if (stateRef.current.muted) peer.setMuted(true);
      if (stateRef.current.cameraOff) peer.setCameraEnabled(false);
      return peer;
    },
    [disposePeer, finishCall, patch, socket]
  );

  const flushCandidates = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer || !remoteDescSet.current) return;
    const queued = pendingCandidates.current.splice(0);
    for (const c of queued) {
      await peer.addIceCandidate(c);
    }
  }, []);

  // ── Outgoing ──────────────────────────────────────────
  const startCall = useCallback(
    async (opts: StartCallOpts) => {
      if (stateRef.current.phase !== 'idle' && stateRef.current.phase !== 'ended') {
        patch({ error: 'Already in a call' });
        return;
      }

      if (!socket?.connected) {
        Alert.alert('Not connected', 'Check your internet and try again.');
        return;
      }

      if (!isWebRTCAvailable()) {
        Alert.alert('Calls unavailable', getWebRTCUnavailableMessage());
        return;
      }

      // 1) Mic (+ speaker/Bluetooth) permission BEFORE calling UI — like WhatsApp
      try {
        await ensureCallPermissions(opts.callType);
      } catch (err) {
        const needsSettings =
          err instanceof CallPermissionError && err.needsSettings;
        Alert.alert(
          'Permission needed',
          (err as Error).message ||
            'Allow microphone access to place voice calls.',
          needsSettings
            ? [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => {
                    void Linking.openSettings();
                  },
                },
              ]
            : [{ text: 'OK' }],
        );
        return;
      }

      if (endClearTimer.current) clearTimeout(endClearTimer.current);

      // 2) Client callId up front — cancel works even before call:ringing
      const callId = generateClientCallId();
      pendingCancelRef.current = false;
      iceServersRef.current = [];

      const peer = peerFromOpts(opts);
      const speakerOn = opts.callType === 'video';

      setState({
        ...initialState,
        webrtcReady: true,
        phase: 'outgoing',
        callId,
        callType: opts.callType,
        direction: 'outgoing',
        peer,
        speakerOn,
        cameraOff: opts.callType !== 'video',
        minimized: false,
        error: null,
        peerOffline: false,
      });

      // Prefetch DP so blur + center render without a pop-in
      const photoUrl = resolveMediaUrl(opts.photo || '') || opts.photo;
      if (photoUrl) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { Image: ExpoImage } = require('expo-image');
          void ExpoImage.prefetch?.(photoUrl);
        } catch {
          /* ignore */
        }
      }

      // 3) Audio + ring in background
      void (async () => {
        try {
          await startCallAudio({ callType: opts.callType, speakerOn });
          void startCallRingback(speakerOn);
        } catch {
          /* non-fatal for UI open */
        }
      })();

      // 4) Ring them (same callId so cancel races are safe)
      socket.emit('call:invite', {
        receiverId: opts.userId,
        callType: opts.callType,
        callId,
      });
    },
    [patch, socket]
  );

  const acceptCall = useCallback(async () => {
    const s = stateRef.current;
    if (!socket || !s.callId || s.phase !== 'incoming') return;
    if (!isWebRTCAvailable()) {
      patch({
        error: getWebRTCUnavailableMessage(),
      });
      socket.emit('call:decline', { callId: s.callId });
      finishCall('error');
      return;
    }
    Vibration.cancel();
    stopIncomingRingtone();
    try {
      await ensureCallPermissions(s.callType);
    } catch (err) {
      patch({ error: (err as Error).message || 'Microphone permission required.' });
      socket.emit('call:decline', { callId: s.callId });
      finishCall('error');
      return;
    }
    patch({ phase: 'connecting' });
    await startCallAudio({
      callType: s.callType,
      speakerOn: s.speakerOn,
    });
    socket.emit('call:accept', { callId: s.callId });
  }, [finishCall, patch, socket]);

  acceptCallRef.current = acceptCall;

  const declineCall = useCallback(() => {
    const s = stateRef.current;
    if (!s.callId) return;
    socket?.emit('call:decline', { callId: s.callId });
    Vibration.cancel();
    finishCall('decline');
  }, [finishCall, socket]);

  declineCallRef.current = declineCall;

  const cancelCall = useCallback(() => {
    const s = stateRef.current;
    pendingCancelRef.current = true;
    if (s.callId) {
      socket?.emit('call:cancel', { callId: s.callId });
    }
    finishCall('cancel');
  }, [finishCall, socket]);

  const endCall = useCallback(() => {
    const s = stateRef.current;
    if (s.callId) socket?.emit('call:end', { callId: s.callId });
    finishCall('hangup');
  }, [finishCall, socket]);

  const toggleMute = useCallback(() => {
    setState((s) => {
      const muted = !s.muted;
      peerRef.current?.setMuted(muted);
      setCallMicMuted(muted);
      if (s.callId) {
        socket?.emit('call:media-state', { callId: s.callId, muted });
      }
      return { ...s, muted };
    });
  }, [socket]);

  const toggleCamera = useCallback(() => {
    setState((s) => {
      const cameraOff = !s.cameraOff;
      peerRef.current?.setCameraEnabled(!cameraOff);
      if (s.callId) {
        socket?.emit('call:media-state', { callId: s.callId, cameraOff });
      }
      return { ...s, cameraOff };
    });
  }, [socket]);

  const toggleSpeaker = useCallback(async () => {
    const next = !stateRef.current.speakerOn;
    await setCallSpeaker(next);
    patch({ speakerOn: next });
    const callId = stateRef.current.callId;
    if (callId) socket?.emit('call:media-state', { callId, speaker: next });
  }, [patch, socket]);

  const switchCamera = useCallback(async () => {
    await peerRef.current?.switchCamera();
  }, []);

  const switchToVideo = useCallback(async () => {
    const s = stateRef.current;
    if (!s.callId || s.callType === 'video') return;
    const offer = await peerRef.current?.upgradeToVideo();
    if (offer) {
      patch({ callType: 'video', cameraOff: false });
      socket?.emit('call:renegotiate', {
        callId: s.callId,
        sdp: offer,
        callType: 'video',
      });
    }
  }, [patch, socket]);

  const switchToAudio = useCallback(async () => {
    const s = stateRef.current;
    if (!s.callId || s.callType === 'voice') return;
    const offer = await peerRef.current?.downgradeToAudio();
    if (offer) {
      patch({ callType: 'voice', cameraOff: true });
      socket?.emit('call:renegotiate', {
        callId: s.callId,
        sdp: offer,
        callType: 'voice',
      });
    }
  }, [patch, socket]);

  const setMinimized = useCallback((v: boolean) => {
    patch({ minimized: v });
  }, [patch]);

  // ── Socket signaling ──────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onRinging = async (payload: any) => {
      const callId = payload?.callId;
      if (!callId) return;

      // User already hung up while invite was in flight
      if (
        pendingCancelRef.current ||
        (stateRef.current.phase === 'ended' &&
          stateRef.current.callId === callId)
      ) {
        pendingCancelRef.current = false;
        socket.emit('call:cancel', { callId });
        return;
      }

      const callType: CallMediaType =
        payload.callType === 'video' ? 'video' : 'voice';
      const speakerOn = callType === 'video';
      const mergedPeer = payload.explore
        ? formatExplorePeer(payload.callee)
        : payload.callee
          ? mergePeer(
              stateRef.current.peer,
              formatPeer(payload.callee, payload.receiverId),
            )
          : stateRef.current.peer;

      iceServersRef.current = payload.iceServers || [];

      patch({
        phase: 'ringing',
        callId,
        callType,
        peer: mergedPeer,
        isExplore: !!payload.explore,
        direction: 'outgoing',
        speakerOn,
        cameraOff: callType !== 'video',
        peerOffline: payload.calleeOnline === false,
      });

      // Keep ringback; create WebRTC offer only after callee accepts
      startCallRingback(speakerOn);
      try {
        await startCallAudio({ callType, speakerOn });
      } catch {
        /* non-fatal */
      }
    };

    const onIncoming = (payload: any) => {
      // Keep Explore and friend calls from stealing each other's active session
      if (stateRef.current.phase !== 'idle' && stateRef.current.phase !== 'ended') {
        if (payload?.callId) {
          socket.emit('call:decline', { callId: payload.callId });
        }
        return;
      }
      if (endClearTimer.current) clearTimeout(endClearTimer.current);

      const explore = !!payload.explore;
      const peer = explore
        ? formatExplorePeer(payload.caller)
        : formatPeer(payload.caller || {}, payload.from);

      clearPendingIncomingCall(payload?.callId);
      iceServersRef.current = payload.iceServers || [];

      if (!explore) {
        Vibration.vibrate([0, 500, 400, 500], true);
        void startIncomingRingtone();
        // App backgrounded / screen off: show a local tray alert (FCM covers fully-killed)
        if (AppState.currentState !== 'active') {
          void presentIncomingCallLocalNotification({
            callId: String(payload.callId),
            callerName: peer.name || 'Incoming call',
            callType: payload.callType === 'video' ? 'video' : 'voice',
            callerId: String(payload.from || peer.id || ''),
          });
        }
      }

      setState({
        ...initialState,
        webrtcReady: isWebRTCAvailable(),
        phase: 'incoming',
        callId: payload.callId,
        callType: payload.callType === 'video' ? 'video' : 'voice',
        direction: 'incoming',
        peer,
        isExplore: explore,
        speakerOn: payload.callType === 'video',
        cameraOff: payload.callType !== 'video',
        minimized: false,
      });
      (onIncoming as any)._ice = payload.iceServers || [];

      if (explore && payload.autoAccept) {
        setTimeout(() => {
          void acceptCallRef.current();
        }, 500);
      } else if (pendingNotifIntentRef.current === 'accept') {
        pendingNotifIntentRef.current = null;
        setTimeout(() => {
          void acceptCallRef.current();
        }, 250);
      } else if (pendingNotifIntentRef.current === 'decline') {
        pendingNotifIntentRef.current = null;
        setTimeout(() => {
          declineCallRef.current();
        }, 100);
      }
    };

    const onAccepted = async (payload: any) => {
      const callId = payload?.callId || stateRef.current.callId;
      if (!callId) return;
      Vibration.cancel();
      stopCallRingback();
      stopIncomingRingtone();
      patch({ phase: 'connecting', callId });

      const iceServers =
        payload.iceServers ||
        iceServersRef.current ||
        (onIncoming as any)._ice ||
        [];

      try {
        if (payload.isCallee) {
          // Callee creates peer; waits for offer (may already be queued)
          await createPeer({
            iceServers,
            isCaller: false,
            callType: stateRef.current.callType,
            callId,
          });
          startHeartbeat(callId);
          const pendingOffer = (onAccepted as any)._pendingOffer;
          if (pendingOffer) {
            (onAccepted as any)._pendingOffer = null;
            await peerRef.current?.setRemoteDescription(pendingOffer);
            remoteDescSet.current = true;
            const answer = await peerRef.current?.createAnswer();
            if (answer) socket.emit('call:answer', { callId, sdp: answer });
            await flushCandidates();
          }
        } else {
          // Caller: create peer + offer now that callee is ready
          if (!isWebRTCAvailable()) {
            patch({ error: getWebRTCUnavailableMessage() });
            socket.emit('call:end', { callId });
            finishCall('error');
            return;
          }
          await createPeer({
            iceServers,
            isCaller: true,
            callType: stateRef.current.callType,
            callId,
          });
          const offer = await peerRef.current?.createOffer();
          if (offer) socket.emit('call:offer', { callId, sdp: offer });
          startHeartbeat(callId);
        }
      } catch (err) {
        patch({ error: (err as Error).message });
        socket.emit('call:end', { callId });
        finishCall('error');
      }
    };

    const onOffer = async (payload: any) => {
      if (!payload?.sdp || payload.callId !== stateRef.current.callId) {
        // Offer arrived before accept finished — stash
        if (payload?.callId) (onAccepted as any)._pendingOffer = payload.sdp;
        return;
      }
      try {
        if (!peerRef.current) {
          (onAccepted as any)._pendingOffer = payload.sdp;
          return;
        }
        await peerRef.current.setRemoteDescription(payload.sdp);
        remoteDescSet.current = true;
        const answer = await peerRef.current.createAnswer();
        if (answer) {
          socket.emit('call:answer', { callId: payload.callId, sdp: answer });
        }
        await flushCandidates();
      } catch (err) {
        console.error('[Call] offer:', err);
      }
    };

    const onAnswer = async (payload: any) => {
      if (!payload?.sdp || payload.callId !== stateRef.current.callId) return;
      try {
        await peerRef.current?.setRemoteDescription(payload.sdp);
        remoteDescSet.current = true;
        await flushCandidates();
        patch({ phase: 'connecting' });
      } catch (err) {
        console.error('[Call] answer:', err);
      }
    };

    const onIce = async (payload: any) => {
      if (!payload?.candidate || payload.callId !== stateRef.current.callId) return;
      if (!remoteDescSet.current || !peerRef.current) {
        pendingCandidates.current.push(payload.candidate);
        return;
      }
      await peerRef.current.addIceCandidate(payload.candidate);
    };

    const onRenegotiate = async (payload: any) => {
      if (!payload?.sdp || payload.callId !== stateRef.current.callId) return;
      try {
        await peerRef.current?.setRemoteDescription(payload.sdp);
        const answer = await peerRef.current?.createAnswer();
        if (answer) {
          socket.emit('call:answer', { callId: payload.callId, sdp: answer });
        }
        if (payload.callType === 'voice' || payload.callType === 'video') {
          patch({
            callType: payload.callType,
            cameraOff: payload.callType !== 'video',
          });
        }
      } catch (err) {
        console.error('[Call] renegotiate:', err);
      }
    };

    const onEnded = (payload: any) => {
      if (
        payload?.callId &&
        stateRef.current.callId &&
        payload.callId !== stateRef.current.callId
      ) {
        return;
      }
      finishCall(payload?.endReason || 'hangup');
    };

    const onError = (payload: any) => {
      // Expected when cancel raced ahead of invite — don't flash an error
      if (payload?.code === 'CANCELLED') {
        if (stateRef.current.phase !== 'idle') finishCall('cancel');
        return;
      }
      pendingCancelRef.current = false;
      const code = String(payload?.code || 'error').toLowerCase();
      // WhatsApp-style: stop ringing immediately and show Busy / Offline
      stopCallRingback();
      stopIncomingRingtone();
      Vibration.cancel();
      disposePeer();
      stopHeartbeat();
      void stopCallAudio();
      patch({
        error:
          code === 'busy'
            ? 'Busy on another call'
            : payload?.error || 'Call failed',
        phase: 'ended',
        endReason: code,
      });
      resetSoon();
    };

    /** Callee was already in a call — surface it instead of silently dropping */
    const onMissedBusy = (payload: any) => {
      if (stateRef.current.phase !== 'idle' && stateRef.current.phase !== 'ended') {
        return;
      }
      patch({ error: payload?.error || 'You missed a call while busy.' });
    };

    const onConnected = () => {
      patch({
        phase: 'connected',
        connectedAt: stateRef.current.connectedAt || Date.now(),
      });
      void reinforceCallAudio(stateRef.current.speakerOn);
    };

    socket.on('call:ringing', onRinging);
    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:offer', onOffer);
    socket.on('call:answer', onAnswer);
    socket.on('call:ice-candidate', onIce);
    socket.on('call:renegotiate', onRenegotiate);
    socket.on('call:ended', onEnded);
    socket.on('call:error', onError);
    socket.on('call:connected', onConnected);
    socket.on('call:missed_busy', onMissedBusy);

    return () => {
      socket.off('call:ringing', onRinging);
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:offer', onOffer);
      socket.off('call:answer', onAnswer);
      socket.off('call:ice-candidate', onIce);
      socket.off('call:renegotiate', onRenegotiate);
      socket.off('call:ended', onEnded);
      socket.off('call:error', onError);
      socket.off('call:connected', onConnected);
      socket.off('call:missed_busy', onMissedBusy);
    };
  }, [
    createPeer,
    disposePeer,
    finishCall,
    flushCandidates,
    patch,
    resetSoon,
    socket,
    startHeartbeat,
    stopHeartbeat,
  ]);

  // Push wake / app reopen — re-request ringing incoming from server
  useEffect(() => {
    if (!socket?.connected) return;

    const applyPendingIntent = (pending: ReturnType<typeof getPendingIncomingCall>) => {
      if (!pending) return;
      if (pending.intent === 'decline') {
        socket.emit('call:decline', { callId: pending.callId });
        clearPendingIncomingCall(pending.callId);
        pendingNotifIntentRef.current = null;
        if (stateRef.current.callId === pending.callId) {
          finishCall('decline');
        }
        return;
      }
      if (pending.intent === 'accept') {
        pendingNotifIntentRef.current = 'accept';
      }
      const phase = stateRef.current.phase;
      if (phase === 'incoming' && stateRef.current.callId === pending.callId) {
        if (pending.intent === 'accept') {
          clearPendingIncomingCall(pending.callId);
          void acceptCallRef.current();
        }
        return;
      }
      if (phase === 'idle' || phase === 'ended') {
        socket.emit('call:sync');
      }
    };

    const syncIncoming = () => {
      const pending = getPendingIncomingCall();
      if (pending) {
        applyPendingIntent(pending);
        return;
      }
      const phase = stateRef.current.phase;
      if (phase !== 'idle' && phase !== 'ended') return;
      socket.emit('call:sync');
    };

    syncIncoming();

    const unsub = subscribePendingIncomingCall((pending) => {
      if (!pending) return;
      applyPendingIntent(pending);
    });

    const onChange = (next: AppStateStatus) => {
      if (next === 'active') syncIncoming();
      // App backgrounded while ringing → WhatsApp-style tray with Accept / Decline
      if (
        (next === 'background' || next === 'inactive') &&
        stateRef.current.phase === 'incoming' &&
        stateRef.current.callId &&
        !stateRef.current.isExplore
      ) {
        const peer = stateRef.current.peer;
        void presentIncomingCallLocalNotification({
          callId: String(stateRef.current.callId),
          callerName: peer?.name || 'Incoming call',
          callType: stateRef.current.callType,
          callerId: String(peer?.id || ''),
        });
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => {
      unsub();
      sub.remove();
    };
  }, [finishCall, socket, socket?.connected]);

  // Restore active call UI hint after reopen (signaling still on socket)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuthToken();
        if (!token || cancelled) return;
        const res = await apiRequest('/api/calls/active', token);
        // Soft restore — full media requires active peer; overlay shows reconnecting if needed
        if (res?.active && stateRef.current.phase === 'idle') {
          // Peer may reconnect via socket events; nothing to force here
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // App resume — keep heartbeat
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      const s = stateRef.current;
      if (next === 'active' && s.callId && s.phase === 'connected') {
        socket?.emit('call:heartbeat', { callId: s.callId });
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [socket]);

  useEffect(() => {
    return () => {
      stopHeartbeat();
      disposePeer();
      Vibration.cancel();
      if (endClearTimer.current) clearTimeout(endClearTimer.current);
    };
  }, [disposePeer, stopHeartbeat]);

  const value = useMemo<CallContextValue>(
    () => ({
      ...state,
      startCall,
      acceptCall,
      declineCall,
      cancelCall,
      endCall,
      toggleMute,
      toggleCamera,
      toggleSpeaker,
      switchCamera,
      setMinimized,
      switchToVideo,
      switchToAudio,
    }),
    [
      state,
      startCall,
      acceptCall,
      declineCall,
      cancelCall,
      endCall,
      toggleMute,
      toggleCamera,
      toggleSpeaker,
      switchCamera,
      setMinimized,
      switchToVideo,
      switchToAudio,
    ]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within CallProvider');
  return ctx;
}
