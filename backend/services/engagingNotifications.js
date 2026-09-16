/**
 * Engaging Notifications Service
 * 
 * WhatsApp & Dating App style engaging notifications that are:
 * - Personalized and contextual
 * - Timely based on user activity
 * - Relevant and not overwhelming
 * - Action-oriented
 * 
 * This complements the existing notification system without replacing it.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const Message = require('../models/Message');
const ProfileView = require('../models/ProfileView');
const { createNotification } = require('./notifications');
const { hasRealLocation } = require('./discovery');
const recommendationService = require('./recommendations');

/**
 * Configuration
 */
const CONFIG = {
  // Nearby notifications
  NEARBY_RADIUS_KM: parseInt(process.env.NEARBY_NOTIF_RADIUS_KM) || 10,
  MIN_NEARBY_QUALITY_SCORE: parseInt(process.env.MIN_NEARBY_QUALITY) || 70,
  
  // Activity notifications
  ACTIVE_NOW_THRESHOLD_MIN: parseInt(process.env.ACTIVE_NOW_THRESHOLD) || 5,
  POPULAR_MIN_VIEWS: parseInt(process.env.POPULAR_MIN_VIEWS) || 20,
  
  // Engagement
  STREAK_MIN_DAYS: parseInt(process.env.STREAK_MIN_DAYS) || 3,
  INACTIVITY_REMINDER_HOURS: parseInt(process.env.INACTIVITY_REMINDER_HOURS) || 48,
  
  // Rate limiting
  MAX_NEARBY_NOTIFS_PER_DAY: parseInt(process.env.MAX_NEARBY_NOTIFS_DAY) || 3,
  MAX_ACTIVITY_NOTIFS_PER_DAY: parseInt(process.env.MAX_ACTIVITY_NOTIFS_DAY) || 5,
};

/**
 * Send "Someone nearby" notification
 * WhatsApp-style: Immediate, location-based, high relevance
 */
async function sendNearbyNotification(io, userId, candidateId, context = {}) {
  try {
    const [user, candidate] = await Promise.all([
      User.findById(userId).select('location notificationPrefs lastSeen').lean(),
      User.findById(candidateId)
        .select('publicId name age photo bio location lastSeen gender interests')
        .lean(),
    ]);

    if (!user || !candidate) return null;
    if (!hasRealLocation(user.location?.coordinates)) return null;

    // Calculate distance
    const distance = calculateDistance(
      user.location.coordinates,
      candidate.location.coordinates
    );

    // Get match score
    const score = await getMatchScore(userId, candidateId);

    // Personalized title based on context
    let title = '';
    let body = '';

    if (score >= 80) {
      title = `${candidate.name || 'Someone'} is nearby`;
      body = `${distance < 1 ? 'Less than 1km away' : `${Math.round(distance)}km away`} · ${score}% match`;
    } else if (candidate.interests?.some(i => context.commonInterests?.includes(i))) {
      const commonCount = candidate.interests.filter(i => 
        context.commonInterests?.includes(i)
      ).length;
      title = `Someone nearby shares ${commonCount} interests`;
      body = `${candidate.name || 'See profile'} · ${Math.round(distance)}km away`;
    } else {
      title = `New nearby: ${candidate.name || 'Someone'}`;
      body = `${Math.round(distance)}km away · Active now`;
    }

    return await createNotification(io, {
      userId,
      type: 'suggestion',
      title,
      body,
      actorId: candidateId,
      imageUrl: candidate.photo,
      deepLink: `/profile/${candidate.publicId || candidateId}`,
      groupKey: `nearby:${userId}`,
      priority: 'high',
      data: {
        code: 'NEARBY_USER',
        distance: String(Math.round(distance)),
        score: String(score),
        isOnline: true,
      },
    });
  } catch (error) {
    console.error('sendNearbyNotification error:', error);
    return null;
  }
}

/**
 * Send "Active now" notification for high-match users
 * Dating app style: Real-time engagement opportunity
 */
