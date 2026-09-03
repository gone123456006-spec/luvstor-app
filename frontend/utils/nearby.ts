import * as Location from 'expo-location';
import { apiRequest, getApiBase } from './api';
import { resolveShowMe } from './showMe';
import { isLiveSubscriptionBadge } from './subscriptions';

/**
 * Profiles per discovery batch. The backend runs its 7-day fresh rotation over
 * one batch at a time, so the same size is used for the first load and for
 * every appended page.
 */
export const NEARBY_BATCH_SIZE = 25;
/** Append page size for infinite scroll */
export const NEARBY_PAGE_SIZE = NEARBY_BATCH_SIZE;
/**
 * Cap on the ids sent back as "already shown this session". Mirrors the server
 * limit and keeps the request URL under the HTTP header size limit on very long
 * scroll sessions. The most recent ids are the ones that matter, so keep those.
 */
export const NEARBY_MAX_EXCLUDE = 300;

export interface NearbyUser {
  id: string;
  publicId?: string;
  name: string;
  age: number;
  bio: string;
  photo: string;
  photos?: string[];
  gender: string;
  interests: string[];
  height?: number | null;
  relationshipGoal?: string;
  isOnline: boolean;
  lastSeen?: Date;
  distance?: number;
  distanceKm?: string;
  friendshipStatus?: string;
  areFriends?: boolean;
  iLiked?: boolean;
  theyLiked?: boolean;
  source?: 'nearby' | 'random' | 'for_you';
  subscriptionBadge?: string | null;
  subscriptionExpiresAt?: string | null;
  photoVerified?: boolean;
  matchScore?: number;
  matchReasons?: string[];
}

function resolvePhotoUrl(photo: string): string {
  if (!photo) return '';
  if (photo.startsWith('http') || photo.startsWith('data:')) return photo;
  return `${getApiBase()}${photo}`;
}

function formatDistanceKm(u: any): string | undefined {
  const rawKm = u?.distanceKm;
  if (rawKm != null && String(rawKm).trim() !== '' && String(rawKm).trim() !== '?') {
    const cleaned = String(rawKm).replace(/\s*km$/i, '').trim();
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n.toFixed(1);
  }
  const metres = Number(u?.distance);
  if (Number.isFinite(metres) && metres >= 0) {
    return (metres / 1000).toFixed(1);
  }
  return undefined;
}

export function mapNearbyUser(u: any): NearbyUser {
  const rawBadge = u.subscriptionBadge || u.subscription?.badge || null;
  const rawExpiresAt =
    u.subscriptionExpiresAt || u.subscription?.expiresAt || null;
  const live = isLiveSubscriptionBadge(rawBadge, rawExpiresAt);

  return {
    id: String(u.id || u._id),
    publicId: u.publicId || '',
    name: u.name || 'Unknown',
    age: u.age || 0,
    bio: u.bio || '',
    photo: resolvePhotoUrl(u.photo || ''),
    photos: Array.isArray(u.photos)
      ? u.photos.map((p: string) => resolvePhotoUrl(p)).filter(Boolean)
      : [],
    gender: u.gender || '',
    interests: u.interests || [],
    height: u.height ?? null,
    relationshipGoal: u.relationshipGoal || '',
    isOnline: !!u.isOnline,
    distance:
      u.distance != null && Number.isFinite(Number(u.distance))
        ? Number(u.distance)
        : undefined,
    distanceKm: formatDistanceKm(u),
    friendshipStatus: u.friendshipStatus || 'stranger',
    areFriends: !!u.areFriends,
    iLiked: !!u.iLiked,
    theyLiked: !!u.theyLiked,
    source: u.source === 'for_you' ? 'for_you' : u.source === 'random' ? 'random' : 'nearby',
    subscriptionBadge: live ? rawBadge : null,
    subscriptionExpiresAt: live ? rawExpiresAt : null,
    photoVerified: !!u.photoVerified,
    matchScore: Number(u.matchScore) || undefined,
    matchReasons: Array.isArray(u.matchReasons) ? u.matchReasons : undefined,
  };
}

