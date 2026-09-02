# Intelligent Push Notification System - "Suggested For You"

## Executive Summary

This document outlines a production-grade AI-powered push notification system for sending personalized "Suggested For You" recommendations to users. The system intelligently decides **who** to notify, **when** to send, **which profiles** to suggest, and **how many** notifications to send, maximizing engagement while avoiding spam.

---

## 1. System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Mobile Devices (Users)                        │
│              React Native + Firebase SDK                         │
└────────────────────┬────────────────────────────────────────────┘
                     │ FCM Push Notifications
┌────────────────────▼────────────────────────────────────────────┐
│              Firebase Cloud Messaging (FCM)                      │
│              Google's Push Delivery Network                      │
└────────────────────┬────────────────────────────────────────────┘
                     │ Notification Delivery
┌────────────────────▼────────────────────────────────────────────┐
│                  Notification Gateway                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │          Intelligent Notification Engine               │    │
│  │                                                         │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │    │
│  │  │   Eligibility│  │   Timing     │  │   Content   │ │    │
│  │  │   Filter     │  │   Optimizer  │  │   Generator │ │    │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │    │
│  │                                                         │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │    │
│  │  │   Frequency  │  │   Quality    │  │   Delivery  │ │    │
│  │  │   Limiter    │  │   Scorer     │  │   Manager   │ │    │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│                    Queue System (BullMQ)                         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Daily       │  │  Instant     │  │  Weekly      │         │
│  │  Digest      │  │  Trigger     │  │  Summary     │         │
│  │  Queue       │  │  Queue       │  │  Queue       │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Retry       │  │  Failed      │  │  Analytics   │         │
│  │  Queue       │  │  Queue       │  │  Queue       │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└────────────────────┬────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│                  Background Workers                              │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Notification│  │  Timing      │  │  Analytics   │         │
│  │  Processor   │  │  Optimizer   │  │  Processor   │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│                    Data Layer                                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   MongoDB    │  │    Redis     │  │ Recommendation│         │
│  │              │  │    Cache     │  │    Engine     │         │
│  │ - Notifications│ │ - Counters  │  │              │         │
│  │ - Preferences│  │ - Cooldowns │  │ (Existing)   │         │
│  │ - History    │  │ - Tokens    │  │              │         │
│  │ - Analytics  │  │ - Sessions  │  │              │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

### Component Flow

```
User Activity → Trigger Detection → Eligibility Check → Timing Optimization
      ↓
Content Generation → Quality Scoring → Queue → Worker Processing
      ↓
FCM Delivery → User Interaction → Analytics → ML Model Update
```

---

## 2. Intelligent Notification Engine

### 2.1 Who Should Receive Notifications?

**Eligibility Criteria:**

```javascript
async function isEligibleForRecommendationNotification(userId) {
  // 1. User must be active
  const user = await User.findById(userId);
  if (!user || user.isDeactivated) return { eligible: false, reason: 'inactive' };
  
  // 2. Check last seen (within 7 days)
  const daysSinceActive = (Date.now() - user.lastSeen) / (1000 * 60 * 60 * 24);
  if (daysSinceActive > 7) return { eligible: false, reason: 'dormant' };
  
  // 3. User must have notification preferences enabled
  if (user.notificationPrefs?.suggestions === false) {
    return { eligible: false, reason: 'opted_out' };
  }
  
  // 4. Check daily limit (max 2 recommendation notifications per day)
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = await NotificationHistory.countDocuments({
    userId,
    type: 'recommendation',
    createdAt: { $gte: new Date(today) }
  });
  if (todayCount >= 2) return { eligible: false, reason: 'daily_limit' };
  
  // 5. Check global cooldown (minimum 8 hours between notifications)
  const lastNotification = await NotificationHistory.findOne({
    userId,
    type: 'recommendation'
  }).sort({ createdAt: -1 });
  
  if (lastNotification) {
    const hoursSinceLast = (Date.now() - lastNotification.createdAt) / (1000 * 60 * 60);
    if (hoursSinceLast < 8) return { eligible: false, reason: 'cooldown' };
  }
  
  // 6. User must have device token
  const hasToken = await DeviceToken.exists({ userId, isActive: true });
  if (!hasToken) return { eligible: false, reason: 'no_device' };
  
  // 7. Check engagement score (avoid notifying disengaged users)
  const engagementScore = await calculateEngagementScore(userId);
  if (engagementScore < 20) return { eligible: false, reason: 'low_engagement' };
  
  return { eligible: true, engagementScore };
}
```

