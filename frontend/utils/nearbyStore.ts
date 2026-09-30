import { AppState, type AppStateStatus } from 'react-native';
import { getAuthToken } from './auth';
import { normalizeEmail } from './normalizeEmail';
import {
  fetchNearbyUsersPage,
  loadNearbyFeed,
  NEARBY_PAGE_SIZE,
  prefetchAvatars,
  sortNearbyByLane,
  type NearbyUser,
} from './nearby';
import {
  clearNearbyFeedCache,
  getNearbyFeedCache,
  hydrateNearbyFeedCache,
  NEARBY_REFRESH_HINT,
  setNearbyFeedCache,
} from './nearbyFeedCache';
import { isOnline, onBackOnline } from './connectivity';

/** Why the last load failed: no network vs. server/API trouble. */
export type NearbyError = 'offline' | 'server' | null;

export type NearbyPrefs = {
  gender: string;
  radiusKm: number;
  activeWithinMinutes: number;
};

export type NearbyFeedSnapshot = {
  email: string;
  users: NearbyUser[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  hint: string | null;
  error: NearbyError;
  freshEmpty: boolean;
  prefsKey: string;
  revision: number;
};

/** 'sync' = filters changed from the server copy, not by the user: swap rows quietly. */
type RefreshReason =
  | 'start'
  | 'pull'
  | 'foreground'
  | 'focus'
  | 'prefs'
  | 'sync'
  | 'retry'
  | 'auto'
  | 'reconnect';

const REFRESH_COOLDOWN_MS = 12_000;
/** Quick glances away (notification shade, permission dialog) don't reload the list. */
const MIN_BACKGROUND_MS = 3_000;
const FOREGROUND_COOLDOWN_MS = 5_000;
/** Switching back to the Discover tab reloads only when the list is this old. */
const FOCUS_STALE_MS = 30_000;
/**
 * Automatic refresh failed: keep retrying quietly while the app is in front,
 * doubling up to a cap so a sleeping server (30-50 s cold boot) or a dead
 * connection recovers without the user pulling.
 */
const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 60_000;
/**
 * A request older than this is frozen (JS suspended in background) or hung —
 * fetchWithTimeout settles at 12 s, so anything later may be replaced.
 */
const STALE_INFLIGHT_MS = 15_000;
/** While Discover is open and the app is in front, pull new people this often. */
export const NEARBY_AUTO_REFRESH_MS = 120_000;
const PERSIST_MS = 500;

const EMPTY: NearbyFeedSnapshot = {
  email: '',
  users: [],
  hasMore: true,
  loading: false,
  loadingMore: false,
  refreshing: false,
  hint: null,
  error: null,
  freshEmpty: false,
  prefsKey: '',
  revision: 0,
};

let state: NearbyFeedSnapshot = EMPTY;
const listeners = new Set<() => void>();
let gen = 0;
let inFlight = false;
let inFlightAt = 0;
let lastOkAt = 0;
/** The last automatic or manual refresh failed and hasn't succeeded since. */
let lastFailed = false;
let lastForegroundAt = 0;
let lastPrefs: NearbyPrefs | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let appStateBound = false;
let appState: AppStateStatus = AppState.currentState;
let backgroundAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * AppState.currentState is null/'unknown' until the first native event on some
 * cold starts — treat that as foreground so the first load isn't blocked.
 */
function isAppActive(): boolean {
  const s = AppState.currentState as AppStateStatus | null | 'unknown';
  return s === 'active' || s == null || s === 'unknown';
}

function retryDelay(attempt: number): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempt, 10));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Refresh failed: keep whatever is on screen and try again quietly with backoff. */
function scheduleSilentRetry(prefs: NearbyPrefs, attempt: number) {
  clearRetry();
  // No network: requests can't succeed — the back-online event retries instead
  if (!isOnline()) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    // Backgrounded: the foreground handler retries on resume instead
    if (!isAppActive() || !state.email) return;
    void refresh({ prefs, reason: 'retry', attempt: attempt + 1 });
  }, retryDelay(attempt));
}

function prefsKeyOf(prefs: NearbyPrefs) {
  return `${prefs.gender}|${prefs.radiusKm}|${prefs.activeWithinMinutes}`;
}

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): NearbyFeedSnapshot {
  return state;
}

