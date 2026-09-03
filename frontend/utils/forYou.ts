import { apiRequest } from './api';
import {
  mapNearbyUser,
  NearbyUser,
  NEARBY_BATCH_SIZE,
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
