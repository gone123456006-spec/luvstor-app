/**
 * Intelligent Notification Service
 * 
 * Handles "Suggested For You" push notifications with AI-powered timing,
 * frequency management, and personalization.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const NotificationHistory = require('../models/NotificationHistory');
const NotificationPreference = require('../models/NotificationPreference');
const DeviceToken = require('../models/DeviceToken');
const RecommendationScore = require('../models/RecommendationScore');
const ProfileView = require('../models/ProfileView');
const ContactMatch = require('../models/ContactMatch');
const Friendship = require('../models/Friendship');
const SearchHistory = require('../models/SearchHistory');
const { hasRealLocation } = require('./discovery');
const recommendationService = require('./recommendations');
const { sendPushNotification } = require('./fcm');

/**
 * Configuration
 */
const CONFIG = {
  MAX_DAILY_RECOMMENDATIONS: parseInt(process.env.MAX_DAILY_RECOMMENDATION_NOTIFS) || 2,
  MIN_HOURS_BETWEEN: parseInt(process.env.MIN_HOURS_BETWEEN_NOTIFS) || 8,
  WEEKLY_MAX: parseInt(process.env.WEEKLY_MAX_NOTIFS) || 10,
  NOTIFICATION_COOLDOWN_DAYS: parseInt(process.env.NOTIF_COOLDOWN_DAYS) || 30,
  MIN_ENGAGEMENT_SCORE: parseInt(process.env.MIN_ENGAGEMENT_SCORE) || 20,
  MIN_RECOMMENDATION_SCORE: parseInt(process.env.MIN_REC_SCORE_FOR_NOTIF) || 50,
  MIN_CONFIDENCE: parseInt(process.env.MIN_CONFIDENCE_FOR_NOTIF) || 60
};