function normalizeNearbyResponse(data: any): {
  users: NearbyUser[];
  hasMore: boolean;
} {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.users)
      ? data.users
      : [];
  const users = list.map(mapNearbyUser);
  const hasMore =
    typeof data?.hasMore === 'boolean' ? data.hasMore : users.length > 0;
  return { users, hasMore };
}

/** Upload GPS once — call before fetching nearby list. */
export async function uploadMyLocation(token: string): Promise<{ error?: string }> {
  try {
    const services = await Location.hasServicesEnabledAsync();
    if (!services) {
      return {
        error: 'Turn on Location / GPS on your phone, then tap Retry.',
      };
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return {
        error: 'Location permission denied. Enable it in Settings, then tap Retry.',
      };
    }

    let latitude: number | null = null;
    let longitude: number | null = null;

    // Prefer a fresh fix; fall back to last-known if GPS is slow.
    try {
      const position = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Location timeout')), 12000),
        ),
      ]);
      latitude = position.coords.latitude;
      longitude = position.coords.longitude;
    } catch {
      const last = await Location.getLastKnownPositionAsync({
        maxAge: 1000 * 60 * 30,
        requiredAccuracy: 1000,
      });
      if (last) {
        latitude = last.coords.latitude;
        longitude = last.coords.longitude;
      }
    }

    if (
      latitude == null ||
      longitude == null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      (latitude === 0 && longitude === 0)
    ) {
      return {
        error: 'Could not read your GPS. Move outdoors, enable Location, then tap Retry.',
      };
    }

    await apiRequest('/api/users/location', token, {
      method: 'PUT',
      body: JSON.stringify({ latitude, longitude }),
    });

    return {};
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (/permission|denied/i.test(msg)) {
      return {
        error: 'Location permission denied. Enable it in Settings, then tap Retry.',
      };
    }
    return { error: msg || 'Could not update location.' };
  }
}

export type SavedDiscoveryPrefs = {
  gender: string;
  radiusKm: number | null;
  activeWithinMinutes: number;
};

/**
 * The Discover filters the server last saw this user browsing with.
 *
 * The backend records them on every Discover request, so filters survive an app
 * restart or a reinstall without the app having to store anything itself.
 * Returns null whenever they cannot be read — callers just keep their defaults.
 */
export async function fetchSavedDiscoveryPrefs(
  token: string,
): Promise<SavedDiscoveryPrefs | null> {
  try {
    const me = await apiRequest('/api/users/me', token);
    const saved = me?.discoveryPrefs;
    if (!saved && !me?.gender && !me?.showMe) return null;
    const radiusKm = Number(saved?.radiusKm);
    return {
      gender: resolveShowMe(
        String(me?.gender || ''),
        String(me?.showMe || ''),
        String(saved?.gender || ''),
      ),
      radiusKm: Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : null,
      activeWithinMinutes: Number(saved?.activeWithinMinutes) || 0,
    };
  } catch {
    return null;
  }
}

export type NearbyFetchOptions = {
  radiusKm?: number;
  gender?: string;
  activeWithinMinutes?: number;
  /** 'initial' = first batch of a session; 'more' = append page */
  mode?: 'initial' | 'more';
  limit?: number;
  /** Already displayed user IDs — never returned again in this session */
  excludeIds?: string[];
  /**
   * Set false for screens that only read the feed (they must not mark profiles
   * as seen and burn the viewer's daily freshness).
   */
  trackImpressions?: boolean;
};