function setState(partial: Partial<NearbyFeedSnapshot>) {
  const next: NearbyFeedSnapshot = { ...state, ...partial };
  if (
    next.email === state.email &&
    next.users === state.users &&
    next.hasMore === state.hasMore &&
    next.loading === state.loading &&
    next.loadingMore === state.loadingMore &&
    next.refreshing === state.refreshing &&
    next.hint === state.hint &&
    next.error === state.error &&
    next.freshEmpty === state.freshEmpty &&
    next.prefsKey === state.prefsKey
  ) {
    return;
  }
  next.revision = state.revision + 1;
  state = next;
  emit();
}

function sameUser(a: NearbyUser, b: NearbyUser): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.photo === b.photo &&
    a.coverPhoto === b.coverPhoto &&
    a.bio === b.bio &&
    a.age === b.age &&
    a.isOnline === b.isOnline &&
    a.distanceKm === b.distanceKm &&
    a.distance === b.distance &&
    a.iLiked === b.iLiked &&
    a.theyLiked === b.theyLiked &&
    a.areFriends === b.areFriends &&
    a.friendshipStatus === b.friendshipStatus &&
    a.nearbyLane === b.nearbyLane &&
    a.nearbyLowPriority === b.nearbyLowPriority &&
    a.publicId === b.publicId
  );
}

function mergeUsers(prev: NearbyUser[], incoming: NearbyUser[]): NearbyUser[] {
  if (prev === incoming) return prev;
  if (!incoming.length) return incoming;
  const byId = new Map(prev.map((u) => [u.id, u]));
  let reused = 0;
  const merged = incoming.map((u) => {
    const old = byId.get(u.id);
    if (old && sameUser(old, u)) {
      reused += 1;
      return old;
    }
    return old ? { ...old, ...u } : u;
  });
  if (
    reused === merged.length &&
    merged.length === prev.length &&
    merged.every((u, i) => u === prev[i])
  ) {
    return prev;
  }
  return merged;
}

function schedulePersist(persist: boolean) {
  if (!persist || !state.email || !state.users.length) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!state.email || !state.users.length) return;
    setNearbyFeedCache(state.email, state.users, state.prefsKey);
  }, PERSIST_MS);
}

function applyUsers(
  users: NearbyUser[],
  extra: Partial<NearbyFeedSnapshot> = {},
  persist = true,
) {
  const merged = mergeUsers(state.users, users);
  setState({ users: merged, ...extra });
  schedulePersist(persist);
}

export function bindAccount(email?: string | null) {
  const next = normalizeEmail(email || '');
  if (next === state.email) return;
  gen += 1;
  inFlight = false;
  lastOkAt = 0;
  lastFailed = false;
  lastPrefs = null;
  clearRetry();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (state.email && next && state.email !== next) {
    clearNearbyFeedCache(state.email);
  }
  if (!next) {
    setState({ ...EMPTY, revision: state.revision });
    return;
  }
  const cached = sortNearbyByLane(getNearbyFeedCache(next));
  setState({
    email: next,
    users: cached,
    hasMore: true,
    loading: cached.length === 0,
    loadingMore: false,
    refreshing: false,
    hint: null,
    error: null,
    freshEmpty: false,
    prefsKey: '',
  });
}

export async function hydrateAccount(email?: string | null) {
  const e = normalizeEmail(email || '');
  if (!e) return;
  bindAccount(e);
  if (state.users.length) return;
  const cached = await hydrateNearbyFeedCache(e);
  if (normalizeEmail(state.email) !== e || !cached.length) return;
  // A live answer (even a genuine empty list) already landed — never cover it with disk rows
  if (state.users.length || lastOkAt || state.freshEmpty) return;
  applyUsers(sortNearbyByLane(cached), { loading: false, freshEmpty: false }, false);
}

function inFlightIsStale() {
  return inFlight && Date.now() - inFlightAt > STALE_INFLIGHT_MS;
}

function shouldSkip(reason: RefreshReason, prefs: NearbyPrefs) {
  if (reason === 'pull' || reason === 'prefs' || reason === 'sync') return false;
  if (inFlight && !inFlightIsStale()) return true;
  if (reason === 'retry' || lastFailed) return false;
  const key = prefsKeyOf(prefs);
  if (state.prefsKey && state.prefsKey !== key) return false;
  if (!lastOkAt) return false;
  const wait =
    reason === 'foreground'
      ? FOREGROUND_COOLDOWN_MS
      : reason === 'focus' || reason === 'reconnect'
        ? FOCUS_STALE_MS
        : reason === 'auto'
          ? NEARBY_AUTO_REFRESH_MS - 5_000
          : REFRESH_COOLDOWN_MS;
  return Date.now() - lastOkAt < wait && state.users.length > 0;
}

