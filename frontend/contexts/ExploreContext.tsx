import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCall } from './CallContext';
import { useSocket } from './SocketContext';
import { apiRequest } from '../utils/api';
import { getAuthToken } from '../utils/auth';
import { ensureSocketConnected } from '../utils/ensureSocketConnected';
import { canonicalShowMe, type ShowMeValue } from '../utils/showMe';

export type ExploreCallMode = 'video' | 'voice';
export type ExploreStatus = 'idle' | 'searching' | 'matched' | 'cooldown';

export type ExplorePeer = {
  name: string;
  publicId: string;
  photo?: string;
  gender?: string;
};

export type ExplorePrefs = {
  showMe: ShowMeValue;
  verifiedOnly: boolean;
};

const DEFAULT_PREFS: ExplorePrefs = {
  showMe: 'All',
  verifiedOnly: false,
};

const STORAGE_KEY = 'luvstor:explorePrefs';

type ExploreContextValue = {
  mode: ExploreCallMode;
  status: ExploreStatus;
  cooldownSec: number;
  matchedPeer: ExplorePeer | null;
  prefs: ExplorePrefs;
  setPrefs: (next: ExplorePrefs) => void;
  joinVideo: () => void;
  joinVoice: () => void;
  skipWithCooldown: () => void;
  leaveQueue: () => void;
};

const ExploreContext = createContext<ExploreContextValue | null>(null);

const SKIP_COOLDOWN_SEC = 3;

const ANON_PEER: ExplorePeer = {
  name: '',
  publicId: '',
  photo: '',
  gender: '',
};

function inActiveCall(call: {
  phase: string;
  isExplore: boolean;
}): 'friend' | 'explore' | null {
  if (call.phase === 'idle' || call.phase === 'ended') return null;
  return call.isExplore ? 'explore' : 'friend';
}

function normalizePrefs(raw: Partial<ExplorePrefs> | null | undefined): ExplorePrefs {
  const showMe = (canonicalShowMe(raw?.showMe) || 'All') as ShowMeValue;
  return {
    showMe,
    verifiedOnly: !!raw?.verifiedOnly,
  };
}

/** Keep DP + public ID only — strip real display name. */
function toAnonPeer(peer?: Partial<ExplorePeer> | null): ExplorePeer {
  return {
    ...ANON_PEER,
    publicId: String(peer?.publicId || '').trim(),
    photo: peer?.photo || '',
    gender: peer?.gender || '',
  };
}

