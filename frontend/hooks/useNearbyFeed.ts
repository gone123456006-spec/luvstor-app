import { useEffect, useSyncExternalStore } from 'react';
import {
  bindAccount,
  ensureAppStateBound,
  getSnapshot,
  hydrateAccount,
  subscribe,
  type NearbyFeedSnapshot,
} from '../utils/nearbyStore';

/** Discover Nearby list — data lives in nearbyStore, not the screen. */
export function useNearbyFeed(email?: string | null): NearbyFeedSnapshot {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    ensureAppStateBound();
    bindAccount(email);
    if (email) void hydrateAccount(email);
  }, [email]);

  return snap;
}
