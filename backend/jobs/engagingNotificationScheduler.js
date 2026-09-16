/**
 * Engaging Notification Scheduler
 * 
 * Intelligently schedules and sends WhatsApp & dating app style notifications
 * based on user context, activity patterns, and optimal timing.
 * 
 * Features:
 * - Real-time nearby user detection
 * - Activity-based notifications (active now, popular)
 * - Engagement notifications (streaks, conversation starters)
 * - Smart timing (sends when user is most likely to engage)
 * - Rate limiting (never overwhelming)
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const Message = require('../models/Message');
const ProfileView = require('../models/ProfileView');
const NotificationHistory = require('../models/NotificationHistory');
const {
  sendNearbyNotification,
  sendActiveNowNotification,
  sendPopularNearbyNotification,
  sendConversationStarterNotification,
  sendStreakNotification,
  sendComeBackNotification,
  sendProfileBoostNotification,
  sendMutualInterestNotification,
  calculateDistance,
  CONFIG,
} = require('../services/engagingNotifications');
const { hasRealLocation } = require('../services/discovery');

const ENABLED = process.env.ENGAGING_NOTIFS_ENABLED !== 'false';

/**
 * Process nearby users and send notifications
 */
async function processNearbyNotifications(io) {
  if (!ENABLED) return { processed: 0, sent: 0 };

  const stats = { processed: 0, sent: 0 };

  try {
    // Get active users with location
    const activeUsers = await User.find({
      isDeactivated: { $ne: true },
      'location.coordinates': { $exists: true },
      lastSeen: { $gte: new Date(Date.now() - 30 * 60 * 1000) }, // Active in last 30 min
      'notificationPrefs.promotions': { $ne: false },
    })
      .select('_id location gender showMe interests lastSeen')
      .limit(500)
      .lean();

    stats.processed = activeUsers.length;

    // For each user, find nearby users who just came online
    for (const user of activeUsers) {
      if (!hasRealLocation(user.location?.coordinates)) continue;

      // Check daily limit
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayCount = await NotificationHistory.countDocuments({
        userId: user._id,
        type: 'suggestion',
        'data.code': 'NEARBY_USER',
        createdAt: { $gte: todayStart },
      });

      if (todayCount >= CONFIG.MAX_NEARBY_NOTIFS_PER_DAY) continue;

      // Find nearby users who became active in last 10 minutes
      const nearby = await User.find({
        _id: { $ne: user._id },
        isDeactivated: { $ne: true },
        lastSeen: {
          $gte: new Date(Date.now() - 10 * 60 * 1000),
          $lt: new Date(Date.now() - 2 * 60 * 1000),
        },
        location: {
          $nearSphere: {
            $geometry: {
              type: 'Point',
              coordinates: user.location.coordinates,
            },
            $maxDistance: CONFIG.NEARBY_RADIUS_KM * 1000,
          },
        },
      })
        .select('_id name photo bio interests location gender')
        .limit(5)
        .lean();

      if (nearby.length === 0) continue;

      // Send notification for best match
      const bestMatch = nearby[0];
      const commonInterests = user.interests?.filter(i =>
        bestMatch.interests?.includes(i)
      );

      const result = await sendNearbyNotification(io, user._id, bestMatch._id, {
        commonInterests,
      });

      if (result) stats.sent++;
    }

    return stats;
  } catch (error) {
    console.error('processNearbyNotifications error:', error);
    return stats;
  }
}

/**
 * Process "Active now" notifications for viewed profiles
 */
async function processActiveNowNotifications(io) {
  if (!ENABLED) return { processed: 0, sent: 0 };

  const stats = { processed: 0, sent: 0 };

  try {
    // Get recent profile views (last 7 days)
    const recentViews = await ProfileView.find({
      lastViewedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    })
      .select('viewerId profileOwnerId')
      .lean();

    const viewMap = new Map();
    for (const view of recentViews) {
      const viewerId = String(view.viewerId);
      if (!viewMap.has(viewerId)) viewMap.set(viewerId, []);
      viewMap.get(viewerId).push(String(view.profileOwnerId));
    }

    // Get users who just came online
    const justActive = await User.find({
      lastSeen: {
        $gte: new Date(Date.now() - CONFIG.ACTIVE_NOW_THRESHOLD_MIN * 60 * 1000),
        $lt: new Date(Date.now() - 1 * 60 * 1000),
      },
      isDeactivated: { $ne: true },
    })
      .select('_id')
      .lean();

    const activeIds = new Set(justActive.map(u => String(u._id)));

    // Send notifications to viewers
    for (const [viewerId, viewedIds] of viewMap.entries()) {
      stats.processed++;

      // Check if any viewed profiles just came online
      const justActiveViewed = viewedIds.filter(id => activeIds.has(id));
      if (justActiveViewed.length === 0) continue;

      // Check daily limit
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayCount = await NotificationHistory.countDocuments({
        userId: viewerId,
        type: 'suggestion',
        'data.code': 'ACTIVE_NOW',
        createdAt: { $gte: todayStart },
      });

      if (todayCount >= CONFIG.MAX_ACTIVITY_NOTIFS_PER_DAY) continue;

      // Send notification for first match
      const result = await sendActiveNowNotification(
        io,
        viewerId,
        justActiveViewed[0]
      );

      if (result) stats.sent++;
    }

    return stats;
  } catch (error) {
    console.error('processActiveNowNotifications error:', error);
    return stats;
  }
}

