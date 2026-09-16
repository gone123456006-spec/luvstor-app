/**
 * Online Nearby Pulse Service
 * 
 * Returns 5-8 online users within ~5-10km for the "right now" strip.
 * Production-level with fast queries and presence integration.
 */

const User = require('../models/User');
const Friendship = require('../models/Friendship');
const { hasRealLocation, distanceMetres, getBlockedUserIds, getFriendshipMap } = require('../services/discovery');
const { serializeSubscription } = require('../services/subscriptions');

const CONFIG = {
  PULSE_RADIUS_KM: 10,
  TARGET_COUNT: 8,
  MAX_RESULTS: 12, // Fetch extra, filter blocked, return top 8
  ONLINE_THRESHOLD_MIN: 5, // Must be online/active within 5 minutes
};

/**
 * Get online nearby users for the pulse strip.
 * Fast query focused on online + close proximity only.
 */
async function getOnlineNearbyPulse(viewerId, options = {}) {
  try {
    const viewer = await User.findById(viewerId)
      .select('location discoveryPrefs')
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
    
    // Online threshold
    const recentlyActive = new Date(
      Date.now() - CONFIG.ONLINE_THRESHOLD_MIN * 60 * 1000
    );
    
    // Gender filter from viewer prefs
    const genderFilter = viewer.discoveryPrefs?.gender;
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
      $or: [
        { isOnline: true },
        { lastSeen: { $gte: recentlyActive } },
      ],
    };
    
    if (genderFilter && genderFilter !== 'All') {
      filter.gender = genderFilter;
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
    
    // Map to response format
    const users = candidates.slice(0, CONFIG.TARGET_COUNT).map(doc => {
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
        isOnline: !!doc.isOnline,
        lastSeen: doc.lastSeen,
        distanceKm: km < 1 ? '1' : km > 100 ? '100' : km.toFixed(1),
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

module.exports = {
  CONFIG,
  getOnlineNearbyPulse,
};
