/**
 * Online Nearby Pulse Service
 * 
 * Returns 5-8 online users within ~5-10km for the "right now" strip.
 * Production-level with fast queries and presence integration.
 */

const User = require('../models/User');
const Friendship = require('../models/Friendship');
const { hasRealLocation, distanceMetres, getBlockedUserIds, getFriendshipMap, buildEligibilityFilter } = require('../services/discovery');
const { resolveShowMe, toGenderFilter } = require('../utils/showMe');
const { serializeSubscription } = require('../services/subscriptions');

const CONFIG = {
  PULSE_RADIUS_KM: 10,
  TARGET_COUNT: 40,
  MAX_RESULTS: 48,
  ONLINE_THRESHOLD_MIN: 5,
};

/**
 * Get online nearby users for the pulse strip.
 * Fast query focused on online + close proximity only.
 */
async function getOnlineNearbyPulse(viewerId, options = {}) {
  try {
    const viewer = await User.findById(viewerId)
      .select('location gender showMe discoveryPrefs')
      .lean();
    
    if (!viewer || !hasRealLocation(viewer.location?.coordinates)) {
      return {
        users: [],
        error: 'Location required',
      };
    }
    
    const [lng, lat] = viewer.location.coordinates;
    const radiusMetres = (options.radiusKm || CONFIG.PULSE_RADIUS_KM) * 1000;
    const limit = options.limit || CONFIG.MAX_RESULTS;
    
    // Get blocked users
    const blockedIds = await getBlockedUserIds(viewerId);
    const excludeIds = [viewerId, ...blockedIds];
    
    // Online threshold — only people with a fresh foreground presence ping
    const { STALE_MS } = require('../utils/onlineStatus');
    const onlineFresh = new Date(Date.now() - STALE_MS);
    
    const genderFilter = toGenderFilter(resolveShowMe(viewer));
    const filter = {
      _id: { $nin: excludeIds.map(id => id) },
      isDeactivated: { $ne: true },
      deletionScheduledAt: null,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: radiusMetres,
        },
      },
      // Do NOT use bare lastSeen — that showed recently logged-in offline users
      isOnline: true,
      lastSeen: { $gte: onlineFresh },
    };
    
    if (genderFilter !== 'all') {
      filter.gender = buildEligibilityFilter({ excludeOids: [], genderFilter }).gender;
    }
    
    // Fast query: only fetch what we need
    const candidates = await User.find(filter)
      .select('publicId name age photo gender location isOnline lastSeen subscriptionPlan subscriptionExpiresAt photoVerification')
      .limit(limit)
      .lean();
    
    if (candidates.length === 0) {
      return { users: [], count: 0 };
    }
    
    // Get friendships in one query
    const friendships = await getFriendshipMap(
      viewerId,
      candidates.map(c => String(c._id))
    );
    
    const now = new Date();
    
    const { resolveOnlineMap } = require('../utils/onlineStatus');
    const onlineMap = await resolveOnlineMap(candidates);

    // Map to response format — drop anyone whose live presence is offline
    const users = candidates
      .filter((doc) => onlineMap.get(String(doc._id)) === true)
      .slice(0, CONFIG.TARGET_COUNT)
      .map((doc) => {
      const id = String(doc._id);
      const friendship = friendships.get(id) || null;
      const areFriends = friendship?.status === 'friends';
      const initiatedBy = friendship ? String(friendship.initiatedBy) : null;
      
      const iLiked =
        areFriends ||
        friendship?.status === 'mutual_match' ||
        (friendship?.status === 'pending_like' && initiatedBy === String(viewerId));
      const theyLiked =
        areFriends ||
        friendship?.status === 'mutual_match' ||
        (friendship?.status === 'pending_like' && initiatedBy === id);
      
      const metres = distanceMetres(lat, lng, doc.location.coordinates[1], doc.location.coordinates[0]);
      const km = metres / 1000;
      
      const sub = serializeSubscription(doc, now);
      
      return {
        id,
        publicId: doc.publicId || '',
        name: doc.name,
        age: doc.age,
        photo: doc.photo,
        gender: doc.gender,
        isOnline: true,
        lastSeen: doc.lastSeen,
        distanceKm:
          !Number.isFinite(km) || km < 0 || km > 100
            ? null
            : km < 1
              ? (Math.round(km * 10) / 10 < 0.1 ? '0.1' : (Math.round(km * 10) / 10).toFixed(1))
              : Math.abs(km - Math.round(km)) < 0.05
                ? String(Math.round(km))
                : km.toFixed(1),
        friendshipStatus: friendship?.status || 'stranger',
        areFriends: !!areFriends,
        iLiked: !!iLiked,
        theyLiked: !!theyLiked,
        subscriptionBadge: sub.badge,
        subscriptionExpiresAt: sub.expiresAt,
        photoVerified: doc.photoVerification?.status === 'approved',
      };
    });
    
    return {
      users,
      count: users.length,
      refreshedAt: now.toISOString(),
    };
  } catch (err) {
    console.error('getOnlineNearbyPulse error:', err);
    return {
      users: [],
      error: 'Server error',
    };
  }
}

/**
 * Strip is polled by every open Home screen; 20 s per viewer keeps it "live"
 * while collapsing the $near + presence work. Likes / blocks bump the social
 * version so the strip never shows a stale Like / blocked user.
 */
const PULSE_TTL_SEC = Math.max(0, Number(process.env.ONLINE_NEARBY_TTL_SEC ?? 20));

async function getOnlineNearbyPulseCached(viewerId, options = {}) {
  if (!PULSE_TTL_SEC) return getOnlineNearbyPulse(viewerId, options);
  const cache = require('../utils/cache');
  const v = await cache.version('social', viewerId);
  const key = `pulse:${viewerId}:${v}:${options.radiusKm || ''}:${options.limit || ''}`;
  const cached = await cache.get(key);
  if (cached !== undefined) return cached;
  const result = await getOnlineNearbyPulse(viewerId, options);
  if (!result.error) await cache.set(key, result, PULSE_TTL_SEC);
  return result;
}

module.exports = {
  CONFIG,
  getOnlineNearbyPulse,
  getOnlineNearbyPulseCached,
};
