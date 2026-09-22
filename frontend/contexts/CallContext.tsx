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
  hydratePendingIncomingCall,
  setPendingIncomingCall,
  subscribePendingIncomingCall,
} from '../utils/pendingIncomingCall';
import { declineCallHttp } from '../utils/callHttpActions';
import { setCallSessionActive } from '../utils/callSession';
import { ensureSocketConnected } from '../utils/ensureSocketConnected';
import {
  enterCallPictureInPicture,
  startOngoingCall,
  stopOngoingCall,
  subscribeOngoingCallEnd,
  subscribeOngoingCallOpen,
} from '../utils/callOngoing';
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

/** Robust across Metro duplicate modules — don't rely on instanceof alone. */
function isCallPermissionError(err: unknown): err is CallPermissionError {
  if (err instanceof CallPermissionError) return true;
  const e = err as { name?: string; message?: string; kind?: string } | null;
  if (!e) return false;
  if (e.name === 'CallPermissionError') return true;
  if (e.kind === 'microphone' || e.kind === 'camera') return true;
  return /permission is required|Enable it in Settings|NotAllowed|Permission/i.test(
    String(e.message || ''),
  );
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
  /** Front camera → mirror preview (WhatsApp) */
  localMirrored: boolean;
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
  cameraOff: true,
  speakerOn: false,
  minimized: false,
  connectedAt: null,
  endReason: null,
  quality: 'unknown',
  localStream: null,
  remoteStream: null,
  localMirrored: true,
  error: null,
  webrtcReady: isWebRTCAvailable(),
  peerOffline: false,
};

function isBlankName(name?: string | null) {
  const n = (name || '').trim().toLowerCase();
  return !n || n === 'user' || n === 'unknown' || n === 'anonymous' || n === 'luvstor user';
}