async function sendActiveNowNotification(io, userId, activeUserId) {
  try {
    const [user, activeUser] = await Promise.all([
      User.findById(userId).select('notificationPrefs').lean(),
      User.findById(activeUserId)
        .select('publicId name photo lastSeen bio')
        .lean(),
    ]);

    if (!user || !activeUser) return null;

    // Check if recently viewed this profile
    const recentView = await ProfileView.findOne({
      viewerId: userId,
      profileOwnerId: activeUserId,
      lastViewedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });

    const score = await getMatchScore(userId, activeUserId);

    let title = '';
    let body = '';

    if (recentView) {
      // They viewed this profile before
      title = `${activeUser.name || 'Someone you viewed'} is online now`;
      body = 'Say hi and start a conversation';
    } else if (score >= 80) {
      title = `${activeUser.name || 'Someone'} is online · ${score}% match`;
      body = 'Perfect time to connect';
    } else {
      title = `${activeUser.name || 'Someone'} just became active`;
      body = 'See their profile and like to connect';
    }

    return await createNotification(io, {
      userId,
      type: 'suggestion',
      title,
      body,
      actorId: activeUserId,
      imageUrl: activeUser.photo,
      deepLink: `/profile/${activeUser.publicId || activeUserId}`,
      groupKey: `active:${userId}`,
      priority: 'high',
      data: {
        code: 'ACTIVE_NOW',
        wasViewed: !!recentView,
        score: String(score),
      },
    });
  } catch (error) {
    console.error('sendActiveNowNotification error:', error);
    return null;
  }
}

/**
 * Send "Popular nearby" notification
 * Dating app style: FOMO-driven engagement
 */
async function sendPopularNearbyNotification(io, userId, popularUserId, stats = {}) {
  try {
    const popularUser = await User.findById(popularUserId)
      .select('publicId name photo age')
      .lean();

    if (!popularUser) return null;

    const { viewCount = 0, likeCount = 0 } = stats;

    const title = `${popularUser.name || 'Someone nearby'} is popular today`;
    const body = `${viewCount} profile views · ${likeCount} likes · See why`;

    return await createNotification(io, {
      userId,
      type: 'suggestion',
      title,
      body,
      actorId: popularUserId,
      imageUrl: popularUser.photo,
      deepLink: `/profile/${popularUser.publicId || popularUserId}`,
      groupKey: `popular:${userId}`,
      priority: 'normal',
      data: {
        code: 'POPULAR_NEARBY',
        viewCount: String(viewCount),
        likeCount: String(likeCount),
      },
    });
  } catch (error) {
    console.error('sendPopularNearbyNotification error:', error);
    return null;
  }
}

/**
 * Send conversation starter reminder
 * WhatsApp-style: Encouraging engagement with matches
 */
async function sendConversationStarterNotification(io, userId, matchedUserId) {
  try {
    const matchedUser = await User.findById(matchedUserId)
      .select('publicId name photo')
      .lean();

    if (!matchedUser) return null;

    // Check if conversation already started
    const hasMessages = await Message.exists({
      $or: [
        { senderId: userId, receiverId: matchedUserId },
        { senderId: matchedUserId, receiverId: userId },
      ],
    });

    if (hasMessages) return null;

    // Get match age
    const friendship = await Friendship.findOne({
      $or: [
        { userA: userId, userB: matchedUserId },
        { userA: matchedUserId, userB: userId },
      ],
      status: 'friends',
    });

    if (!friendship) return null;

    const hoursSinceMatch = (Date.now() - friendship.matchedAt) / (1000 * 60 * 60);

    let title = '';
    let body = '';

    if (hoursSinceMatch < 24) {
      title = `Say hi to ${matchedUser.name || 'your match'}`;
      body = 'Break the ice with a simple "Hey! How are you?"';
    } else if (hoursSinceMatch < 72) {
      title = `Start chatting with ${matchedUser.name || 'your match'}`;
      body = 'Matches that chat within 3 days are 5x more likely to meet';
    } else {
      title = `Don't let this match expire`;
      body = `Send a message to ${matchedUser.name || 'your match'} before it's too late`;
    }

    return await createNotification(io, {
      userId,
      type: 'suggestion',
      title,
      body,
      actorId: matchedUserId,
      imageUrl: matchedUser.photo,
      deepLink: `/messages/${matchedUserId}`,
      groupKey: `conversation-starter:${matchedUserId}`,
      priority: 'normal',
      data: {
        code: 'CONVERSATION_STARTER',
        hoursSinceMatch: String(Math.round(hoursSinceMatch)),
      },
    });
  } catch (error) {
    console.error('sendConversationStarterNotification error:', error);
    return null;
  }
}