class IntelligentNotificationService {
  /**
   * Main entry point: Evaluate and send notification if appropriate
   */
  async evaluateAndSendRecommendation(userId, options = {}) {
    const {
      triggerType = 'daily_refresh',
      immediate = false,
      candidateId = null
    } = options;

    try {
      // 1. Check eligibility
      const eligibility = await this.isEligibleForNotification(userId);
      if (!eligibility.eligible) {
        return {
          sent: false,
          reason: eligibility.reason,
          userId
        };
      }

      // 2. Select profiles to suggest
      const profiles = candidateId
        ? await this.getSpecificProfile(userId, candidateId)
        : await this.selectProfilesForNotification(userId, triggerType);

      if (profiles.length === 0) {
        return {
          sent: false,
          reason: 'no_suitable_profiles',
          userId
        };
      }

      // 3. Determine optimal send time
      const sendTime = immediate
        ? new Date()
        : await this.calculateOptimalSendTime(userId);

      // 4. Generate notification content
      const notification = await this.generateNotificationContent(
        userId,
        profiles,
        triggerType
      );

      // 5. Schedule or send immediately
      if (immediate || sendTime <= new Date()) {
        await this.sendNotification(userId, notification);
        
        return {
          sent: true,
          sentAt: new Date(),
          notification,
          userId
        };
      } else {
        await this.scheduleNotification(userId, notification, sendTime);
        
        return {
          sent: false,
          scheduled: true,
          scheduledFor: sendTime,
          notification,
          userId
        };
      }
    } catch (error) {
      console.error(`evaluateAndSendRecommendation error for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Check if user is eligible for notification
   */
  async isEligibleForNotification(userId) {
    // 1. User must exist and be active
    const user = await User.findById(userId).select('isDeactivated lastSeen notificationPrefs').lean();
    if (!user || user.isDeactivated) {
      return { eligible: false, reason: 'inactive_account' };
    }

    // 2. Check last activity (within 7 days)
    const daysSinceActive = (Date.now() - user.lastSeen) / (1000 * 60 * 60 * 24);
    if (daysSinceActive > 7) {
      return { eligible: false, reason: 'dormant_user' };
    }

    // 3. Check notification preferences
    const prefs = await NotificationPreference.findOne({ userId }).lean();
    if (prefs && prefs.recommendations === false) {
      return { eligible: false, reason: 'opted_out' };
    }

    // Backward compatibility: check user.notificationPrefs
    if (user.notificationPrefs?.promotions === false) {
      return { eligible: false, reason: 'opted_out' };
    }

    // 4. Check daily limit
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = await NotificationHistory.countDocuments({
      userId: mongoose.Types.ObjectId(userId),
      type: 'recommendation',
      createdAt: { $gte: new Date(today) }
    });

    if (todayCount >= CONFIG.MAX_DAILY_RECOMMENDATIONS) {
      return { eligible: false, reason: 'daily_limit_reached' };
    }

    // 5. Check cooldown between notifications
    const lastNotif = await NotificationHistory.findOne({
      userId: mongoose.Types.ObjectId(userId),
      type: 'recommendation'
    }).sort({ createdAt: -1 });

    if (lastNotif) {
      const hoursSinceLast = (Date.now() - lastNotif.createdAt) / (1000 * 60 * 60);
      if (hoursSinceLast < CONFIG.MIN_HOURS_BETWEEN) {
        return { eligible: false, reason: 'cooldown_active' };
      }
    }

    // 6. Check weekly limit
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekCount = await NotificationHistory.countDocuments({
      userId: mongoose.Types.ObjectId(userId),
      type: 'recommendation',
      createdAt: { $gte: weekAgo }
    });

    if (weekCount >= CONFIG.WEEKLY_MAX) {
      return { eligible: false, reason: 'weekly_limit_reached' };
    }

    // 7. Must have active device token
    const hasToken = await DeviceToken.exists({
      userId: mongoose.Types.ObjectId(userId),
      isActive: true
    });

    if (!hasToken) {
      return { eligible: false, reason: 'no_device_token' };
    }

    // 8. Check engagement score
    const engagementScore = await this.calculateEngagementScore(userId);
    if (engagementScore < CONFIG.MIN_ENGAGEMENT_SCORE) {
      return { eligible: false, reason: 'low_engagement' };
    }

    // 9. Check for notification fatigue
    const hasFatigue = await this.hasNotificationFatigue(userId);
    if (hasFatigue) {
      return { eligible: false, reason: 'notification_fatigue' };
    }

    return {
      eligible: true,
      engagementScore
    };
  }

  /**
   * Calculate user engagement score (0-100)
   */
  async calculateEngagementScore(userId, lookbackDays = 30) {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const userOid = mongoose.Types.ObjectId(userId);

    const [profileVisits, searches, follows, notificationClicks] = await Promise.all([
      ProfileView.countDocuments({
        viewerId: userOid,
        lastViewedAt: { $gte: since }
      }),
      SearchHistory.countDocuments({
        userId: userOid,
        createdAt: { $gte: since }
      }),
      Friendship.countDocuments({
        $or: [
          { userA: userOid, status: 'friends', createdAt: { $gte: since } },
          { userB: userOid, status: 'friends', createdAt: { $gte: since } }
        ]
      }),
      NotificationHistory.countDocuments({
        userId: userOid,
        clicked: true,
        createdAt: { $gte: since }
      })
    ]);

    // Weighted score
    const score = Math.min(
      profileVisits * 2 +
      searches * 3 +
      follows * 10 +
      notificationClicks * 8,
      100
    );

    return score;
  }

  /**
   * Check if user has notification fatigue
   */
  async hasNotificationFatigue(userId) {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const recentNotifs = await NotificationHistory.find({
      userId: mongoose.Types.ObjectId(userId),
      type: 'recommendation',
      createdAt: { $gte: twoWeeksAgo }
    }).lean();

    if (recentNotifs.length < 5) return false;

    const clickedCount = recentNotifs.filter(n => n.clicked).length;
    const ctr = clickedCount / recentNotifs.length;

    // CTR below 10% indicates fatigue
    return ctr < 0.1;
  }

  /**
   * Select profiles to include in notification
   */
  async selectProfilesForNotification(userId, triggerType) {
    // Get recommendations
    const recommendations = await recommendationService.getSuggestions(userId, {
      page: 1,
      count: 50,
      forceRefresh: false
    });

    if (recommendations.suggestions.length === 0) {
      return [];
    }

    // Filter out recently notified profiles
    const cooldownDate = new Date(
      Date.now() - CONFIG.NOTIFICATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    );

    const recentlyNotified = await NotificationHistory.distinct('suggestedUserIds', {
      userId: mongoose.Types.ObjectId(userId),
      type: 'recommendation',
      createdAt: { $gte: cooldownDate }
    });

    const notifiedSet = new Set(recentlyNotified.flat().map(String));

    // Filter candidates
    let candidates = recommendations.suggestions.filter(profile => {
      // Not recently notified
      if (notifiedSet.has(String(profile.userId))) return false;

      // Minimum quality thresholds
      if (profile.score < CONFIG.MIN_RECOMMENDATION_SCORE) return false;
      if (profile.confidence < CONFIG.MIN_CONFIDENCE) return false;
      if (profile.spamScore > 50) return false;

      // Prefer active users
      const hoursSinceActive = (Date.now() - profile.lastSeen) / (1000 * 60 * 60);
      if (hoursSinceActive > 48) return false;

      return true;
    });

    // Apply trigger-specific filters
    candidates = this.applyTriggerFilters(candidates, triggerType);

    // Calculate notification-specific score
    candidates = candidates.map(profile => ({
      ...profile,
      notificationScore: this.calculateNotificationScore(profile, triggerType)
    }));

    // Sort by notification score
    candidates.sort((a, b) => b.notificationScore - a.notificationScore);

    // Return top candidates
    return candidates.slice(0, 5);
  }

  /**
   * Apply trigger-specific filters
   */
  applyTriggerFilters(candidates, triggerType) {
    switch (triggerType) {
      case 'new_nearby':
        return candidates.filter(p => {
          const accountAgeHours = (Date.now() - p.createdAt) / (1000 * 60 * 60);
          return accountAgeHours < 72; // Within 3 days
        });

      case 'mutual_followers':
        return candidates.filter(p => p.mutualFollowers >= 3);

      case 'common_interests':
        return candidates.filter(p => p.commonInterests?.length >= 3);

      case 'trending':
        return candidates.filter(p => {
          const hoursActive = (Date.now() - p.lastSeen) / (1000 * 60 * 60);
          return hoursActive < 24 && p.followersCount > 100;
        });

      case 'contact_match':
        return candidates.filter(p =>
          p.reasons?.some(r => r.toLowerCase().includes('contact'))
        );

      default:
        return candidates;
    }
  }

  /**
   * Calculate notification suitability score
   */
  calculateNotificationScore(profile, triggerType) {
    let score = profile.score; // Base recommendation score

    // Trigger-specific boosts
    const triggerBoosts = {
      new_nearby: 10,
      mutual_followers: 15,
      common_interests: 12,
      profile_visitor: 20,
      contact_match: 25,
      trending: 8,
      friend_followed: 18
    };

    score += triggerBoosts[triggerType] || 0;

    // Online boost
    if (profile.isOnline) score += 10;

    // Recent activity boost
    const hoursActive = (Date.now() - profile.lastSeen) / (1000 * 60 * 60);
    if (hoursActive < 1) score += 15;
    else if (hoursActive < 6) score += 10;
    else if (hoursActive < 24) score += 5;

    // Verified boost
    if (profile.isVerified) score += 5;

    // Quality boost
    if (profile.accountQualityScore > 80) score += 10;

    return score;
  }

  /**
   * Get specific profile for targeted notification
   */
  async getSpecificProfile(userId, candidateId) {
    const candidate = await User.findById(candidateId)
      .select('publicId name age photo bio isOnline lastSeen followersCount isVerified')
      .lean();

    if (!candidate) return [];

    // Get recommendation score if exists
    const score = await RecommendationScore.findOne({
      userId: mongoose.Types.ObjectId(userId),
      candidateId: mongoose.Types.ObjectId(candidateId)
    }).lean();

    return [{
      userId: candidate._id,
      ...candidate,
      score: score?.totalScore || 50,
      reasons: score?.explanation?.topReasons || []
    }];
  }

  /**
   * Calculate optimal send time
   */
  async calculateOptimalSendTime(userId) {
    // Get user's engagement patterns
    const patterns = await this.getUserEngagementPatterns(userId);

    const now = new Date();
    const currentHour = now.getHours();

    // Check if current time is optimal
    if (this.isOptimalHour(currentHour, patterns)) {
      return now;
    }

    // Schedule for next optimal hour
    const nextOptimalHour = this.getNextOptimalHour(currentHour, patterns);
    return this.getNextOccurrenceOfHour(nextOptimalHour);
  }

  /**
   * Analyze user's notification engagement patterns
   */
  async getUserEngagementPatterns(userId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const history = await NotificationHistory.find({
      userId: mongoose.Types.ObjectId(userId),
      createdAt: { $gte: thirtyDaysAgo }
    }).lean();

    // Group by hour
    const hourlyClicks = Array(24).fill(0);
    const hourlyCounts = Array(24).fill(0);

    history.forEach(notif => {
      const hour = notif.createdAt.getHours();
      hourlyCounts[hour]++;
      if (notif.clicked) {
        hourlyClicks[hour]++;
      }
    });

    // Calculate CTR by hour
    const ctrByHour = hourlyClicks.map((clicks, hour) => {
      const count = hourlyCounts[hour];
      return count > 0 ? clicks / count : 0;
    });

    // Find peak hours
    const peakHours = ctrByHour
      .map((ctr, hour) => ({ hour, ctr }))
      .sort((a, b) => b.ctr - a.ctr)
      .slice(0, 3)
      .map(item => item.hour);

    return {
      peakHours,
      totalNotifications: history.length
    };
  }

  /**
   * Check if hour is optimal for sending
   */
  isOptimalHour(hour, patterns) {
    if (patterns.totalNotifications >= 10) {
      return patterns.peakHours.includes(hour);
    }

    // Default optimal hours
    const defaultOptimal = [9, 12, 18, 20, 21];
    return defaultOptimal.includes(hour);
  }

  /**
   * Get next optimal hour
   */
  getNextOptimalHour(currentHour, patterns) {
    const optimalHours = patterns.totalNotifications >= 10
      ? patterns.peakHours.sort((a, b) => a - b)
      : [9, 12, 18, 20];

    for (const hour of optimalHours) {
      if (hour > currentHour) return hour;
    }

    return optimalHours[0]; // Next day
  }

  /**
   * Get next occurrence of specific hour
   */
  getNextOccurrenceOfHour(targetHour) {
    const now = new Date();
    const scheduled = new Date(now);

    if (targetHour > now.getHours()) {
      scheduled.setHours(targetHour, 0, 0, 0);
    } else {
      scheduled.setDate(scheduled.getDate() + 1);
      scheduled.setHours(targetHour, 0, 0, 0);
    }

    return scheduled;
  }

  /**
   * Generate notification content
   */
  async generateNotificationContent(userId, profiles, triggerType) {
    const count = profiles.length;
    const topProfile = profiles[0];

    // Get user data for the top profile
    const candidate = await User.findById(topProfile.userId)
      .select('name publicId')
      .lean();

    const messages = this.getNotificationMessages(
      triggerType,
      count,
      candidate,
      topProfile
    );

    return {
      type: 'recommendation',
      triggerType,
      title: messages.title,
      body: messages.body,
      icon: '👥',
      suggestedUserIds: profiles.map(p => p.userId),
      topSuggestedUser: {
        userId: topProfile.userId,
        name: candidate.name,
        publicId: candidate.publicId,
        photo: topProfile.photo
      },
      deepLink: `/(tabs)/discover?suggested=${topProfile.userId}`,
      data: {
        type: 'recommendation',
        triggerType,
        suggestedUserIds: profiles.map(p => String(p.userId)),
        count
      }
    };
  }

  /**
   * Get notification messages based on trigger type
   */
  getNotificationMessages(triggerType, count, candidate, profile) {
    const name = candidate.name;

    const messages = {
      new_nearby: {
        title: '📍 Someone nearby just joined',
        body: count === 1
          ? `${name} just joined near you. Check them out!`
          : `${count} new people joined near you. Take a look!`
      },
      mutual_followers: {
        title: '👥 High mutual connection',
        body: `You have ${profile.mutualFollowers} mutual friends with ${name}.`
      },
      common_interests: {
        title: '❤️ Suggested for you',
        body: `${name} shares your interests. You'll probably like them.`
      },
      profile_visitor: {
        title: '👀 Someone viewed your profile',
        body: `${name} viewed your profile multiple times. Check them out.`
      },
      contact_match: {
        title: '👋 You may know this person',
        body: `${name} from your contacts just joined. Say hi!`
      },
      trending: {
        title: '🔥 Popular nearby',
        body: `${name} is trending near you. Check them out.`
      },
      friend_followed: {
        title: '✨ Your friend followed someone',
        body: `Your friend started following ${name}.`
      },
      daily_refresh: {
        title: '✨ Discover new people',
        body: count === 1
          ? `You might know ${name}. View their profile.`
          : `${count} new people are waiting to connect with you.`
      },
      weekly_refresh: {
        title: '💫 Weekly suggestions',
        body: `We found ${count} new people you might know.`
      }
    };

    return messages[triggerType] || messages.daily_refresh;
  }

