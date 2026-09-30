import { AppState } from 'react-native';

type NetworkModule = typeof import('expo-network');

/**
 * expo-network needs a native rebuild. Old APKs / Expo Go throw on import —
 * load only when ExpoNetwork is in the binary.
 */
export function loadNetwork(): NetworkModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expo = require('expo') as {
      requireOptionalNativeModule?: (name: string) => unknown;
    };
    const optional =
      typeof expo.requireOptionalNativeModule === 'function'
        ? expo.requireOptionalNativeModule
        : // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('expo-modules-core') as {
            requireOptionalNativeModule: (name: string) => unknown;
          }).requireOptionalNativeModule;
    if (!optional('ExpoNetwork')) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-network') as NetworkModule;
  } catch {
    return null;
  }
}

/** Wi‑Fi ↔ cellular hand-offs report offline for a moment — don't flash for those. */
export const OFFLINE_SHOW_DELAY_MS = 1_200;
/** Normal reconnects finish in a second or two; only a real outage is announced. */
export const RECONNECT_SHOW_DELAY_MS = 5_000;
export const BACK_ONLINE_MS = 2_000;

export type BannerKind = 'offline' | 'reconnecting' | 'back' | null;

/** 'none' = signed out / no socket yet. */
export type SocketLinkState = 'none' | 'connecting' | 'connected' | 'disconnected';

export type ConnectivitySnapshot = {
  /** null = unknown (no expo-network in this binary, or not read yet) */
  networkOnline: boolean | null;
  socket: SocketLinkState;
  /** When the socket last stopped being connected (0 while connected / none). */
  socketDownSince: number;
  /** When the OS last reported no network (0 while online / unknown). */
  offlineSince: number;
  /** When the last outage (offline or socket down) ended, and how long it lasted. */
  recoveredAt: number;
  lastOutageMs: number;
  lastOutageOffline: boolean;
};

let snap: ConnectivitySnapshot = {
  networkOnline: null,
  socket: 'none',
  socketDownSince: 0,
  offlineSince: 0,
  recoveredAt: 0,
  lastOutageMs: 0,
  lastOutageOffline: false,
};

function problemSince(s: ConnectivitySnapshot): number {
  const starts = [s.offlineSince, s.socketDownSince].filter((t) => t > 0);
  return starts.length ? Math.min(...starts) : 0;
}
const listeners = new Set<() => void>();
const backOnlineListeners = new Set<() => void>();
let started = false;
let retryHandler: (() => void) | null = null;

function set(partial: Partial<ConnectivitySnapshot>) {
  const next = { ...snap, ...partial };
  if (
    next.networkOnline === snap.networkOnline &&
    next.socket === snap.socket &&
    next.socketDownSince === snap.socketDownSince &&
    next.offlineSince === snap.offlineSince
  ) {
    return;
  }
  const wasSince = problemSince(snap);
  // Signing out drops the socket on purpose — that isn't a recovery
  if (wasSince && !problemSince(next) && partial.socket !== 'none') {
    next.recoveredAt = Date.now();
    next.lastOutageMs = next.recoveredAt - wasSince;
    next.lastOutageOffline = snap.offlineSince > 0;
  }
  snap = next;
  listeners.forEach((fn) => fn());
}

function applyNetwork(isConnected: boolean | null | undefined) {
  if (isConnected == null) return;
  const wasOffline = snap.networkOnline === false;
  set({
    networkOnline: isConnected,
    offlineSince: isConnected ? 0 : snap.offlineSince || Date.now(),
  });
  if (isConnected && wasOffline) {
    backOnlineListeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* one listener must not block the rest */
      }
    });
  }
}

function readNetworkNow() {
  const Network = loadNetwork();
  if (!Network) return;
  Network.getNetworkStateAsync()
    .then((s) => applyNetwork(s.isConnected))
    .catch(() => undefined);
}

/** Idempotent — one network listener for the whole app. */
export function startConnectivity() {
  if (started) return;
  started = true;
  const Network = loadNetwork();
  if (Network) {
    try {
      Network.addNetworkStateListener((s) => applyNetwork(s.isConnected));
    } catch {
      /* stay 'unknown' */
    }
    readNetworkNow();
  }
  // Network events can be missed while suspended — re-read on return
  AppState.addEventListener('change', (next) => {
    if (next === 'active') readNetworkNow();
  });
}

export function subscribeConnectivity(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getConnectivity(): ConnectivitySnapshot {
  return snap;
}

/** False only when the OS says there is no network; unknown counts as online. */
export function isOnline(): boolean {
  return snap.networkOnline !== false;
}

/** Fires once per offline → online transition. */
export function onBackOnline(fn: () => void) {
  backOnlineListeners.add(fn);
  return () => {
    backOnlineListeners.delete(fn);
  };
}

export function setSocketLinkState(next: SocketLinkState) {
  if (next === snap.socket) return;
  const down = next === 'connecting' || next === 'disconnected';
  set({
    socket: next,
    socketDownSince: down ? snap.socketDownSince || Date.now() : 0,
  });
}

/**
 * What the app-wide bar should show. Offline wins over socket trouble (no
 * point saying "server problem" without a network); "Back online" only follows
 * an outage long enough to have been shown.
 */
export function bannerKind(s: ConnectivitySnapshot, now: number): BannerKind {
  if (s.networkOnline === false) {
    return now - s.offlineSince >= OFFLINE_SHOW_DELAY_MS ? 'offline' : null;
  }
  if (s.socketDownSince && now - s.socketDownSince >= RECONNECT_SHOW_DELAY_MS) {
    return 'reconnecting';
  }
  const wasShown =
    s.lastOutageMs >=
    (s.lastOutageOffline ? OFFLINE_SHOW_DELAY_MS : RECONNECT_SHOW_DELAY_MS);
  if (s.recoveredAt && wasShown && now - s.recoveredAt < BACK_ONLINE_MS) return 'back';
  return null;
}

/** ms until bannerKind() could change on its own (null = only on a store change). */
export function msUntilBannerChange(s: ConnectivitySnapshot, now: number): number | null {
  const at =
    s.networkOnline === false
      ? s.offlineSince + OFFLINE_SHOW_DELAY_MS
      : s.socketDownSince
        ? s.socketDownSince + RECONNECT_SHOW_DELAY_MS
        : s.recoveredAt
          ? s.recoveredAt + BACK_ONLINE_MS
          : 0;
  return at > now ? at - now : null;
}

/** The socket layer registers how to redial now (banner Retry button). */
export function setConnectionRetryHandler(fn: (() => void) | null) {
  retryHandler = fn;
}

export function retryConnectionNow() {
  readNetworkNow();
  retryHandler?.();
}