export function ExploreProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket();
  const call = useCall();

  const [mode, setMode] = useState<ExploreCallMode>('video');
  const [status, setStatus] = useState<ExploreStatus>('idle');
  const [cooldownSec, setCooldownSec] = useState(0);
  const [matchedPeer, setMatchedPeer] = useState<ExplorePeer | null>(null);
  const [prefs, setPrefsState] = useState<ExplorePrefs>(DEFAULT_PREFS);

  const modeRef = useRef(mode);
  const statusRef = useRef(status);
  const prefsRef = useRef(prefs);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Set synchronously on Skip so call-end effect cannot wipe cooldown */
  const skipInFlightRef = useRef(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  // Load prefs: local cache first, then server profile
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY);
        if (cached && !cancelled) {
          setPrefsState(normalizePrefs(JSON.parse(cached)));
        }
      } catch {
        /* ignore */
      }
      try {
        const token = await getAuthToken();
        if (!token || cancelled) return;
        const me = await apiRequest('/api/users/me', token);
        if (cancelled || !me?.explorePrefs) return;
        const next = normalizePrefs(me.explorePrefs);
        setPrefsState(next);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* keep local */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPrefs = useCallback((next: ExplorePrefs) => {
    const normalized = normalizePrefs(next);
    setPrefsState(normalized);
    prefsRef.current = normalized;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    void (async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        await apiRequest('/api/users/me', token, {
          method: 'PUT',
          body: JSON.stringify({ explorePrefs: normalized }),
        });
      } catch {
        /* local still works */
      }
    })();
  }, []);

  const clearCooldownTimer = useCallback(() => {
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  }, []);

  const emitJoin = useCallback(
    async (nextMode: ExploreCallMode) => {
      const ready = await ensureSocketConnected(socket);
      if (!ready) return;

      const busy = inActiveCall(call);
      if (busy === 'friend') return;
      if (busy === 'explore') return;
      if (statusRef.current === 'cooldown') return;

      setMode(nextMode);
      modeRef.current = nextMode;
      setStatus('searching');
      setMatchedPeer(null);
      socket!.emit('explore:join', {
        callType: nextMode,
        prefs: prefsRef.current,
      });
    },
    [call, socket],
  );

  const joinVideo = useCallback(() => {
    void emitJoin('video');
  }, [emitJoin]);
  const joinVoice = useCallback(() => {
    void emitJoin('voice');
  }, [emitJoin]);

  const startCooldownAndRejoin = useCallback(() => {
    clearCooldownTimer();
    const rejoinMode = modeRef.current;
    setStatus('cooldown');
    statusRef.current = 'cooldown';
    setCooldownSec(SKIP_COOLDOWN_SEC);
    setMatchedPeer(null);

    let left = SKIP_COOLDOWN_SEC;
    cooldownTimerRef.current = setInterval(() => {
      left -= 1;
      setCooldownSec(left);
      if (left <= 0) {
        clearCooldownTimer();
        setStatus('searching');
        statusRef.current = 'searching';
        skipInFlightRef.current = false;
        socket?.emit('explore:join', {
          callType: rejoinMode,
          prefs: prefsRef.current,
        });
      }
    }, 1000);
  }, [clearCooldownTimer, socket]);

  const leaveQueue = useCallback(() => {
    // Never tear down Explore matchmaking UI while a live Explore call is up
    if (inActiveCall(call) === 'explore') return;

    clearCooldownTimer();
    setCooldownSec(0);
    skipInFlightRef.current = false;
    const leaveType = modeRef.current;
    if (socket?.connected && statusRef.current === 'searching') {
      socket.emit('explore:leave', { callType: leaveType });
    }
    setStatus('idle');
    statusRef.current = 'idle';
    setMatchedPeer(null);
  }, [call, clearCooldownTimer, socket]);

  const skipWithCooldown = useCallback(() => {
    if (!socket?.connected) return;
    if (statusRef.current === 'cooldown' || cooldownSec > 0) return;

    skipInFlightRef.current = true;
    const busy = inActiveCall(call);
    if (busy === 'explore') {
      call.endCall();
    } else if (statusRef.current === 'searching') {
      socket.emit('explore:skip', { callType: modeRef.current });
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
      statusRef.current = 'searching';
      setMatchedPeer(null);
    };

    const onIdle = () => {
      if (statusRef.current === 'cooldown' || skipInFlightRef.current) return;
      if (inActiveCall(call) === 'explore') return;
      setStatus('idle');
      statusRef.current = 'idle';
      setMatchedPeer(null);
    };

    const onMatched = (payload: {
      peer?: ExplorePeer;
      callType?: ExploreCallMode;
    }) => {
      if (payload?.callType === 'video' || payload?.callType === 'voice') {
        setMode(payload.callType);
      }
      setStatus('matched');
      statusRef.current = 'matched';
      setMatchedPeer(toAnonPeer(payload?.peer));
    };

    const onError = () => {
      if (statusRef.current === 'cooldown' || skipInFlightRef.current) return;
      if (inActiveCall(call) === 'explore') return;
      setStatus('idle');
      statusRef.current = 'idle';
      setMatchedPeer(null);
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
  }, [call, socket]);

  // Peer hung up / call ended — leave matched UI, but never clobber Skip cooldown
  useEffect(() => {
    if (!call.isExplore) return;
    if (call.phase !== 'idle' && call.phase !== 'ended') return;
    if (statusRef.current === 'cooldown' || skipInFlightRef.current) return;
    if (statusRef.current !== 'matched') return;
    setStatus('idle');
    statusRef.current = 'idle';
    setMatchedPeer(null);
  }, [call.isExplore, call.phase]);

  useEffect(() => () => clearCooldownTimer(), [clearCooldownTimer]);

  const value: ExploreContextValue = {
    mode,
    status,
    cooldownSec,
    matchedPeer,
    prefs,
    setPrefs,
    joinVideo,
    joinVoice,
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
