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
  Vibration,
} from 'react-native';
import { Audio } from 'expo-av';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { apiRequest } from '../utils/api';
import { getAuthToken } from '../utils/auth';
import {
  CallPeer,
  CallMediaType,
  NetworkQuality,
  isWebRTCAvailable,
} from '../services/webrtc';
import { resolveMediaUrl } from '../utils/media';

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
  speakerOn: true,
  minimized: false,
  connectedAt: null,
  endReason: null,
  quality: 'unknown',
  localStream: null,
  remoteStream: null,
  error: null,
  webrtcReady: isWebRTCAvailable(),
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
      stopHeartbeat();
      disposePeer();
      Vibration.cancel();
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

  const configureAudio = useCallback(async (speakerOn: boolean) => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: !speakerOn,
      });
    } catch (err) {
      console.warn('[Call] audio mode:', (err as Error).message);
    }
  }, []);

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
      if (!socket?.connected) {
        patch({ error: 'Not connected. Try again.' });
        return;
      }
      if (stateRef.current.phase !== 'idle' && stateRef.current.phase !== 'ended') {
        patch({ error: 'Already in a call' });
        return;
      }

      if (endClearTimer.current) clearTimeout(endClearTimer.current);

      const peer = peerFromOpts(opts);

      // Always show the other person's DP/name first (WhatsApp-style), even if setup fails
      setState({
        ...initialState,
        webrtcReady: isWebRTCAvailable(),
        phase: 'outgoing',
        callType: opts.callType,
        direction: 'outgoing',
        peer,
        speakerOn: opts.callType === 'video',
        cameraOff: opts.callType !== 'video',
        minimized: false,
      });

      if (!isWebRTCAvailable()) {
        patch({
          error:
            'Voice/video calls need a development build (Expo Go does not include WebRTC).',
          phase: 'ended',
          endReason: 'error',
          peer,
        });
        resetSoon();
        return;
      }

      await configureAudio(true);

      socket.emit('call:invite', {
        receiverId: opts.userId,
        callType: opts.callType,
      });
    },
    [configureAudio, patch, resetSoon, socket]
  );

  const acceptCall = useCallback(async () => {
    const s = stateRef.current;
    if (!socket || !s.callId || s.phase !== 'incoming') return;
    if (!isWebRTCAvailable()) {
      patch({
        error:
          'Voice/video calls need a development build (Expo Go does not include WebRTC).',
      });
      socket.emit('call:decline', { callId: s.callId });
      finishCall('error');
      return;
    }
    Vibration.cancel();
    patch({ phase: 'connecting' });
    await configureAudio(s.speakerOn);
    socket.emit('call:accept', { callId: s.callId });
  }, [configureAudio, finishCall, patch, socket]);

  acceptCallRef.current = acceptCall;

  const declineCall = useCallback(() => {
    const s = stateRef.current;
    if (!s.callId) return;
    socket?.emit('call:decline', { callId: s.callId });
    Vibration.cancel();
    finishCall('decline');
  }, [finishCall, socket]);

  const cancelCall = useCallback(() => {
    const s = stateRef.current;
    if (!s.callId) {
      finishCall('cancel');
      return;
    }
    socket?.emit('call:cancel', { callId: s.callId });
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
    await configureAudio(next);
    patch({ speakerOn: next });
    const callId = stateRef.current.callId;
    if (callId) socket?.emit('call:media-state', { callId, speaker: next });
  }, [configureAudio, patch, socket]);

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
      patch({
        phase: 'ringing',
        callId,
        callType,
        peer: mergedPeer,
        isExplore: !!payload.explore,
        direction: 'outgoing',
        speakerOn,
        cameraOff: callType !== 'video',
      });

      try {
        if (!isWebRTCAvailable()) return;
        await configureAudio(speakerOn);
        const peer = await createPeer({
          iceServers: payload.iceServers || [],
          isCaller: true,
          callType,
          callId,
        });
        const offer = await peer.createOffer();
        socket.emit('call:offer', { callId, sdp: offer });
        startHeartbeat(callId);
      } catch (err) {
        patch({ error: (err as Error).message || 'Camera/mic unavailable' });
        socket.emit('call:cancel', { callId });
        finishCall('error');
      }
    };

    const onIncoming = (payload: any) => {
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

      if (!explore) {
        Vibration.vibrate([0, 500, 400, 500], true);
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
      }
    };

    const onAccepted = async (payload: any) => {
      const callId = payload?.callId || stateRef.current.callId;
      if (!callId) return;
      Vibration.cancel();
      patch({ phase: 'connecting', callId });

      const iceServers =
        payload.iceServers ||
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
          // Caller already has peer + offer sent
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
      patch({
        error: payload?.error || 'Call failed',
        phase: 'ended',
        endReason: payload?.code || 'error',
      });
      disposePeer();
      stopHeartbeat();
      Vibration.cancel();
      resetSoon();
    };

    const onConnected = () => {
      patch({
        phase: 'connected',
        connectedAt: stateRef.current.connectedAt || Date.now(),
      });
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
    configureAudio,
  ]);

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