**Engagement Score Calculation:**

```javascript
async function calculateEngagementScore(userId, lookbackDays = 30) {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  
  // Recent activity indicators
  const [
    profileVisits,
    searches,
    follows,
    messages,
    notificationClicks
  ] = await Promise.all([
    ProfileView.countDocuments({ viewerId: userId, lastViewedAt: { $gte: since } }),
    SearchHistory.countDocuments({ userId, createdAt: { $gte: since } }),
    Friendship.countDocuments({ userId, createdAt: { $gte: since } }),
    Message.countDocuments({ senderId: userId, createdAt: { $gte: since } }),
    NotificationHistory.countDocuments({
      userId,
      clicked: true,
      createdAt: { $gte: since }
    })
  ]);
  
  // Weighted engagement score (0-100)
  const score = Math.min(
    profileVisits * 2 +
    searches * 3 +
    follows * 10 +
    messages * 5 +
    notificationClicks * 8,
    100
  );
  
  return score;
}
```

### 2.2 Which Profiles to Suggest?

**Profile Selection Algorithm:**

```javascript
async function selectProfilesForNotification(userId, triggerType) {
  // Get high-quality recommendations
  const recommendations = await recommendationService.getSuggestions(userId, {
    page: 1,
    count: 50, // Get larger pool
    forceRefresh: false
  });
  
  // Filter profiles never notified before (30-day lookback)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const notifiedProfiles = await NotificationHistory.distinct('suggestedUserId', {
    userId,
    type: 'recommendation',
    createdAt: { $gte: thirtyDaysAgo }
  });
  
  const notifiedSet = new Set(notifiedProfiles.map(String));
  
  // Filter based on trigger type
  let candidates = recommendations.suggestions.filter(
    profile => !notifiedSet.has(String(profile.userId))
  );
  
  // Apply trigger-specific filters
  candidates = applyTriggerFilters(candidates, triggerType, userId);
  
  // Quality thresholds
  candidates = candidates.filter(profile => {
    // Minimum score
    if (profile.score < 50) return false;
    
    // Minimum confidence
    if (profile.confidence < 60) return false;
    
    // Avoid fake/spam accounts
    if (profile.spamScore > 50) return false;
    
    // Prefer active users
    const hoursSinceActive = (Date.now() - profile.lastSeen) / (1000 * 60 * 60);
    if (hoursSinceActive > 48) return false;
    
    return true;
  });
  
  // Sort by notification suitability score
  candidates = candidates.map(profile => ({
    ...profile,
    notificationScore: calculateNotificationScore(profile, triggerType)
  })).sort((a, b) => b.notificationScore - a.notificationScore);
  
  return candidates.slice(0, 5); // Top 5 for notification
}

function applyTriggerFilters(candidates, triggerType, userId) {
  switch (triggerType) {
    case 'new_nearby':
      // Filter for newly joined users within 3 days
      return candidates.filter(p => {
        const accountAgeHours = (Date.now() - p.createdAt) / (1000 * 60 * 60);
        return accountAgeHours < 72;
      });
    
    case 'mutual_followers':
      // Filter for high mutual follower count
      return candidates.filter(p => p.mutualFollowers >= 3);
    
    case 'common_interests':
      // Filter for multiple common interests
      return candidates.filter(p => p.commonInterests?.length >= 3);
    
    case 'profile_visitor':
      // Get users who visited profile multiple times
      // (Handled separately in trigger detection)
      return candidates;
    
    case 'trending':
      // Filter for recently active with high follower count
      return candidates.filter(p => {
        const hoursActive = (Date.now() - p.lastSeen) / (1000 * 60 * 60);
        return hoursActive < 24 && p.followersCount > 100;
      });
    
    case 'contact_match':
      // Filter for contact matches
      return candidates.filter(p => p.reasons?.includes('In your contacts'));
    
    default:
      return candidates;
  }
}

function calculateNotificationScore(profile, triggerType) {
  let score = profile.score; // Base recommendation score
  
  // Boost based on trigger relevance
  const triggerBoosts = {
    new_nearby: 10,
    mutual_followers: 15,
    common_interests: 12,
    profile_visitor: 20,
    contact_match: 25,
    trending: 8
  };
  
  score += triggerBoosts[triggerType] || 0;
  
  // Boost for online status
  if (profile.isOnline) score += 10;
  
  // Boost for recent activity
  const hoursActive = (Date.now() - profile.lastSeen) / (1000 * 60 * 60);
  if (hoursActive < 1) score += 15;
  else if (hoursActive < 6) score += 10;
  else if (hoursActive < 24) score += 5;
  
  // Boost for verified accounts
  if (profile.isVerified) score += 5;
  
  // Boost for high-quality profiles
  if (profile.accountQualityScore > 80) score += 10;
  
  return score;
}
```

