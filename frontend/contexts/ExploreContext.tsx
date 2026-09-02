import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useCall } from './CallContext';
import { useSocket } from './SocketContext';
import { isWebRTCAvailable } from '../services/webrtc';

export type ExploreCallMode = 'video' | 'voice';
export type ExploreStatus = 'idle' | 'searching' | 'matched' | 'cooldown';

export type ExplorePeer = {
  name: string;
  publicId: string;
  photo?: string;
  gender?: string;
};

type ExploreContextValue = {
  mode: ExploreCallMode;
  setMode: (mode: ExploreCallMode) => void;
  status: ExploreStatus;
  cooldownSec: number;
  matchedPeer: ExplorePeer | null;
  joinQueue: () => void;
  skipWithCooldown: () => void;
  leaveQueue: () => void;
};

const ExploreContext = createContext<ExploreContextValue | null>(null);

const SKIP_COOLDOWN_SEC = 3;

export function ExploreProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket();
  const call = useCall();

  const [mode, setMode] = useState<ExploreCallMode>('video');
  const [status, setStatus] = useState<ExploreStatus>('idle');
  const [cooldownSec, setCooldownSec] = useState(0);
  const [matchedPeer, setMatchedPeer] = useState<ExplorePeer | null>(null);

  const modeRef = useRef(mode);
  const statusRef = useRef(status);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearCooldownTimer = useCallback(() => {
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  }, []);

  const startCooldownAndRejoin = useCallback(() => {
    clearCooldownTimer();
    setStatus('cooldown');
    setCooldownSec(SKIP_COOLDOWN_SEC);
    setMatchedPeer(null);

    let left = SKIP_COOLDOWN_SEC;
    cooldownTimerRef.current = setInterval(() => {
      left -= 1;
      setCooldownSec(left);
      if (left <= 0) {
        clearCooldownTimer();
        setStatus('searching');
        socket?.emit('explore:join', { callType: modeRef.current });
      }
    }, 1000);
  }, [clearCooldownTimer, socket]);

  const joinQueue = useCallback(() => {
    if (!socket?.connected) return;
    if (!isWebRTCAvailable()) return;
    if (call.phase !== 'idle' && call.phase !== 'ended') return;
    if (statusRef.current === 'cooldown') return;
    socket.emit('explore:join', { callType: modeRef.current });
  }, [call.phase, socket]);

  const leaveQueue = useCallback(() => {
    clearCooldownTimer();
    setCooldownSec(0);
    if (!socket?.connected) {
      setStatus('idle');
      setMatchedPeer(null);
      return;
    }
    if (statusRef.current === 'searching') {
      socket.emit('explore:leave');
    }
    setStatus('idle');
    setMatchedPeer(null);
  }, [clearCooldownTimer, socket]);

  const skipWithCooldown = useCallback(() => {
    if (!socket?.connected) return;
    if (statusRef.current === 'cooldown' || cooldownSec > 0) return;

    const inCall =
      call.phase !== 'idle' && call.phase !== 'ended';

    if (inCall) {
      call.endCall();
    } else if (statusRef.current === 'searching') {
      socket.emit('explore:skip');
    }

    startCooldownAndRejoin();
  }, [call, cooldownSec, socket, startCooldownAndRejoin]);

  useEffect(() => {
    if (!socket) return;

    const onSearching = (payload: { callType?: ExploreCallMode }) => {
      if (payload?.callType === 'video' || payload?.callType === 'voice') {
        setMode(payload.callType);
      }
      setStatus('searching');
      setMatchedPeer(null);
    };

    const onIdle = () => {
      if (statusRef.current !== 'cooldown') {
        setStatus('idle');
        setMatchedPeer(null);
      }
    };

    const onMatched = (payload: { peer?: ExplorePeer }) => {
      setStatus('matched');
      if (payload?.peer) {
        setMatchedPeer({
          name: payload.peer.name || 'User',
          publicId: payload.peer.publicId || '',
          photo: payload.peer.photo || '',
          gender: payload.peer.gender || '',
        });
      }
    };

    const onError = () => {
      if (statusRef.current !== 'cooldown') {
        setStatus('idle');
        setMatchedPeer(null);
      }
    };

    socket.on('explore:searching', onSearching);
    socket.on('explore:idle', onIdle);
    socket.on('explore:matched', onMatched);
    socket.on('explore:error', onError);

    return () => {
      socket.off('explore:searching', onSearching);
      socket.off('explore:idle', onIdle);
      socket.off('explore:matched', onMatched);
      socket.off('explore:error', onError);
    };
  }, [socket]);

  useEffect(() => {
    if (
      call.isExplore &&
      (call.phase === 'idle' || call.phase === 'ended') &&
      statusRef.current === 'matched'
    ) {
      setStatus('idle');
      setMatchedPeer(null);
    }
  }, [call.isExplore, call.phase]);

  useEffect(() => () => clearCooldownTimer(), [clearCooldownTimer]);

  const value: ExploreContextValue = {
    mode,
    setMode,
    status,
    cooldownSec,
    matchedPeer,
    joinQueue,
    skipWithCooldown,
    leaveQueue,
  };

  return (
    <ExploreContext.Provider value={value}>{children}</ExploreContext.Provider>
  );
}

export function useExplore() {
  const ctx = useContext(ExploreContext);
  if (!ctx) throw new Error('useExplore must be used within ExploreProvider');
  return ctx;
}