function formatExplorePeer(p: any): CallPeerInfo {
  // Explore is anonymous — never surface real name / photo / publicId in the call UI
  return {
    id: 'explore',
    name: 'Anonymous',
    photo: '',
    gender: p?.gender || '',
    publicId: '',
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

/** Prefer richer local peer info; fill gaps from server payload — same userId only */
function mergePeer(
  current: CallPeerInfo | null | undefined,
  incoming: CallPeerInfo
): CallPeerInfo {
  const curId = String(current?.id || '');
  const inId = String(incoming.id || '');
  // Never merge two different users into one card
  if (curId && inId && curId !== inId) {
    return {
      ...incoming,
      name: isBlankName(incoming.name)
        ? incoming.publicId || 'User'
        : incoming.name,
      photo: incoming.photo || '',
    };
  }
  const name = !isBlankName(incoming.name)
    ? incoming.name
    : !isBlankName(current?.name)
      ? (current?.name as string)
      : incoming.publicId || current?.publicId || 'User';
  return {
    id: inId || curId || '',
    name,
    photo: incoming.photo || current?.photo || '',
    gender: incoming.gender || current?.gender || '',
    publicId: incoming.publicId || current?.publicId || '',
  };
}

/** STUN-only fallback — cross-network calls need TURN from the server. */
const FALLBACK_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

function iceListHasTurn(list: any[] | null | undefined): boolean {
  if (!Array.isArray(list) || !list.length) return false;
  return list.some((s) => {
    const urls = [].concat(s?.urls || []);
    return urls.some((u) => /^turns?:/i.test(String(u || '')));
  });
}

/**
 * Prefer ICE configs that include TURN so calls work on cellular / different
 * Wi‑Fi (WhatsApp-style). Never rely on same-LAN host candidates alone.
 */
async function fetchIceServers(): Promise<any[]> {
  try {
    const token = await getAuthToken();
    if (!token) return FALLBACK_ICE_SERVERS;
    const data = await apiRequest('/api/calls/ice-servers', token);
    const list = data?.iceServers;
    if (Array.isArray(list) && list.length > 0) return list;
  } catch {
    /* use fallback */
  }
  return FALLBACK_ICE_SERVERS;
}

/** Merge preferred (socket payload) with a fresh API fetch; keep the TURN set. */
async function resolveIceServers(preferred?: any[] | null): Promise<any[]> {
  const prefer = Array.isArray(preferred) && preferred.length ? preferred : null;
  if (prefer && iceListHasTurn(prefer)) return prefer;

  const fetched = await fetchIceServers();
  if (iceListHasTurn(fetched)) return fetched;
  if (prefer) return prefer;
  return fetched;
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

/** ICE recover — module scope avoids Hermes TDZ on nested WebRTC callbacks.
 *  Applies to friend + Explore calls (WhatsApp: brief flaps don't hang up). */
const callRecoverHold: { timer: ReturnType<typeof setTimeout> | null } = {
  timer: null,
};

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
  /** Locked for the life of the call — voice and video never morph mid-call */
  const callTypeRef = useRef<CallMediaType>('voice');
  /** Auto accept/decline once from notification button */
  const pendingNotifIntentRef = useRef<'accept' | 'decline' | null>(null);

  useEffect(() => {
    stateRef.current = state;
    const active =
      state.phase !== 'idle' && state.phase !== 'ended';
    setCallSessionActive(active);
  }, [state]);

  const patch = useCallback((partial: Partial<CallState>) => {
    setState((s) => ({ ...s, ...partial }));
  }, []);

  const isActiveCall = useCallback((callId: string, callType?: CallMediaType) => {
    const s = stateRef.current;
    if (!callId || s.callId !== callId) return false;
    if (s.phase === 'idle' || s.phase === 'ended') return false;
    if (callType && s.callType !== callType) return false;
    return true;
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  }, []);

  const clearExploreRecover = useCallback(() => {
    if (callRecoverHold.timer) {
      clearTimeout(callRecoverHold.timer);
      callRecoverHold.timer = null;
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
    }, 2200);
  }, []);

  const finishCall = useCallback(
    (endReason: string | null) => {
      const endedId = stateRef.current.callId;
      pendingCancelRef.current = false;
      iceServersRef.current = [];
      callTypeRef.current = 'voice';
      setCallSessionActive(false);
      clearExploreRecover();
      stopHeartbeat();
      disposePeer();
      Vibration.cancel();
      stopCallRingback();
      stopIncomingRingtone();
      void dismissCallNotifications(endedId);
      void stopOngoingCall();
      clearPendingIncomingCall(endedId);
      void stopCallAudio();
      patch({
        phase: 'ended',
        endReason,
        error:
          endReason === 'permission'
            ? null
            : stateRef.current.error,
        localStream: null,
        remoteStream: null,
        minimized: false,
      });
      resetSoon();
    },
    [clearExploreRecover, disposePeer, patch, resetSoon, stopHeartbeat]
  );

  const createPeer = useCallback(
    async (opts: {
      iceServers: any[];
      isCaller: boolean;
      callType: CallMediaType;
      callId: string;
    }) => {
      // Never mix modes — peer media must match the locked call type
      const locked = callTypeRef.current;
      const callType = locked || opts.callType;
      if (opts.callType !== callType) {
        console.warn(
          `[Call] refusing peer create: wanted ${opts.callType}, locked ${callType}`,
        );
      }

      disposePeer();
      const peer = new CallPeer({
        iceServers: opts.iceServers,
        isCaller: opts.isCaller,
        callType,
        onQuality: (quality) => {
          if (!isActiveCall(opts.callId, callType)) return;
          patch({ quality });
          socket?.emit('call:quality', { callId: opts.callId, quality });
        },
        handlers: {
          onLocalStream: (stream) => {
            if (!isActiveCall(opts.callId, callType)) {
              try {
                stream?.getTracks?.()?.forEach((t: any) => t.stop());
              } catch {
                /* ignore */
              }
              return;
            }
            // Voice calls: audio only — do not surface a camera stream in UI
            if (callType === 'voice') {
              patch({ localStream: null });
              return;
            }
            patch({
              localStream: stream,
              localMirrored: peerRef.current?.isFrontCamera?.() !== false,
            });
          },
          onRemoteStream: (stream) => {
            if (!isActiveCall(opts.callId, callType)) return;
            // Voice: ignore remote video tracks for UI (audio still plays via WebRTC)
            if (callType === 'voice') {
              patch({ remoteStream: null });
              return;
            }
            patch({ remoteStream: stream });
          },
          onIceCandidate: (candidate) => {
            if (!isActiveCall(opts.callId, callType)) return;
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
            if (!isActiveCall(opts.callId, callType)) return;
            if (conn === 'connected' || conn === 'completed') {
              clearExploreRecover();
              patch({ phase: 'connected', connectedAt: Date.now() });
              socket?.emit('call:connected', { callId: opts.callId });
              void reinforceCallAudio(stateRef.current.speakerOn);
            } else if (conn === 'connecting') {
              patch({ phase: 'connecting' });
            } else if (conn === 'disconnected') {
              // Transient — wait for ICE to recover; do NOT hang up
              patch({ phase: 'reconnecting' });
            } else if (conn === 'failed' || conn === 'closed') {
              if (
                stateRef.current.phase === 'ended' ||
                stateRef.current.phase === 'idle'
              ) {
                return;
              }
              // WhatsApp-style: stay in call through brief ICE/WebRTC flaps.
              // Only hang up if we never recover (peer End / Skip still ends it).
              patch({ phase: 'reconnecting' });
              if (!callRecoverHold.timer) {
                callRecoverHold.timer = setTimeout(() => {
                  callRecoverHold.timer = null;
                  const s = stateRef.current;
                  if (
                    s.callId !== opts.callId ||
                    s.phase === 'connected' ||
                    s.phase === 'ended' ||
                    s.phase === 'idle'
                  ) {
                    return;
                  }
                  socket?.emit('call:end', { callId: opts.callId });
                  finishCall('disconnect');
                }, 45_000);
              }
            }
          },
          onIceConnectionState: (ice) => {
            if (!isActiveCall(opts.callId, callType)) return;
            if (ice === 'disconnected') patch({ phase: 'reconnecting' });
            if (ice === 'connected' || ice === 'completed') {
              clearExploreRecover();
              patch({
                phase: 'connected',
                connectedAt: stateRef.current.connectedAt || Date.now(),
              });
              void reinforceCallAudio(stateRef.current.speakerOn);
            }
            // ice "failed" alone must not kill the call — wait for
            // connectionState + recover window (peer End / Skip still ends it).
            if (ice === 'failed') {
              if (
                stateRef.current.phase !== 'ended' &&
                stateRef.current.phase !== 'idle'
              ) {
                patch({ phase: 'reconnecting' });
              }
            }
          },
          onError: (err) => {
            if (!isActiveCall(opts.callId, callType)) return;
            if (isCallPermissionError(err)) {
              // Handled by createPeer caller via throw / finishCall — don't paint red toast
              return;
            }
            patch({ error: err.message });
          },
        },
      });
      peerRef.current = peer;
      await peer.start();
      // Race: call cancelled / ended while getUserMedia was pending
      if (!isActiveCall(opts.callId, callType)) {
        disposePeer();
        return null;
      }
      if (stateRef.current.muted) peer.setMuted(true);
      // Voice: always keep camera off; video: respect cameraOff flag
      if (callType === 'voice' || stateRef.current.cameraOff) {
        peer.setCameraEnabled(false);
      }
      return peer;
    },
    [
      clearExploreRecover,
      disposePeer,
      finishCall,
      isActiveCall,
      patch,
      socket,
    ]
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
      const phase = stateRef.current.phase;
      // Stuck non-idle from a failed previous attempt — clear so tap always works
      if (phase !== 'idle' && phase !== 'ended') {
        if (
          phase === 'outgoing' ||
          phase === 'ringing' ||
          phase === 'connecting' ||
          phase === 'reconnecting'
        ) {
          // User explicitly starting a new call — tear down the stuck one
          try {
            if (stateRef.current.callId) {
              socket?.emit('call:cancel', { callId: stateRef.current.callId });
              socket?.emit('call:end', { callId: stateRef.current.callId });
            }
          } catch {
            /* ignore */
          }
          finishCall('superseded');
          // Let state settle one tick before opening the new call
          await new Promise((r) => setTimeout(r, 50));
        } else {
          Alert.alert('Already in a call', 'End the current call first.');
          return;
        }
      }

      // Socket disconnects on background; wait for resume reconnect before failing
      const ready = await ensureSocketConnected(socket);
      if (!ready) {
        Alert.alert(
          'Not connected',
          'Could not reach the call server. Check your internet, wait a moment if the app just opened, and try again.',
        );
        return;
      }

      if (!isWebRTCAvailable()) {
        Alert.alert('Calls unavailable', getWebRTCUnavailableMessage());
        return;
      }

      if (endClearTimer.current) clearTimeout(endClearTimer.current);

      // Open calling UI immediately — permission dialog must not block the screen
      const callId = generateClientCallId();
      pendingCancelRef.current = false;
      iceServersRef.current = [];

      const peer = peerFromOpts(opts);
      const speakerOn = opts.callType === 'video';
      callTypeRef.current = opts.callType;

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
        localStream: null,
        remoteStream: null,
        minimized: false,
        error: null,
        peerOffline: false,
        isExplore: false,
      });

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

      // Calling UI is already open. Open camera/mic FIRST (WhatsApp preview),
      // then invite — never ring the friend if permission is denied.
      // Use STUN immediately so preview is not blocked on ICE/TURN fetch.
      if (isWebRTCAvailable()) {
        void (async () => {
          const icePromise = resolveIceServers().then((ice) => {
            iceServersRef.current = ice;
            peerRef.current?.updateIceServers?.(ice);
            return ice;
          });
          try {
            await createPeer({
              iceServers:
                iceServersRef.current.length > 0
                  ? iceServersRef.current
                  : FALLBACK_ICE_SERVERS,
              isCaller: true,
              callType: opts.callType,
              callId,
            });
            // User hung up / superseded while permission dialog was open
            if (
              pendingCancelRef.current ||
              stateRef.current.callId !== callId ||
              stateRef.current.phase === 'ended' ||
              stateRef.current.phase === 'idle'
            ) {
              return;
            }
            try {
              await startCallAudio({ callType: opts.callType, speakerOn });
              void startCallRingback(speakerOn);
            } catch {
              /* non-fatal once preview is up */
            }
            // FGS after mic/camera granted + media open (Play while-in-use)
            void startOngoingCall({
              callId,
              peerName: opts.name || 'Call',
              callType: opts.callType,
              hasCamera: opts.callType === 'video',
              status: 'calling',
            });
            // Prefer TURN before invite when the network fetch finishes quickly
            try {
              await Promise.race([
                icePromise,
                new Promise((r) => setTimeout(r, 1200)),
              ]);
            } catch {
              /* STUN preview is enough to invite; TURN may arrive via ringing */
            }
            if (
              pendingCancelRef.current ||
              stateRef.current.callId !== callId ||
              stateRef.current.phase === 'ended' ||
              stateRef.current.phase === 'idle'
            ) {
              return;
            }
            socket?.emit('call:invite', {
              receiverId: opts.userId,
              callType: opts.callType,
              callId,
            });
          } catch (err) {
            if (isCallPermissionError(err)) {
              Alert.alert(
                'Microphone needed',
                'Allow microphone access to place a call. You can enable it in Settings → Permissions.',
              );
              finishCall('permission');
              return;
            }
            const msg =
              (err as Error)?.message ||
              (opts.callType === 'video'
                ? 'Camera unavailable'
                : 'Microphone unavailable');
            patch({ error: msg, phase: 'ended', endReason: 'media' });
            resetSoon();
          }
        })();
      }
    },
    [createPeer, finishCall, patch, resetSoon, socket]
  );

  const acceptCall = useCallback(async () => {
    const s = stateRef.current;
    if (!socket || !s.callId || s.phase !== 'incoming') return;
    void dismissCallNotifications(s.callId);
    const ready = await ensureSocketConnected(socket);
    if (!ready) {
      Alert.alert(
        'Not connected',
        'Could not reach the call server. Check your internet and try again.',
      );
      return;
    }
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
    // Accept → connecting UI, then open camera/mic before InCall audio session
    patch({ phase: 'connecting', cameraOff: s.callType !== 'video' });
    if (isWebRTCAvailable() && !peerRef.current) {
      try {
        const preferred =
          iceServersRef.current.length > 0
            ? iceServersRef.current
            : FALLBACK_ICE_SERVERS;
        void resolveIceServers(iceServersRef.current).then((ice) => {
          iceServersRef.current = ice;
          peerRef.current?.updateIceServers?.(ice);
        });
        await createPeer({
          iceServers: preferred,
          isCaller: false,
          callType: s.callType,
          callId: s.callId,
        });
      } catch (err) {
        if (isCallPermissionError(err)) {
          socket.emit('call:decline', { callId: s.callId });
          Alert.alert(
            'Microphone needed',
            'Allow microphone access to answer this call. You can enable it in Settings → Permissions.',
          );
          finishCall('permission');
          return;
        }
        const msg =
          (err as Error)?.message ||
          (s.callType === 'video'
            ? 'Camera unavailable'
            : 'Microphone unavailable');
        patch({ error: msg });
        socket.emit('call:decline', { callId: s.callId });
        finishCall('error');
        return;
      }
    } else if (peerRef.current) {
      const ice = await resolveIceServers(iceServersRef.current);
      iceServersRef.current = ice;
      peerRef.current.updateIceServers?.(ice);
    }
    try {
      await startCallAudio({
        callType: s.callType,
        speakerOn: s.speakerOn,
      });
    } catch {
      /* non-fatal once media is up */
    }
    // FGS after accept media is up (Play: user-initiated, while-in-use)
    void startOngoingCall({
      callId: s.callId,
      peerName: s.peer?.name || 'Call',
      callType: s.callType,
      hasCamera: s.callType === 'video' && !stateRef.current.cameraOff,
      status: 'connected',
    });
    socket.emit('call:accept', { callId: s.callId });
  }, [createPeer, finishCall, patch, socket]);

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
    // Camera controls are video-only — voice calls stay audio-only
    if (callTypeRef.current !== 'video' || stateRef.current.callType !== 'video') {
      return;
    }
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
    // WebRTC can overwrite route — reinforce after a tick
    setTimeout(() => {
      void reinforceCallAudio(next);
    }, 200);
  }, [patch, socket]);

  const switchCamera = useCallback(async () => {
    if (callTypeRef.current !== 'video' || stateRef.current.callType !== 'video') {
      return;
    }
    await peerRef.current?.switchCamera();
    patch({
      localMirrored: peerRef.current?.isFrontCamera?.() !== false,
      localStream: peerRef.current?.getLocalStream?.() || stateRef.current.localStream,
    });
  }, [patch]);

  /** Voice ↔ video are separate call types — place a new call to switch. */
  const switchToVideo = useCallback(async () => {}, []);
  const switchToAudio = useCallback(async () => {}, []);

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

      const payloadType: CallMediaType =
        payload.callType === 'video' ? 'video' : 'voice';
      // Keep the type from startCall() only when WE already placed that invite.
      // Explore matchmaking emits call:ringing without startCall(), so callTypeRef
      // is still the idle default 'voice' — trusting the ref would force audio-only
      // and the other side never receives our camera (black remote for them).
      const placedOutgoing =
        !payload.explore &&
        !!stateRef.current.callId &&
        stateRef.current.callId === callId &&
        (stateRef.current.phase === 'outgoing' ||
          stateRef.current.phase === 'ringing');
      const locked: CallMediaType = placedOutgoing
        ? callTypeRef.current === 'video'
          ? 'video'
          : 'voice'
        : payloadType;
      callTypeRef.current = locked;
      const speakerOn = locked === 'video';
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
        callType: locked,
        peer: mergedPeer,
        isExplore: !!payload.explore,
        direction: 'outgoing',
        speakerOn,
        cameraOff: locked !== 'video',
        peerOffline: payload.calleeOnline === false,
      });

      // Keep ringback; create WebRTC offer only after callee accepts.
      // Mic/camera already opened on tap — do NOT recreate here (that blanks preview / drops mic).
      startCallRingback(speakerOn);
      try {
        await startCallAudio({ callType: locked, speakerOn });
        let ice = await resolveIceServers(iceServersRef.current);
        iceServersRef.current = ice;
        if (peerRef.current?.getLocalStream()) {
          // Apply server TURN (critical for cellular) without tearing down preview
          peerRef.current.updateIceServers?.(ice);
        } else if (isWebRTCAvailable()) {
          await createPeer({
            iceServers: ice,
            isCaller: true,
            callType: locked,
            callId,
          });
        }
      } catch (err) {
        if (isCallPermissionError(err)) {
          try {
            socket.emit('call:cancel', { callId });
          } catch {
            /* ignore */
          }
          finishCall('permission');
          return;
        }
        patch({
          error:
            (err as Error).message ||
            (locked === 'video' ? 'Camera unavailable' : 'Microphone unavailable'),
        });
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
      const incomingType: CallMediaType =
        payload.callType === 'video' ? 'video' : 'voice';
      callTypeRef.current = incomingType;

      if (!explore) {
        Vibration.vibrate([0, 500, 400, 500], true);
        void startIncomingRingtone();
        // Background / locked: shade with Answer / Decline
        // (FCM skipped when a socket is live — see backend call:invite).
        // Foreground uses CallOverlay instead of a duplicate tray.
        if (AppState.currentState !== 'active') {
          void presentIncomingCallLocalNotification({
            callId: String(payload.callId),
            callerName: peer.name || 'Incoming call',
            callType: incomingType,
            callerId: String(payload.from || peer.id || ''),
            callerPhoto: peer.photo || '',
          });
        }
      }

      setState({
        ...initialState,
        webrtcReady: isWebRTCAvailable(),
        phase: 'incoming',
        callId: payload.callId,
        callType: incomingType,
        direction: 'incoming',
        peer,
        isExplore: explore,
        speakerOn: incomingType === 'video',
        cameraOff: incomingType !== 'video',
        localStream: null,
        remoteStream: null,
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

      const iceServers = await resolveIceServers(
        payload.iceServers ||
          iceServersRef.current ||
          (onIncoming as any)._ice ||
          [],
      );
      iceServersRef.current = iceServers;

      try {
        if (payload.isCallee) {
          const mediaType = callTypeRef.current;
          if (!peerRef.current) {
            await createPeer({
              iceServers,
              isCaller: false,
              callType: mediaType,
              callId,
            });
          } else {
            peerRef.current.updateIceServers?.(iceServers);
          }
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
          const mediaType = callTypeRef.current;
          // Reuse early mic/camera peer so media never blanks on pickup
          if (peerRef.current?.getLocalStream()) {
            peerRef.current.updateIceServers?.(iceServers);
          } else {
            await createPeer({
              iceServers,
              isCaller: true,
              callType: mediaType,
              callId,
            });
          }
          const offer = await peerRef.current?.createOffer();
          if (offer) socket.emit('call:offer', { callId, sdp: offer });
          startHeartbeat(callId);
        }
      } catch (err) {
        if (isCallPermissionError(err)) {
          socket.emit('call:end', { callId });
          finishCall('permission');
          return;
        }
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
        // Do not flip voice ↔ video mid-call — types stay locked
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
      callTypeRef.current = 'voice';
      const message =
        code === 'busy'
          ? 'Busy on another call'
          : code === 'not_friends'
            ? 'You can only call friends'
            : code === 'blocked'
              ? payload?.error || 'You cannot call this person'
              : payload?.error || 'Call failed';
      patch({
        error: message,
        phase: 'ended',
        endReason: code,
        localStream: null,
        remoteStream: null,
        cameraOff: true,
        minimized: false,
      });
      // Also surface as system alert so it is never silent
      if (code === 'not_friends' || code === 'blocked' || code === 'busy') {
        Alert.alert('Call', message);
      }
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
        void declineCallHttp(pending.callId);
        socket.emit('call:decline', { callId: pending.callId });
        clearPendingIncomingCall(pending.callId);
        pendingNotifIntentRef.current = null;
        void dismissCallNotifications(pending.callId);
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

    // Cold start: restore Answer/Decline intent from disk, then sync
    void hydratePendingIncomingCall().then((pending) => {
      if (pending) applyPendingIntent(pending);
      else syncIncoming();
    });

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
          callerPhoto: peer?.photo || '',
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

  // Keep signaling + heartbeats alive in background during a call (WhatsApp)
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      const s = stateRef.current;
      const inCall =
        !!s.callId &&
        s.phase !== 'idle' &&
        s.phase !== 'ended';
      if (!inCall) return;

      if (next === 'active') {
        if (s.callId) {
          socket?.emit('call:heartbeat', { callId: s.callId });
        }
        void reinforceCallAudio(s.speakerOn);
        // Ensure ongoing notification / FGS is still up after resume
        if (
          s.callId &&
          (s.phase === 'connected' ||
            s.phase === 'connecting' ||
            s.phase === 'reconnecting')
        ) {
          void startOngoingCall({
            callId: s.callId,
            peerName: s.peer?.name || 'Call',
            callType: s.callType,
            hasCamera: s.callType === 'video' && !s.cameraOff,
            status:
              s.phase === 'outgoing'
                ? 'calling'
                : s.phase === 'ringing'
                  ? 'ringing'
                  : 'connected',
          });
        }
        return;
      }

      // background / inactive — do NOT end the call; keep heartbeats flowing.
      // Do not first-create mic/camera FGS from background (Android while-in-use).
      if (s.callId && (s.phase === 'connected' || s.phase === 'reconnecting')) {
        socket?.emit('call:heartbeat', { callId: s.callId });
        void startOngoingCall({
          callId: s.callId,
          peerName: s.peer?.name || 'Call',
          callType: s.callType,
          hasCamera: s.callType === 'video' && !s.cameraOff,
          status: 'connected',
        });
        if (s.callType === 'video' && !s.cameraOff) {
          void enterCallPictureInPicture();
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [socket]);

  // Ongoing call FGS only while media is active (Play: user-initiated call).
  // - Caller: outgoing/ringing already capturing mic after getUserMedia
  // - Callee: only after accept → connecting (not while incoming tray alone)
  // - Never while idle/ended; stop immediately on those phases
  useEffect(() => {
    const s = state;
    const shouldShow =
      !!s.callId &&
      (s.phase === 'outgoing' ||
        s.phase === 'ringing' ||
        s.phase === 'connecting' ||
        s.phase === 'connected' ||
        s.phase === 'reconnecting');

    if (!shouldShow) {
      if (s.phase === 'idle' || s.phase === 'ended' || s.phase === 'incoming') {
        void stopOngoingCall();
      }
      return;
    }

    void startOngoingCall({
      callId: s.callId!,
      peerName: s.peer?.name || 'Call',
      callType: s.callType,
      hasCamera: s.callType === 'video' && !s.cameraOff,
      status:
        s.phase === 'outgoing'
          ? 'calling'
          : s.phase === 'ringing'
            ? 'ringing'
            : 'connected',
    });
  }, [
    state.callId,
    state.phase,
    state.peer?.name,
    state.callType,
    state.cameraOff,
  ]);

  // End Call from ongoing notification action
  useEffect(() => {
    const unsub = subscribeOngoingCallEnd((callId) => {
      const s = stateRef.current;
      if (!s.callId) return;
      if (callId && callId !== s.callId) return;
      endCall();
    });
    return unsub;
  }, [endCall]);

  // Tap ongoing notification → restore full call UI
  useEffect(() => {
    const unsub = subscribeOngoingCallOpen((callId) => {
      const s = stateRef.current;
      if (!s.callId) return;
      if (callId && callId !== s.callId) return;
      setMinimized(false);
    });
    return unsub;
  }, [setMinimized]);

  useEffect(() => {
    return () => {
      setCallSessionActive(false);
      stopHeartbeat();
      clearExploreRecover();
      disposePeer();
      Vibration.cancel();
      void stopOngoingCall();
      if (endClearTimer.current) clearTimeout(endClearTimer.current);
    };
  }, [clearExploreRecover, disposePeer, stopHeartbeat]);

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