/**
 * Send activity streak notification
 * Dating app style: Gamification to encourage daily usage
 */
async function sendStreakNotification(io, userId, streakDays) {
  try {
    if (streakDays < CONFIG.STREAK_MIN_DAYS) return null;

    let title = '';
    let body = '';
    let emoji = '';

    if (streakDays === 3) {
      emoji = '🔥';
      title = `${emoji} 3-day streak!`;
      body = 'Keep it going! Active users get 3x more matches';
    } else if (streakDays === 7) {
      emoji = '⭐';
      title = `${emoji} 7-day streak!`;
      body = "Amazing! You're in the top 10% of active users";
    } else if (streakDays === 14) {
      emoji = '🏆';
      title = `${emoji} 2-week streak!`;
      body = 'Incredible dedication! Unlock exclusive badge';
    } else if (streakDays === 30) {
      emoji = '👑';
      title = `${emoji} 30-day streak champion!`;
      body = "You're a legend! Enjoy premium features for 7 days";
    } else if (streakDays % 7 === 0) {
      emoji = '🔥';
      title = `${emoji} ${streakDays}-day streak!`;
      body = "You're on fire! Keep the momentum going";
    } else {
      return null;
    }

    return await createNotification(io, {
      userId,
      type: 'system',
      title,
      body,
      deepLink: '/(tabs)/profile',
      groupKey: 'streak',
      priority: 'normal',
      data: {
        code: 'STREAK',
        days: String(streakDays),
      },
    });
  } catch (error) {
    console.error('sendStreakNotification error:', error);
    return null;
  }
}

/**
 * Send "Come back" gentle reminder
 * WhatsApp-style: Respectful, not pushy
 */
async function sendComeBackNotification(io, userId, context = {}) {
  try {
    const user = await User.findById(userId)
      .select('name lastSeen notificationPrefs')
      .lean();

    if (!user) return null;

    const hoursSinceActive = (Date.now() - user.lastSeen) / (1000 * 60 * 60);
    if (hoursSinceActive < CONFIG.INACTIVITY_REMINDER_HOURS) return null;

    const { newLikes = 0, newMatches = 0, newMessages = 0, nearbyCount = 0 } = context;

    // Only send if there's something valuable waiting
    if (!newLikes && !newMatches && !newMessages && nearbyCount < 3) {
      return null;
    }

    let title = '';
    let body = '';

    if (newMessages > 0) {
      title = newMessages === 1 
        ? 'You have an unread message'
        : `You have ${newMessages} unread messages`;
      body = 'Open Luvstor to reply';
    } else if (newMatches > 0) {
      title = newMatches === 1
        ? 'You have a new match waiting'
        : `${newMatches} new matches are waiting`;
      body = 'Say hi and start chatting';
    } else if (newLikes > 0) {
      title = newLikes === 1
        ? 'Someone liked you'
        : `${newLikes} people liked you`;
      body = 'See who and like them back';
    } else if (nearbyCount >= 3) {
      title = `${nearbyCount} new people joined nearby`;
      body = 'Discover and connect with them';
    }

    return await createNotification(io, {
      userId,
      type: 'suggestion',
      title,
      body,
      deepLink: newMessages > 0 ? '/(tabs)/chat' : '/(tabs)',
      groupKey: 'comeback',
      priority: 'normal',
      data: {
        code: 'COMEBACK',
        newLikes: String(newLikes),
        newMatches: String(newMatches),
        newMessages: String(newMessages),
        nearbyCount: String(nearbyCount),
      },
    });
  } catch (error) {
    console.error('sendComeBackNotification error:', error);
    return null;
  }
}