/** Fetch nearby feed (no GPS — location must be uploaded separately). */
export async function fetchNearbyUsersPage(
  token: string,
  options: NearbyFetchOptions = {},
): Promise<{ users: NearbyUser[]; hasMore: boolean; error?: string }> {
  try {
    const radiusKm = options.radiusKm ?? 50;
    const gender = options.gender ?? 'all';
    const activeWithinMinutes = options.activeWithinMinutes ?? 0;
    const mode = options.mode ?? 'more';
    const radiusMetres = Math.round(radiusKm * 1000);

    const params = new URLSearchParams({
      radius: String(radiusMetres),
      mode,
      limit: String(options.limit ?? NEARBY_BATCH_SIZE),
    });

    if (options.trackImpressions === false) {
      params.set('track', '0');
    }

    if (gender) {
      params.set('gender', gender);
    }
    if (activeWithinMinutes > 0) {
      params.set('activeWithin', String(activeWithinMinutes));
    }
    if (options.excludeIds?.length) {
      params.set(
        'exclude',
        options.excludeIds.slice(-NEARBY_MAX_EXCLUDE).join(','),
      );
    }

    const data = await apiRequest(
      `/api/users/nearby?${params.toString()}`,
      token,
    );

    return normalizeNearbyResponse(data);
  } catch (err: any) {
    return {
      users: [],
      hasMore: false,
      error: err?.message || 'Failed to load nearby people.',
    };
  }
}

/** Upload GPS when possible, then fetch the feed (uses saved location if GPS fails). */
export async function loadNearbyFeed(
  token: string,
  options: NearbyFetchOptions = {},
): Promise<{
  users: NearbyUser[];
  hasMore: boolean;
  error?: string;
  locationWarning?: string;
}> {
  const loc = await uploadMyLocation(token);
  const feed = await fetchNearbyUsersPage(token, options);

  if (feed.error) {
    const needsLocation = /location/i.test(feed.error);
    return {
      users: feed.users,
      hasMore: feed.hasMore,
      error: needsLocation ? loc.error || feed.error : feed.error,
    };
  }

  return {
    users: feed.users,
    hasMore: feed.hasMore,
    locationWarning: loc.error,
  };
}

export async function fetchNearbyUsers(
  token: string,
  radiusKm: number = 50,
  gender: string = 'all',
  activeWithinMinutes: number = 0,
): Promise<{ users: NearbyUser[]; hasMore: boolean; error?: string }> {
  try {
    return loadNearbyFeed(token, {
      radiusKm,
      gender,
      activeWithinMinutes,
      mode: 'initial',
    });
  } catch (err: any) {
    return {
      users: [],
      hasMore: false,
      error: err?.message || 'Failed to load nearby people.',
    };
  }
}

/**
 * Search for a user by their public ID (ABCD1234 format)
 */
export async function searchUserByPublicId(
  token: string,
  publicId: string,
): Promise<{ user: NearbyUser | null; error: string | null }> {
  try {
    const cleanId = publicId.toUpperCase().trim();

    if (!/^[A-Z]{4}[0-9]{4}$/.test(cleanId)) {
      return {
        user: null,
        error: 'Invalid ID format. Expected: ABCD1234',
      };
    }

    const data: any = await apiRequest(
      `/api/users/search-by-id?publicId=${cleanId}`,
      token,
    );

    if (!data || data.error) {
      return { user: null, error: data?.error || 'User not found' };
    }

    return { user: mapNearbyUser(data), error: null };
  } catch (err: any) {
    return {
      user: null,
      error: err?.message || 'Search failed',
    };
  }
}

/**
 * Fetch another user's public profile (includes background photos gallery)
 */
export async function fetchUserProfile(
  token: string,
  userId: string,
): Promise<{ user: NearbyUser | null; error: string | null }> {
  try {
    const data: any = await apiRequest(`/api/users/profile/${userId}`, token);

    if (!data || data.error) {
      return { user: null, error: data?.error || 'User not found' };
    }

    const user: NearbyUser = {
      ...mapNearbyUser({ ...data, id: data.id || data._id || userId }),
      lastSeen: data.lastSeen,
    };

    return { user, error: null };
  } catch (err: any) {
    return {
      user: null,
      error: err?.message || 'Failed to load profile',
    };
  }
}