### 2.3 When to Send Notifications?

**Optimal Timing Algorithm:**

```javascript
class NotificationTimingOptimizer {
  /**
   * Determine the best time to send notification
   */
  async getBestSendTime(userId, immediate = false) {
    if (immediate) return new Date();
    
    // Get user's historical engagement patterns
    const patterns = await this.getUserEngagementPatterns(userId);
    
    // Get current time in user's timezone
    const userTimezone = await this.getUserTimezone(userId);
    const now = new Date();
    const localHour = this.getLocalHour(now, userTimezone);
    
    // Check if current time is in high-engagement window
    if (this.isHighEngagementTime(localHour, patterns)) {
      // Send immediately if within optimal window
      return now;
    }
    
    // Schedule for next optimal time
    const nextOptimalHour = this.getNextOptimalHour(localHour, patterns);
    const scheduledTime = this.getNextOccurrenceOfHour(nextOptimalHour, userTimezone);
    
    return scheduledTime;
  }
  
  /**
   * Analyze user's notification engagement history
   */
  async getUserEngagementPatterns(userId) {
    const history = await NotificationHistory.find({
      userId,
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    }).lean();
    
    // Group by hour of day
    const hourlyEngagement = Array(24).fill(0);
    const hourlyCounts = Array(24).fill(0);
    
    history.forEach(notif => {
      const hour = notif.createdAt.getHours();
      hourlyCounts[hour]++;
      
      if (notif.clicked) {
        hourlyEngagement[hour]++;
      }
    });
    
    // Calculate click-through rate per hour
    const ctrByHour = hourlyEngagement.map((clicks, hour) => {
      const count = hourlyCounts[hour];
      return count > 0 ? clicks / count : 0;
    });
    
    // Find peak engagement hours (top 3)
    const peakHours = ctrByHour
      .map((ctr, hour) => ({ hour, ctr }))
      .sort((a, b) => b.ctr - a.ctr)
      .slice(0, 3)
      .map(item => item.hour);
    
    return {
      peakHours,
      ctrByHour,
      totalNotifications: history.length
    };
  }
  
  /**
   * Check if current time is good for sending
   */
  isHighEngagementTime(hour, patterns) {
    // If we have user-specific data, use it
    if (patterns.totalNotifications >= 10) {
      return patterns.peakHours.includes(hour);
    }
    
    // Otherwise, use global optimal times
    const globalOptimalHours = [9, 12, 18, 20, 21]; // Morning, lunch, evening
    return globalOptimalHours.includes(hour);
  }
  
  /**
   * Get next optimal hour for sending
   */
  getNextOptimalHour(currentHour, patterns) {
    let optimalHours;
    
    if (patterns.totalNotifications >= 10) {
      optimalHours = patterns.peakHours.sort((a, b) => a - b);
    } else {
      optimalHours = [9, 12, 18, 20]; // Default optimal hours
    }
    
    // Find next optimal hour after current
    for (const hour of optimalHours) {
      if (hour > currentHour) return hour;
    }
    
    // If none found, return first optimal hour of next day
    return optimalHours[0];
  }
  
  getLocalHour(date, timezone) {
    // Simple timezone offset (in production, use moment-timezone or date-fns-tz)
    const offsetMinutes = timezone || 0;
    const localDate = new Date(date.getTime() + offsetMinutes * 60000);
    return localDate.getUTCHours();
  }
  
  getNextOccurrenceOfHour(targetHour, timezone) {
    const now = new Date();
    const currentHour = this.getLocalHour(now, timezone);
    
    let scheduledTime = new Date(now);
    
    if (targetHour > currentHour) {
      // Same day
      scheduledTime.setHours(targetHour, 0, 0, 0);
    } else {
      // Next day
      scheduledTime.setDate(scheduledTime.getDate() + 1);
      scheduledTime.setHours(targetHour, 0, 0, 0);
    }
    
    return scheduledTime;
  }
  
  async getUserTimezone(userId) {
    // Try to get from user profile or device
    const user = await User.findById(userId).select('timezone').lean();
    return user?.timezone || 0; // UTC offset in minutes
  }
}
```