/**
 * Process "Popular nearby" notifications
 */
async function processPopularNearbyNotifications(io) {
  if (!ENABLED) return { processed: 0, sent: 0 };

  const stats = { processed: 0, sent: 0 };

  try {
    // Find trending profiles (high views/likes today)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const viewStats = await ProfileView.aggregate([
      {
        $match: {
          lastViewedAt: { $gte: todayStart },
        },
      },
      {
        $group: {
          _id: '$profileOwnerId',
          viewCount: { $sum: 1 },
          uniqueViewers: { $addToSet: '$viewerId' },
        },
      },
      {
        $match: {
          viewCount: { $gte: CONFIG.POPULAR_MIN_VIEWS },
        },
      },
      {
        $project: {
          profileId: '$_id',
          viewCount: 1,
          viewerCount: { $size: '$uniqueViewers' },
        },
      },
      {
        $sort: { viewCount: -1 },
      },
      {
        $limit: 20,
      },
    ]);

    if (viewStats.length === 0) return stats;

    // Get like counts for popular profiles
    const popularIds = viewStats.map(s => s.profileId);
    const likeStats = await Friendship.aggregate([
      {
        $match: {
          $or: [
            { userB: { $in: popularIds }, status: 'pending_like' },
          ],
          likedAt: { $gte: todayStart },
        },
      },
      {
        $group: {
          _id: '$userB',
          likeCount: { $sum: 1 },
        },
      },
    ]);

    const likeMap = new Map(
      likeStats.map(s => [String(s._id), s.likeCount])
    );

    // Send notifications to nearby users
    for (const popularStat of viewStats.slice(0, 5)) {
      const popularId = String(popularStat.profileId);
      const popularUser = await User.findById(popularId)
        .select('location')
        .lean();

      if (!popularUser || !hasRealLocation(popularUser.location?.coordinates)) {
        continue;
      }

      // Find nearby users
      const nearbyUsers = await User.find({
        _id: { $ne: popularId },
        isDeactivated: { $ne: true },
        lastSeen: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        location: {
          $nearSphere: {
            $geometry: {
              type: 'Point',
              coordinates: popularUser.location.coordinates,
            },
            $maxDistance: CONFIG.NEARBY_RADIUS_KM * 1000,
          },
        },
        'notificationPrefs.promotions': { $ne: false },
      })
        .select('_id')
        .limit(50)
        .lean();

      for (const user of nearbyUsers) {
        stats.processed++;

        // Check if already notified about this popular person
        const alreadyNotified = await NotificationHistory.exists({
          userId: user._id,
          type: 'suggestion',
          'data.code': 'POPULAR_NEARBY',
          actorId: popularId,
          createdAt: { $gte: todayStart },
        });

        if (alreadyNotified) continue;

        const result = await sendPopularNearbyNotification(io, user._id, popularId, {
          viewCount: popularStat.viewCount,
          likeCount: likeMap.get(popularId) || 0,
        });

        if (result) stats.sent++;
      }
    }

    return stats;
  } catch (error) {
    console.error('processPopularNearbyNotifications error:', error);
    return stats;
  }
}

/**
 * Process conversation starter reminders
 */
async function processConversationStarters(io) {
  if (!ENABLED) return { processed: 0, sent: 0 };

  const stats = { processed: 0, sent: 0 };

  try {
    // Find recent matches without messages
    const recentMatches = await Friendship.find({
      status: 'friends',
      matchedAt: {
        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        $lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // But at least 24h old
      },
    })
      .select('userA userB matchedAt')
      .lean();

    for (const match of recentMatches) {
      stats.processed++;

      // Check if they have messages
      const hasMessages = await Message.exists({
        $or: [
          { senderId: match.userA, receiverId: match.userB },
          { senderId: match.userB, receiverId: match.userA },
        ],
      });

      if (hasMessages) continue;

      // Send to both users (they're matched but haven't talked)
      const hoursSinceMatch = (Date.now() - match.matchedAt) / (1000 * 60 * 60);

      // Send at specific intervals: 24h, 48h, 72h
      if (
        (hoursSinceMatch >= 24 && hoursSinceMatch < 26) ||
        (hoursSinceMatch >= 48 && hoursSinceMatch < 50) ||
        (hoursSinceMatch >= 72 && hoursSinceMatch < 74)
      ) {
        // Check if already sent today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        for (const userId of [match.userA, match.userB]) {
          const otherId = userId === match.userA ? match.userB : match.userA;

          const alreadySent = await NotificationHistory.exists({
            userId,
            type: 'suggestion',
            'data.code': 'CONVERSATION_STARTER',
            actorId: otherId,
            createdAt: { $gte: todayStart },
          });

          if (alreadySent) continue;

          const result = await sendConversationStarterNotification(
            io,
            userId,
            otherId
          );

          if (result) stats.sent++;
        }
      }
    }

    return stats;
  } catch (error) {
    console.error('processConversationStarters error:', error);
    return stats;
  }
}