export async function refresh(opts: {
  prefs: NearbyPrefs;
  reason?: RefreshReason;
  attempt?: number;
}) {
  const prefs = opts.prefs;
  const reason = opts.reason || 'start';
  const attempt = opts.attempt ?? 0;
  lastPrefs = prefs;
  if (reason === 'pull' || reason === 'prefs' || reason === 'sync') clearRetry();
  const key = prefsKeyOf(prefs);

  if (shouldSkip(reason, prefs)) return;
  // New filters (or a pull) supersede any request still running with old ones;
  // so does anything once the running request is frozen/hung.
  const supersede =
    reason === 'pull' || reason === 'prefs' || reason === 'sync' || inFlightIsStale();
  if (inFlight && !supersede) return;

  // Known offline: say so at once instead of spinning until a fetch times out
  if (!isOnline() && reason !== 'prefs') {
    failRefresh(reason, state.users.length > 0, prefs, attempt);
    return;
  }

  if (supersede && inFlight) {
    gen += 1;
    inFlight = false;
    // A superseded loadMore never clears its own footer spinner
    if (state.loadingMore) setState({ loadingMore: false });
  }

  const myGen = ++gen;
  inFlight = true;
  inFlightAt = Date.now();
  if (reason === 'prefs') {
    // Rows from the old filters must not linger while the new ones load.
    setState({ users: [], hasMore: true, loading: true, loadingMore: false, refreshing: false, hint: null, error: null, freshEmpty: false, prefsKey: key });
  }
  const hadRows = state.users.length > 0;
  // An error already on screen stays put while we retry — no spinner/error flicker
  const keepError = !!state.error && reason !== 'prefs';
  if (reason === 'pull') {
    setState({ refreshing: true, hint: hadRows || keepError ? state.hint : null });
  } else if (!hadRows && !keepError) setState({ loading: true, hint: null });

  try {
    const token = await getAuthToken();
    if (myGen !== gen) return;
    if (!token) {
      setState({
        hint: hadRows ? NEARBY_REFRESH_HINT : 'Please sign in to see nearby people.',
        loading: false,
        refreshing: false,
      });
      return;
    }

    const { users, hasMore, ok } = await loadNearbyFeed(token, {
      radiusKm: prefs.radiusKm,
      gender: prefs.gender,
      activeWithinMinutes: prefs.activeWithinMinutes,
      mode: 'initial',
      preferCachedLocation: true,
      refreshFast: true,
    });
    if (myGen !== gen) return;

    if (!ok) {
      failRefresh(reason, hadRows, prefs, attempt);
      return;
    }

    clearRetry();
    lastFailed = false;
    lastOkAt = Date.now();
    if (reason === 'foreground') lastForegroundAt = lastOkAt;
    if (!users.length) {
      if (state.email) setNearbyFeedCache(state.email, []);
      setState({
        users: [],
        hasMore: false,
        hint: null,
        error: null,
        freshEmpty: true,
        loading: false,
        refreshing: false,
        prefsKey: key,
      });
      return;
    }

    const sorted = sortNearbyByLane(users);
    prefetchAvatars(sorted.map((u) => u.photo), NEARBY_PAGE_SIZE);
    applyUsers(
      sorted,
      {
        hasMore: hasMore && users.length > 0,
        hint: null,
        error: null,
        freshEmpty: false,
        loading: false,
        refreshing: false,
        prefsKey: key,
      },
      true,
    );
  } catch {
    if (myGen !== gen) return;
    failRefresh(reason, hadRows, prefs, attempt);
  } finally {
    if (myGen === gen) inFlight = false;
  }
}