### 2.4 How Many Notifications Per Day?

**Frequency Management:**

```javascript
class NotificationFrequencyManager {
  // Global limits
  static MAX_DAILY_RECOMMENDATIONS = 2;
  static MIN_HOURS_BETWEEN = 8;
  static WEEKLY_MAX = 10;
  
  /**
   * Check if user can receive another notification today
   */
  async canSendToday(userId) {
    const today = new Date().toISOString().slice(0, 10);
    
    const count = await NotificationHistory.countDocuments({
      userId,
      type: 'recommendation',
      createdAt: { $gte: new Date(today) }
    });
    
    return count < NotificationFrequencyManager.MAX_DAILY_RECOMMENDATIONS;
  }
  
  /**
   * Check cooldown period
   */
  async isInCooldown(userId) {
    const lastNotif = await NotificationHistory.findOne({
      userId,
      type: 'recommendation'
    }).sort({ createdAt: -1 });
    
    if (!lastNotif) return false;
    
    const hoursSince = (Date.now() - lastNotif.createdAt) / (1000 * 60 * 60);
    return hoursSince < NotificationFrequencyManager.MIN_HOURS_BETWEEN;
  }
  
  /**
   * Check weekly limit
   */
  async hasReachedWeeklyLimit(userId) {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const count = await NotificationHistory.countDocuments({
      userId,
      type: 'recommendation',
      createdAt: { $gte: oneWeekAgo }
    });
    
    return count >= NotificationFrequencyManager.WEEKLY_MAX;
  }
  
  /**
   * Adaptive frequency based on user engagement
   */
  async getAdaptiveFrequency(userId) {
    const engagementScore = await calculateEngagementScore(userId);
    
    // High engagement users can get more notifications
    if (engagementScore > 80) {
      return {
        dailyMax: 3,
        minHoursBetween: 6
      };
    }
    
    // Medium engagement
    if (engagementScore > 50) {
      return {
        dailyMax: 2,
        minHoursBetween: 8
      };
    }
    
    // Low engagement - reduce frequency
    return {
      dailyMax: 1,
      minHoursBetween: 12
    };
  }
  
  /**
   * Check if user is showing notification fatigue
   */
  async hasNotificationFatigue(userId) {
    const recent = await NotificationHistory.find({
      userId,
      type: 'recommendation',
      createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
    }).lean();
    
    if (recent.length < 5) return false;
    
    const clickedCount = recent.filter(n => n.clicked).length;
    const ctr = clickedCount / recent.length;
    
    // If CTR drops below 10%, user has fatigue
    return ctr < 0.1;
  }
}
```

---

## 3. Notification Triggers

### Trigger Detection System

