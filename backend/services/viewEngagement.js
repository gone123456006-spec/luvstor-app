/**
 * View Engagement Service
 * 
 * Sends nudges after profile views to encourage likes/messages.
 * Production-level with rate limiting and smart timing.
 */

const User = require('../models/User');
const ProfileView = require('../models/ProfileView');
const Friendship = require('../models/Friendship');
const { createNotification } = require('./notifications');
const { hasRealLocation, distanceMetres } = require('./discovery');
const { notifyProfileViewed } = require('./profileViews');

const CONFIG = {
  // Timing
  NUDGE_DELAY_MS: 30 * 1000, // 30 seconds after view
  
  // Rate limiting
  MAX_NUDGES_PER_DAY: 2,
  MAX_NUDGES_PER_USER_PER_WEEK: 1, // Don't spam about same person
  
  // Distance threshold for "before they leave" messaging
  NEARBY_THRESHOLD_KM: 10,
};

/**
 * Track a profile view and potentially schedule a nudge.
 * Called when user opens a profile card.
 */
async function trackProfileView(viewerId, targetId, context = {}, io = null) {
  try {
    if (String(viewerId) === String(targetId)) return;
    
    // Update or create view record
    await ProfileView.findOneAndUpdate(
      { viewerId, targetId },
      {
        $set: { lastViewedAt: new Date() },
        $setOnInsert: { firstViewedAt: new Date() },
        $inc: { viewCount: 1 },
      },
      { upsert: true }
    );

    // Notify the profile owner (deduped once per day)
    if (io) {
      void notifyProfileViewed(io, viewerId, targetId);
    }
    
    // Don't nudge if they already liked/matched
    const friendship = await Friendship.findOne({
      $or: [
        { userA: viewerId, userB: targetId },
        { userA: targetId, userB: viewerId },
      ],
    }).select('status initiatedBy').lean();
    
    const alreadyLiked = friendship && (
      friendship.status === 'friends' ||
      friendship.status === 'mutual_match' ||
      (friendship.status === 'pending_like' && String(friendship.initiatedBy) === String(viewerId))
    );
    
    if (alreadyLiked) return;
    
    // Schedule delayed nudge (client-side timeout will trigger the actual send)
    return {
      shouldScheduleNudge: true,
      delayMs: CONFIG.NUDGE_DELAY_MS,
      targetId: String(targetId),
    };
  } catch (err) {
    console.error('trackProfileView error:', err);
    return null;
  }
}

/**
 * Send engagement nudge after view (called by client after delay).
 * Rate-limited to avoid spam.
 */
async function sendViewEngagementNudge(io, viewerId, targetId) {
  try {
    // Check if already liked/matched (race condition guard)
    const friendship = await Friendship.findOne({
      $or: [
        { userA: viewerId, userB: targetId },
        { userA: targetId, userB: viewerId },
      ],
    }).select('status initiatedBy').lean();
    
    const alreadyLiked = friendship && (
      friendship.status === 'friends' ||
      friendship.status === 'mutual_match' ||
      (friendship.status === 'pending_like' && String(friendship.initiatedBy) === String(viewerId))
    );
    
    if (alreadyLiked) return null;
    
    // Rate limit check: max per day
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const todayCount = await User.countDocuments({
      _id: viewerId,
      'engagementNudges.sentAt': { $gte: startOfDay },
    });
    
    if (todayCount >= CONFIG.MAX_NUDGES_PER_DAY) {
      return null;
    }
    
    // Rate limit: max per user per week
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentNudgeForTarget = await User.findOne({
      _id: viewerId,
      'engagementNudges': {
        $elemMatch: {
          targetId,
          sentAt: { $gte: weekAgo },
        },
      },
    }).select('_id').lean();
    
    if (recentNudgeForTarget) {
      return null;
    }
    
    // Get target details
    const [viewer, target] = await Promise.all([
      User.findById(viewerId).select('location').lean(),
      User.findById(targetId).select('name photo location isOnline').lean(),
    ]);
    
    if (!viewer || !target) return null;
    
    // Calculate distance for messaging
    let isNearby = false;
    let distanceKm = null;
    
    if (hasRealLocation(viewer.location?.coordinates) && hasRealLocation(target.location?.coordinates)) {
      const metres = distanceMetres(
        viewer.location.coordinates[1],
        viewer.location.coordinates[0],
        target.location.coordinates[1],
        target.location.coordinates[0]
      );
      distanceKm = metres / 1000;
      isNearby = distanceKm <= CONFIG.NEARBY_THRESHOLD_KM;
    }
    
    // Craft message
    let title = `Like ${target.name || 'them'}?`;
    let body = '';
    
    if (isNearby) {
      body = `They're nearby (${Math.round(distanceKm)}km) — like before they leave the area`;
    } else if (target.isOnline) {
      body = `They're online now — great time to connect`;
    } else {
      body = `Send a like to start a conversation`;
    }
    
    // Send notification
    await createNotification(io, viewerId, {
      type: 'view_engagement',
      title,
      body,
      data: {
        userId: String(targetId),
        name: target.name,
        photo: target.photo,
        action: 'like',
      },
    });
    
    // Record nudge
    await User.updateOne(
      { _id: viewerId },
      {
        $push: {
          engagementNudges: {
            $each: [{ targetId, sentAt: new Date() }],
            $slice: -50, // Keep last 50
          },
        },
      }
    );
    
    return { sent: true, targetId: String(targetId) };
  } catch (err) {
    console.error('sendViewEngagementNudge error:', err);
    return null;
  }
}

/**
 * Get engagement stats for monitoring
 */
async function getEngagementStats(viewerId) {
  try {
    const user = await User.findById(viewerId)
      .select('engagementNudges')
      .lean();
    
    if (!user) return null;
    
    const nudges = user.engagementNudges || [];
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    
    return {
      today: nudges.filter(n => new Date(n.sentAt).getTime() >= dayAgo).length,
      thisWeek: nudges.filter(n => new Date(n.sentAt).getTime() >= weekAgo).length,
      total: nudges.length,
    };
  } catch (err) {
    console.error('getEngagementStats error:', err);
    return null;
  }
}

module.exports = {
  CONFIG,
  trackProfileView,
  sendViewEngagementNudge,
  getEngagementStats,
};