/**
 * Process activity streak notifications
 */
async function processStreakNotifications(io) {
  if (!ENABLED) return { processed: 0, sent: 0 };

  const stats = { processed: 0, sent: 0 };

  try {
    // Get active users from today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const activeToday = await User.find({
      lastSeen: { $gte: todayStart },
      isDeactivated: { $ne: true },
    })
      .select('_id lastSeen')
      .lean();

    for (const user of activeToday) {
      stats.processed++;

      // Calculate streak
      const streak = await calculateStreak(user._id);

      if (streak < CONFIG.STREAK_MIN_DAYS) continue;

      // Send only on milestone days
      if (![3, 7, 14, 30].includes(streak) && streak % 7 !== 0) continue;

      // Check if already sent today
      const alreadySent = await NotificationHistory.exists({
        userId: user._id,
        type: 'system',
        'data.code': 'STREAK',
        'data.days': String(streak),
        createdAt: { $gte: todayStart },
      });

      if (alreadySent) continue;

      const result = await sendStreakNotification(io, user._id, streak);

      if (result) stats.sent++;
    }

    return stats;
  } catch (error) {
    console.error('processStreakNotifications error:', error);
    return stats;
  }
}

/**
 * Calculate user's current activity streak
 */
async function calculateStreak(userId) {
  try {
    const user = await User.findById(userId).select('lastSeen').lean();
    if (!user) return 0;

    let streak = 1; // Today counts
    let checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);
    checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000); // Yesterday

    // Check last 60 days
    for (let i = 0; i < 60; i++) {
      const nextDay = new Date(checkDate.getTime() + 24 * 60 * 60 * 1000);

      const wasActive = await User.exists({
        _id: userId,
        lastSeen: {
          $gte: checkDate,
          $lt: nextDay,
        },
      });

      if (!wasActive) break;

      streak++;
      checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000);
    }

    return streak;
  } catch {
    return 0;
  }
}

/**
 * Main scheduler function - run every 10 minutes
 */
async function runEngagingNotifications(io) {
  if (!ENABLED) {
    return {
      skipped: 'disabled',
      timestamp: new Date(),
    };
  }

  const startTime = Date.now();
  console.log('[EngagingNotifications] Starting run...');

  const results = {
    timestamp: new Date(),
    nearby: { processed: 0, sent: 0 },
    activeNow: { processed: 0, sent: 0 },
    popular: { processed: 0, sent: 0 },
    conversationStarters: { processed: 0, sent: 0 },
    streaks: { processed: 0, sent: 0 },
    duration: 0,
  };

  try {
    // Run all processors in parallel
    const [nearby, activeNow, popular, conversation, streaks] = await Promise.allSettled([
      processNearbyNotifications(io),
      processActiveNowNotifications(io),
      processPopularNearbyNotifications(io),
      processConversationStarters(io),
      processStreakNotifications(io),
    ]);

    if (nearby.status === 'fulfilled') results.nearby = nearby.value;
    if (activeNow.status === 'fulfilled') results.activeNow = activeNow.value;
    if (popular.status === 'fulfilled') results.popular = popular.value;
    if (conversation.status === 'fulfilled') results.conversationStarters = conversation.value;
    if (streaks.status === 'fulfilled') results.streaks = streaks.value;

    results.duration = Date.now() - startTime;

    const totalSent =
      results.nearby.sent +
      results.activeNow.sent +
      results.popular.sent +
      results.conversationStarters.sent +
      results.streaks.sent;

    console.log(
      `[EngagingNotifications] Completed in ${results.duration}ms. Sent ${totalSent} notifications.`
    );

    return results;
  } catch (error) {
    console.error('[EngagingNotifications] Run failed:', error);
    results.error = error.message;
    results.duration = Date.now() - startTime;
    return results;
  }
}

module.exports = {
  runEngagingNotifications,
  processNearbyNotifications,
  processActiveNowNotifications,
  processPopularNearbyNotifications,
  processConversationStarters,
  processStreakNotifications,
  ENABLED,
};
