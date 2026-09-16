import { apiRequest } from './api';
import {
  mapNearbyUser,
  NearbyUser,
  NEARBY_BATCH_SIZE,
  uploadMyLocation,
} from './nearby';

export type ForYouUser = NearbyUser & {
  photoVerified?: boolean;
  matchScore?: number;
  matchReasons?: string[];
};

function mapForYouUser(u: any): ForYouUser {
  const base = mapNearbyUser({ ...u, source: u.source || 'for_you' });
  return {
    ...base,
    photoVerified: !!u.photoVerified,
    matchScore: Number(u.matchScore) || 0,
    matchReasons: Array.isArray(u.matchReasons) ? u.matchReasons : [],
  };
}

/**
 * Page-based For You fetch. Do NOT mix excludeIds with page>1 —
 * server caches a ranked list and pages from it (Redis when available).
 */
export async function fetchForYouPage(
  token: string,
  opts: { page?: number; count?: number; forceRefresh?: boolean } = {},
): Promise<{ users: ForYouUser[]; hasMore: boolean; cacheHit?: boolean }> {
  const page = opts.page ?? 1;
  const count = opts.count ?? NEARBY_BATCH_SIZE;
  const params = new URLSearchParams({
    page: String(page),
    count: String(count),
  });
  if (opts.forceRefresh) params.set('forceRefresh', '1');

  const data = await apiRequest(`/api/recommendations/for-you?${params}`, token);
  const users = Array.isArray(data?.users) ? data.users.map(mapForYouUser) : [];
  return {
    users,
    hasMore: !!data?.hasMore,
    cacheHit: !!data?.cacheHit,
  };
}

/**
 * WhatsApp-style For You load.
 * refreshFast: paint from ranked cache immediately; GPS updates in parallel.
 * Does not wait for a full forceRefresh rebuild.
 */
export async function loadForYouFeed(
  token: string,
  options: {
    page?: number;
    count?: number;
    forceRefresh?: boolean;
    refreshFast?: boolean;
  } = {},
): Promise<{ users: ForYouUser[]; hasMore: boolean; cacheHit?: boolean }> {
  const { refreshFast, forceRefresh, page = 1, count } = options;

  if (refreshFast) {
    const locPromise = uploadMyLocation(token, {
      preferCached: true,
      timeoutMs: 3500,
    });

    try {
      // Cache-backed page — no ranked rebuild wait
      const feed = await fetchForYouPage(token, {
        page,
        count,
        forceRefresh: false,
      });
      void locPromise;
      return feed;
    } catch (err: any) {
      if (
        err?.code === 'LOCATION_REQUIRED' ||
        /location/i.test(err?.message || '')
      ) {
        await locPromise;
        return fetchForYouPage(token, {
          page,
          count,
          forceRefresh: false,
        });
      }
      throw err;
    }
  }

  return fetchForYouPage(token, { page, count, forceRefresh: !!forceRefresh });
}