  /**
   * Send notification immediately
   */
  async sendNotification(userId, notification) {
    try {
      // Get device tokens
      const tokens = await DeviceToken.find({
        userId: mongoose.Types.ObjectId(userId),
        isActive: true
      }).lean();

      if (tokens.length === 0) {
        throw new Error('No active device tokens');
      }

      // Send via FCM
      const results = await Promise.all(
        tokens.map(token =>
          sendPushNotification(token.token, {
            title: notification.title,
            body: notification.body,
            data: notification.data
          })
        )
      );

      // Record in history
      await NotificationHistory.create({
        userId: mongoose.Types.ObjectId(userId),
        type: notification.type,
        triggerType: notification.triggerType,
        title: notification.title,
        body: notification.body,
        suggestedUserIds: notification.suggestedUserIds.map(id =>
          mongoose.Types.ObjectId(id)
        ),
        deliveredAt: new Date(),
        deliveryStatus: 'delivered'
      });

      return {
        success: true,
        tokensCount: tokens.length,
        results
      };
    } catch (error) {
      console.error(`sendNotification error for user ${userId}:`, error);
      
      // Record failed delivery
      await NotificationHistory.create({
        userId: mongoose.Types.ObjectId(userId),
        type: notification.type,
        triggerType: notification.triggerType,
        title: notification.title,
        body: notification.body,
        suggestedUserIds: notification.suggestedUserIds.map(id =>
          mongoose.Types.ObjectId(id)
        ),
        deliveryStatus: 'failed',
        failureReason: error.message
      });

      throw error;
    }
  }