function failRefresh(
  reason: RefreshReason,
  hadRows: boolean,
  prefs: NearbyPrefs,
  attempt: number,
) {
  const userAsked = reason === 'pull' || reason === 'prefs';
  lastFailed = true;
  const error: NearbyError = isOnline() ? 'server' : 'offline';
  if (hadRows && !userAsked) {
    // Automatic refresh: the list on screen stays as-is, no banner.
    setState({ loading: false, refreshing: false, error });
  } else {
    setState({
      hint: NEARBY_REFRESH_HINT,
      error,
      loading: false,
      refreshing: false,
    });
  }
  // Either way keep trying in the background — the server may just be waking up
  scheduleSilentRetry(prefs, userAsked ? 0 : attempt);
}

/** Periodic quiet refresh while Discover is on screen. */
export function refreshAuto(prefs: NearbyPrefs) {
  if (!isAppActive()) return;
  void refresh({ prefs, reason: 'auto' });
}

/**
 * The realtime connection came back (server woke up / internet returned):
 * retry a failed load right away, or pull fresh people if the list is old.
 */
export function refreshOnReconnect() {
  if (!isAppActive() || !state.email || !lastPrefs) return;
  if (!lastFailed && Date.now() - lastOkAt < FOCUS_STALE_MS && state.users.length) return;
  clearRetry();
  void refresh({ prefs: lastPrefs, reason: 'reconnect' });
}

export async function loadMore(prefs: NearbyPrefs) {
  if (inFlight || state.loadingMore || state.loading || !state.hasMore) return;
  if (!state.users.length) return;
  lastPrefs = prefs;
  const myGen = gen;
  inFlight = true;
  inFlightAt = Date.now();
  setState({ loadingMore: true });
  try {
    const token = await getAuthToken();
    if (!token || myGen !== gen) return;
    const { users, hasMore, error } = await fetchNearbyUsersPage(token, {
      radiusKm: prefs.radiusKm,
      gender: prefs.gender,
      activeWithinMinutes: prefs.activeWithinMinutes,
      mode: 'more',
      limit: NEARBY_PAGE_SIZE,
      excludeIds: state.users.map((u) => u.id),
    });
    if (myGen !== gen) return;
    if (error || !users.length) {
      setState({ hasMore: false, loadingMore: false });
      return;
    }
    const seen = new Set(state.users.map((u) => u.id));
    const appended = users.filter((u) => !seen.has(u.id));
    applyUsers(sortNearbyByLane([...state.users, ...appended]), {
      hasMore,
      loadingMore: false,
    });
  } catch {
    if (myGen === gen) setState({ loadingMore: false });
  } finally {
    if (myGen === gen) inFlight = false;
  }
}

export function patchUsers(
  mapper: (user: NearbyUser) => NearbyUser,
  opts?: { resort?: boolean; persist?: boolean },
) {
  let changed = false;
  const next = state.users.map((u) => {
    const patched = mapper(u);
    if (patched === u) return u;
    changed = true;
    return patched;
  });
  if (!changed) return;
  const users = opts?.resort ? sortNearbyByLane(next) : next;
  applyUsers(users, {}, opts?.persist !== false);
}

export function removeUser(id: string) {
  if (!state.users.some((u) => u.id === id)) return;
  applyUsers(
    state.users.filter((u) => u.id !== id),
    {},
    true,
  );
}

export function ensureAppStateBound() {
  if (appStateBound) return;
  appStateBound = true;
  onBackOnline(() => refreshOnReconnect());
  AppState.addEventListener('change', (next: AppStateStatus) => {
    const was = appState;
    appState = next;
    if (next === 'background') {
      backgroundAt = Date.now();
      clearRetry();
      return;
    }
    if (next !== 'active' || was === 'active') return;
    if (!state.email || !lastPrefs) return;
    const now = Date.now();
    const awayMs = backgroundAt ? now - backgroundAt : Number.POSITIVE_INFINITY;
    backgroundAt = 0;
    // A failed load always retries on return; a healthy list only after a real absence
    if (!lastFailed) {
      if (awayMs < MIN_BACKGROUND_MS) return;
      if (now - lastForegroundAt < FOREGROUND_COOLDOWN_MS) return;
    }
    lastForegroundAt = now;
    clearRetry();
    void refresh({ prefs: lastPrefs, reason: 'foreground' });
  });
}

/** Discover tab regained focus — reload quietly only if the list is stale. */
export function refreshIfStale(prefs: NearbyPrefs) {
  if (!isAppActive()) return;
  void refresh({ prefs, reason: 'focus' });
}

export { NEARBY_REFRESH_HINT };