/**
 * Send "Profile boost" notification
 * Dating app style: Encouraging profile completion
 */
async function sendProfileBoostNotification(io, userId, suggestions = []) {
  try {
    const user = await User.findById(userId)
      .select('name photo bio interests prompts')
      .lean();

    if (!user) return null;

    // Calculate profile completeness
    const completeness = calculateProfileCompleteness(user);

    if (completeness >= 90) return null; // Profile is good enough

    let title = '';
    let body = '';

    if (!user.bio || user.bio.length < 50) {
      title = 'Complete your bio to get 3x more matches';
      body = 'People with detailed bios get way more likes';
    } else if (!user.interests || user.interests.length < 3) {
      title = 'Add interests to find better matches';
      body = 'Common interests lead to better conversations';
    } else if (!user.photo || !Array.isArray(user.photo) || user.photo.length < 2) {
      title = 'Add more photos to stand out';
      body = 'Profiles with 3+ photos get 5x more profile views';
    } else if (suggestions.length > 0) {
      title = 'Boost your profile visibility';
      body = suggestions[0];
    } else {
      return null;
    }

    return await createNotification(io, {
      userId,
      type: 'system',
      title,
      body,
      deepLink: '/profile/edit',
      groupKey: 'profile-boost',
      priority: 'low',
      data: {
        code: 'PROFILE_BOOST',
        completeness: String(completeness),
      },
    });
  } catch (error) {
    console.error('sendProfileBoostNotification error:', error);
    return null;
  }
}

/**
 * Send "Mutual interest" notification
 * WhatsApp-style: Immediate, highly relevant
 */
async function sendMutualInterestNotification(io, userId, targetUserId, mutualTopic) {
  try {
    const targetUser = await User.findById(targetUserId)
      .select('publicId name photo')
      .lean();

    if (!targetUser) return null;

    const title = `${targetUser.name || 'Someone'} also loves ${mutualTopic}`;
    const body = 'You have so much in common! Like them to start chatting';

    return await createNotification(io, {
      userId,
      type: 'suggestion',
      title,
      body,
      actorId: targetUserId,
      imageUrl: targetUser.photo,
      deepLink: `/profile/${targetUser.publicId || targetUserId}`,
      groupKey: `mutual:${userId}`,
      priority: 'high',
      data: {
        code: 'MUTUAL_INTEREST',
        topic: mutualTopic,
      },
    });
  } catch (error) {
    console.error('sendMutualInterestNotification error:', error);
    return null;
  }
}

/**
 * Helper: Calculate distance between two coordinates (in km)
 */
function calculateDistance(coords1, coords2) {
  if (!coords1 || !coords2 || coords1.length !== 2 || coords2.length !== 2) {
    return Infinity;
  }

  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;

  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Helper: Get match score between two users
 */
async function getMatchScore(userId, candidateId) {
  try {
    const RecommendationScore = require('../models/RecommendationScore');
    const score = await RecommendationScore.findOne({
      userId: mongoose.Types.ObjectId(userId),
      candidateId: mongoose.Types.ObjectId(candidateId),
    }).select('totalScore').lean();

    return score?.totalScore || 50;
  } catch {
    return 50;
  }
}

/**
 * Helper: Calculate profile completeness (0-100)
 */
function calculateProfileCompleteness(user) {
  let score = 0;

  if (user.name && user.name.length >= 2) score += 10;
  if (user.bio && user.bio.length >= 50) score += 20;
  if (user.bio && user.bio.length >= 150) score += 10;
  if (user.photo) {
    const photoCount = Array.isArray(user.photo) ? user.photo.length : 1;
    score += Math.min(photoCount * 10, 30);
  }
  if (user.interests && user.interests.length >= 3) score += 15;
  if (user.interests && user.interests.length >= 5) score += 5;
  if (user.prompts && user.prompts.length >= 1) score += 10;

  return Math.min(score, 100);
}

module.exports = {
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
};