  /**
   * Schedule notification for later
   */
  async scheduleNotification(userId, notification, sendTime) {
    const { notificationQueue } = require('../workers/notificationWorkers');

    await notificationQueue.add(
      'scheduled-recommendation',
      {
        userId,
        notification
      },
      {
        delay: sendTime.getTime() - Date.now(),
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000 // 1 minute
        }
      }
    );

    return {
      scheduled: true,
      scheduledFor: sendTime
    };
  }

  /**
   * Mark notification as viewed
   */
  async markAsViewed(userId, notificationId) {
    await NotificationHistory.updateOne(
      {
        _id: mongoose.Types.ObjectId(notificationId),
        userId: mongoose.Types.ObjectId(userId)
      },
      {
        $set: {
          viewed: true,
          viewedAt: new Date()
        }
      }
    );
  }

  /**
   * Mark notification as clicked
   */
  async markAsClicked(userId, notificationId) {
    await NotificationHistory.updateOne(
      {
        _id: mongoose.Types.ObjectId(notificationId),
        userId: mongoose.Types.ObjectId(userId)
      },
      {
        $set: {
          clicked: true,
          clickedAt: new Date()
        }
      }
    );
  }

  /**
   * Get notification analytics
   */
  async getAnalytics(startDate, endDate) {
    const notifications = await NotificationHistory.find({
      type: 'recommendation',
      createdAt: { $gte: startDate, $lte: endDate }
    }).lean();

    const total = notifications.length;
    const delivered = notifications.filter(n => n.deliveryStatus === 'delivered').length;
    const viewed = notifications.filter(n => n.viewed).length;
    const clicked = notifications.filter(n => n.clicked).length;

    return {
      total,
      delivered,
      viewed,
      clicked,
      deliveryRate: total > 0 ? (delivered / total) * 100 : 0,
      viewRate: delivered > 0 ? (viewed / delivered) * 100 : 0,
      ctr: delivered > 0 ? (clicked / delivered) * 100 : 0
    };
  }
}

module.exports = new IntelligentNotificationService();
