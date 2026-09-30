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
  freshEmpty: boolean;
  prefsKey: string;
  revision: number;
};

/** 'sync' = filters changed from the server copy, not by the user: swap rows quietly. */
type RefreshReason = 'start' | 'pull' | 'foreground' | 'focus' | 'prefs' | 'sync';

const REFRESH_COOLDOWN_MS = 12_000;
/** Quick glances away (notification shade, permission dialog) don't reload the list. */
const MIN_BACKGROUND_MS = 3_000;
const FOREGROUND_COOLDOWN_MS = 5_000;
/** Switching back to the Discover tab reloads only when the list is this old. */
const FOCUS_STALE_MS = 60_000;
const SILENT_RETRY_MS = 5_000;
const PERSIST_MS = 500;

const EMPTY: NearbyFeedSnapshot = {
  email: '',
  users: [],
  hasMore: true,
  loading: false,
  loadingMore: false,
  refreshing: false,
  hint: null,
  freshEmpty: false,
  prefsKey: '',
  revision: 0,
};

let state: NearbyFeedSnapshot = EMPTY;
const listeners = new Set<() => void>();
let gen = 0;
let inFlight = false;
let lastOkAt = 0;
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

/** Background refresh failed while rows are on screen: keep them, try again quietly once. */
function scheduleSilentRetry(prefs: NearbyPrefs, attempt: number) {
  clearRetry();
  if (attempt >= 1) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (appState !== 'active' || !state.email) return;
    void refresh({ prefs, reason: 'foreground', attempt: attempt + 1 });
  }, SILENT_RETRY_MS);
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
  if (state.users.length) return;
  applyUsers(sortNearbyByLane(cached), { loading: false, freshEmpty: false }, false);
}

function shouldSkip(reason: RefreshReason, prefs: NearbyPrefs) {
  if (reason === 'pull' || reason === 'prefs' || reason === 'sync') return false;
  if (inFlight) return true;
  const key = prefsKeyOf(prefs);
  if (state.prefsKey && state.prefsKey !== key) return false;
  if (!lastOkAt) return false;
  const wait =
    reason === 'foreground'
      ? FOREGROUND_COOLDOWN_MS
      : reason === 'focus'
        ? FOCUS_STALE_MS
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
  // New filters (or a pull) supersede any request still running with old ones.
  const supersede = reason === 'pull' || reason === 'prefs' || reason === 'sync';
  if (inFlight && !supersede) return;

  if (supersede && inFlight) {
    gen += 1;
    inFlight = false;
  }

  const myGen = ++gen;
  inFlight = true;
  if (reason === 'prefs') {
    // Rows from the old filters must not linger while the new ones load.
    setState({ users: [], hasMore: true, loading: true, loadingMore: false, refreshing: false, hint: null, freshEmpty: false, prefsKey: key });
  }
  const hadRows = state.users.length > 0;
  if (reason === 'pull') setState({ refreshing: true, hint: hadRows ? state.hint : null });
  else if (!hadRows) setState({ loading: true, hint: null });

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
    lastOkAt = Date.now();
    if (reason === 'foreground') lastForegroundAt = lastOkAt;
    if (!users.length) {
      if (state.email) setNearbyFeedCache(state.email, []);
      setState({
        users: [],
        hasMore: false,
        hint: null,
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
  if (hadRows && !userAsked) {
    // Automatic refresh: the list on screen stays as-is, no banner.
    setState({ loading: false, refreshing: false });
    scheduleSilentRetry(prefs, attempt);
    return;
  }
  setState({
    hint: NEARBY_REFRESH_HINT,
    loading: false,
    refreshing: false,
  });
}

export async function loadMore(prefs: NearbyPrefs) {
  if (inFlight || state.loadingMore || state.loading || !state.hasMore) return;
  if (!state.users.length) return;
  lastPrefs = prefs;
  const myGen = gen;
  inFlight = true;
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
    if (awayMs < MIN_BACKGROUND_MS) return;
    if (now - lastForegroundAt < FOREGROUND_COOLDOWN_MS) return;
    lastForegroundAt = now;
    void refresh({ prefs: lastPrefs, reason: 'foreground' });
  });
}

/** Discover tab regained focus — reload quietly only if the list is stale. */
export function refreshIfStale(prefs: NearbyPrefs) {
  if (appState !== 'active') return;
  void refresh({ prefs, reason: 'focus' });
}

export { NEARBY_REFRESH_HINT };