```javascript
class NotificationTriggerDetector {
  /**
   * Detect all active triggers for a user
   */
  async detectTriggers(userId) {
    const triggers = [];
    
    // Run all trigger detections in parallel
    const [
      newNearby,
      mutualFollowers,
      commonInterests,
      friendFollowed,
      profileVisitors,
      contactJoined,
      trending,
      activeCreator,
      dailyRefresh,
      weeklyRefresh
    ] = await Promise.all([
      this.checkNewNearbyUsers(userId),
      this.checkMutualFollowers(userId),
      this.checkCommonInterests(userId),
      this.checkFriendFollowedSomeone(userId),
      this.checkProfileVisitors(userId),
      this.checkContactJoined(userId),
      this.checkTrendingNearby(userId),
      this.checkActiveCreators(userId),
      this.checkDailyRefresh(userId),
      this.checkWeeklyRefresh(userId)
    ]);
    
    // Collect triggered events
    if (newNearby.triggered) triggers.push(newNearby);
    if (mutualFollowers.triggered) triggers.push(mutualFollowers);
    if (commonInterests.triggered) triggers.push(commonInterests);
    if (friendFollowed.triggered) triggers.push(friendFollowed);
    if (profileVisitors.triggered) triggers.push(profileVisitors);
    if (contactJoined.triggered) triggers.push(contactJoined);
    if (trending.triggered) triggers.push(trending);
    if (activeCreator.triggered) triggers.push(activeCreator);
    if (dailyRefresh.triggered) triggers.push(dailyRefresh);
    if (weeklyRefresh.triggered) triggers.push(weeklyRefresh);
    
    // Sort by priority
    triggers.sort((a, b) => b.priority - a.priority);
    
    return triggers;
  }
  
  /**
   * Trigger 1: New user joined nearby
   */
  async checkNewNearbyUsers(userId) {
    const user = await User.findById(userId).select('location').lean();
    if (!hasRealLocation(user.location?.coordinates)) {
      return { triggered: false };
    }
    
    // Check for new users within 10km in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const newUsers = await User.countDocuments({
      _id: { $ne: userId },
      createdAt: { $gte: oneDayAgo },
      location: {
        $near: {
          $geometry: user.location,
          $maxDistance: 10000 // 10km
        }
      },
      isDeactivated: false
    });
    
    if (newUsers > 0) {
      return {
        triggered: true,
        type: 'new_nearby',
        priority: 85,
        count: newUsers,
        message: `${newUsers} ${newUsers === 1 ? 'person' : 'people'} nearby just joined. Check them out.`
      };
    }
    
    return { triggered: false };
  }
  
  /**
   * Trigger 2: High mutual follower count
   */
  async checkMutualFollowers(userId) {
    // Get recommendations with high mutual follower count
    const recommendations = await RecommendationScore.find({
      userId,
      'signals.mutualFollowers': { $gte: 5 },
      computedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })
      .sort({ 'signals.mutualFollowers': -1 })
      .limit(1)
      .lean();
    
    if (recommendations.length > 0) {
      const candidate = recommendations[0];
      const mutualCount = candidate.signals.mutualFollowers;
      
      return {
        triggered: true,
        type: 'mutual_followers',
        priority: 90,
        candidateId: candidate.candidateId,
        mutualCount,
        message: `You have ${mutualCount} mutual friends with someone. Check them out.`
      };
    }
    
    return { triggered: false };
  }
  
  /**
   * Trigger 3: Common interests
   */
  async checkCommonInterests(userId) {
    const recommendations = await RecommendationScore.find({
      userId,
      'signals.commonInterests': { $gte: 4 },
      computedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })
      .sort({ 'signals.commonInterests': -1 })
      .limit(1)
      .lean();
    
    if (recommendations.length > 0) {
      const candidate = recommendations[0];
      
      return {
        triggered: true,
        type: 'common_interests',
        priority: 75,
        candidateId: candidate.candidateId,
        message: `Someone shares your interests. You'll probably like them.`
      };
    }
    
    return { triggered: false };
  }
  
  /**
   * Trigger 4: Friend recently followed someone
   */
  async checkFriendFollowedSomeone(userId) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // Get user's friends
    const friendships = await Friendship.find({
      $or: [
        { userA: userId, status: 'friends' },
        { userB: userId, status: 'friends' }
      ]
    }).lean();
    
    const friendIds = friendships.map(f =>
      String(f.userA) === String(userId) ? f.userB : f.userA
    );
    
    if (friendIds.length === 0) return { triggered: false };
    
    // Check if any friend followed someone new recently
    const recentFollows = await Friendship.find({
      userId: { $in: friendIds },
      createdAt: { $gte: oneHourAgo },
      status: 'accepted'
    })
      .populate('userId', 'name')
      .populate('friendId', 'name')
      .limit(1)
      .lean();
    
    if (recentFollows.length > 0) {
      const follow = recentFollows[0];
      
      return {
        triggered: true,
        type: 'friend_followed',
        priority: 70,
        friendName: follow.userId.name,
        candidateId: follow.friendId._id,
        candidateName: follow.friendId.name,
        message: `${follow.userId.name} started following ${follow.friendId.name}.`
      };
    }
    
    return { triggered: false };
  }
  
  /**
   * Trigger 5: Multiple profile visits
   */
  async checkProfileVisitors(userId) {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    
    // Find users who visited profile multiple times
    const visitors = await ProfileView.find({
      targetId: userId,
      viewCount: { $gte: 3 },
      lastViewedAt: { $gte: threeDaysAgo }
    })
      .sort({ viewCount: -1, lastViewedAt: -1 })
      .limit(1)
      .lean();
    
    if (visitors.length > 0) {
      const visitor = visitors[0];
      
      return {
        triggered: true,
        type: 'profile_visitor',
        priority: 95,
        candidateId: visitor.viewerId,
        viewCount: visitor.viewCount,
        message: `Someone viewed your profile ${visitor.viewCount} times. Check them out.`
      };
    }
    
    return { triggered: false };
  }
  
  /**
   * Trigger 6: Contact joined
   */
  async checkContactJoined(userId) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const newMatches = await ContactMatch.find({
      userId,
      createdAt: { $gte: oneDayAgo }
    }).limit(1).lean();
    
    if (newMatches.length > 0) {
      return {
        triggered: true,
        type: 'contact_match',
        priority: 100, // Highest priority
        candidateId: newMatches[0].matchedUserId,
        message: `Someone from your contacts just joined. Say hi!`
      };
    }
    
    return { triggered: false };
  }
  
  /**
   * Trigger 7: Trending nearby user
   */
  async checkTrendingNearby(userId) {
    const user = await User.findById(userId).select('location').lean();
    if (!hasRealLocation(user.location?.coordinates)) {
      return { triggered: false };
    }
    
    // Find highly active users nearby
    const trendingUsers = await User.find({
      _id: { $ne: userId },
      location: {
        $near: {
          $geometry: user.location,
          $maxDistance: 20000 // 20km
        }
      },
      followersCount: { $gte: 500 },
      lastSeen: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      isDeactivated: false
    }).limit(1).lean();
    
    if (trendingUsers.length > 0) {
      return {
        triggered: true,
        type: 'trending',
        priority: 65,
        candidateId: trendingUsers[0]._id,
        message: `A popular creator near you is active. Check them out.`
      };
    }
    
    return { triggered: false };
  }
  
  /**
   * Trigger 8: Active creator with matching interests
   */
  async checkActiveCreators(userId) {
    const user = await User.findById(userId).select('interests').lean();
    if (!user.interests || user.interests.length === 0) {
      return { triggered: false };
    }
    
    const activeCreators = await User.find({
      _id: { $ne: userId },
      interests: { $in: user.interests },
      followersCount: { $gte: 1000 },
      lastSeen: { $gte: new Date(Date.now() - 60 * 60 * 1000) }, // Active in last hour
      isDeactivated: false
    }).limit(1).lean();
    
    if (activeCreators.length > 0) {
      return {
        triggered: true,
        type: 'active_creator',
        priority: 60,
        candidateId: activeCreators[0]._id,
        message: `A highly active creator matches your interests.`
      };
    }
    
    return { triggered: false };
  }
  
  /**
   * Trigger 9: Daily refresh
   */
  async checkDailyRefresh(userId) {
    // Check if user hasn't been notified today
    const today = new Date().toISOString().slice(0, 10);
    
    const todayNotifs = await NotificationHistory.countDocuments({
      userId,
      type: 'recommendation',
      createdAt: { $gte: new Date(today) }
    });
    
    if (todayNotifs === 0) {
      return {
        triggered: true,
        type: 'daily_refresh',
        priority: 50,
        message: `Discover new people you'll probably like.`
      };
    }
    
    return { triggered: false };
  }
  
  /**
   * Trigger 10: Weekly refresh
   */
  async checkWeeklyRefresh(userId) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const recentNotifs = await NotificationHistory.countDocuments({
      userId,
      type: 'recommendation',
      createdAt: { $gte: sevenDaysAgo }
    });
    
    // If user hasn't received any notification in a week
    if (recentNotifs === 0) {
      return {
        triggered: true,
        type: 'weekly_refresh',
        priority: 40,
        message: `We found new people you might know. Take a look.`
      };
    }
    
    return { triggered: false };
  }
}
```

---

*Continuing in next file due to length...*
