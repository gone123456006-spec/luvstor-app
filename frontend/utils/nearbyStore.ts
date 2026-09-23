import { AppState, type AppStateStatus } from 'react-native';
import { getAuthToken } from './auth';
import { normalizeEmail } from './normalizeEmail';
import {
  fetchNearbyUsersPage,
  loadNearbyFeed,
  NEARBY_PAGE_SIZE,
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

type RefreshReason = 'start' | 'pull' | 'foreground' | 'prefs';

const REFRESH_COOLDOWN_MS = 12_000;
const FOREGROUND_COOLDOWN_MS = 15_000;
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
  const cached = getNearbyFeedCache(next);
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
  applyUsers(cached, { loading: false, freshEmpty: false }, false);
}

function shouldSkip(reason: RefreshReason, prefs: NearbyPrefs) {
  if (reason === 'pull' || reason === 'prefs') return false;
  if (inFlight) return true;
  const key = prefsKeyOf(prefs);
  if (state.prefsKey && state.prefsKey !== key) return false;
  if (!lastOkAt) return false;
  const wait = reason === 'foreground' ? FOREGROUND_COOLDOWN_MS : REFRESH_COOLDOWN_MS;
  return Date.now() - lastOkAt < wait && state.users.length > 0;
}

export async function refresh(opts: {
  prefs: NearbyPrefs;
  reason?: RefreshReason;
}) {
  const prefs = opts.prefs;
  const reason = opts.reason || 'start';
  lastPrefs = prefs;
  const key = prefsKeyOf(prefs);

  if (shouldSkip(reason, prefs)) return;
  if (inFlight && reason !== 'pull') return;

  if (reason === 'pull' && inFlight) {
    gen += 1;
    inFlight = false;
  }

  const myGen = ++gen;
  inFlight = true;
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
      setState({
        hint: NEARBY_REFRESH_HINT,
        loading: false,
        refreshing: false,
      });
      return;
    }

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
    setState({
      hint: NEARBY_REFRESH_HINT,
      loading: false,
      refreshing: false,
    });
  } finally {
    if (myGen === gen) inFlight = false;
  }
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
    if (next !== 'active' || was === 'active') return;
    if (!state.email || !lastPrefs) return;
    const now = Date.now();
    if (now - lastForegroundAt < FOREGROUND_COOLDOWN_MS) return;
    if (now - lastOkAt < FOREGROUND_COOLDOWN_MS) return;
    lastForegroundAt = now;
    void refresh({ prefs: lastPrefs, reason: 'foreground' });
  });
}

export { NEARBY_REFRESH_HINT };
