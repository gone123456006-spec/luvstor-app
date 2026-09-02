/**
 * Recommendation Service - Core recommendation engine
 * 
 * Generates personalized user suggestions using multi-signal hybrid algorithm.
 * Integrates with existing Luvstor architecture.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const RecommendationScore = require('../models/RecommendationScore');
const RecommendationImpression = require('../models/RecommendationImpression');
const ProfileView = require('../models/ProfileView');
const SearchHistory = require('../models/SearchHistory');
const ContactMatch = require('../models/ContactMatch');
const { hasRealLocation } = require('./discovery');
const recommendationCache = require('./recommendationCache');

/**
 * Configurable signal weights (can be adjusted via env vars)
 */
const WEIGHTS = {
  mutualFollowers: parseFloat(process.env.REC_WEIGHT_MUTUAL_FOLLOWERS || '12'),
  mutualFollowing: parseFloat(process.env.REC_WEIGHT_MUTUAL_FOLLOWING || '8'),
  friendsOfFriends: parseFloat(process.env.REC_WEIGHT_FRIENDS_OF_FRIENDS || '6'),
  contactMatch: parseFloat(process.env.REC_WEIGHT_CONTACT_MATCH || '9'),
  commonInterests: parseFloat(process.env.REC_WEIGHT_COMMON_INTERESTS || '10'),
  locationSimilarity: parseFloat(process.env.REC_WEIGHT_LOCATION || '3'),
  profileVisits: parseFloat(process.env.REC_WEIGHT_PROFILE_VISITS || '8'),
  searchHistory: parseFloat(process.env.REC_WEIGHT_SEARCH || '6'),
  engagement: parseFloat(process.env.REC_WEIGHT_ENGAGEMENT || '6'),
  accountQuality: parseFloat(process.env.REC_WEIGHT_QUALITY || '3'),
  newUserBoost: parseFloat(process.env.REC_WEIGHT_NEW_USER || '2'),
  trending: parseFloat(process.env.REC_WEIGHT_TRENDING || '2')
};

const CANDIDATE_POOL_SIZE = 1000;
const MAX_SUGGESTIONS = 50;
const RECENT_DISMISSAL_DAYS = 7;
const MAX_INACTIVE_DAYS = 180;
const MIN_ACCOUNT_QUALITY = 20;
const MAX_SPAM_SCORE = 70;

/**
 * Main recommendation service
 */
class RecommendationService {
  /**
   * Get personalized suggestions for a user
   */
  async getSuggestions(userId, options = {}) {
    const {
      page = 1,
      count = 25,
      forceRefresh = false
    } = options;

    const startTime = Date.now();

    // Check cache first
    if (!forceRefresh) {
      const cached = await recommendationCache.getSuggestions(userId, page);
      if (cached) {
        return {
          suggestions: cached.suggestions,
          pagination: {
            page,
            count,
            hasMore: page < Math.ceil(cached.total / count)
          },
          generatedAt: new Date(cached.cachedAt),
          cacheHit: true,
          responseTime: Date.now() - startTime
        };
      }
    }

    // Generate fresh suggestions
    const suggestions = await this.generateSuggestions(userId);

    // Cache the results
    await recommendationCache.setSuggestions(userId, 1, suggestions.slice(0, count));
    if (suggestions.length > count) {
      await recommendationCache.setSuggestions(userId, 2, suggestions.slice(count, count * 2));
    }

    // Return requested page
    const startIdx = (page - 1) * count;
    const endIdx = startIdx + count;
    const pageSuggestions = suggestions.slice(startIdx, endIdx);

    return {
      suggestions: pageSuggestions,
      pagination: {
        page,
        count,
        totalPages: Math.ceil(suggestions.length / count),
        hasMore: endIdx < suggestions.length
      },
      generatedAt: new Date(),
      cacheHit: false,
      responseTime: Date.now() - startTime
    };
  }

  /**
   * Generate suggestions (cache miss path)
   */
  async generateSuggestions(userId) {
    // STEP 1: Generate candidate pool
    const candidates = await this.generateCandidates(userId);

    // STEP 2: Filter eligible candidates
    const eligible = await this.filterEligible(userId, candidates);

    if (eligible.length === 0) {
      return [];
    }

    // STEP 3: Calculate scores
    const scored = await this.calculateScores(userId, eligible);

    // STEP 4: Rank and apply diversity
    const ranked = await this.rankWithDiversity(userId, scored);

    // STEP 5: Select top N
    return ranked.slice(0, MAX_SUGGESTIONS);
  }

  /**
   * Generate candidate pool from multiple sources
   */
  async generateCandidates(userId) {
    const userOid = mongoose.Types.ObjectId(userId);
    const candidateSet = new Set();

    // Get viewer for contextual queries
    const viewer = await User.findById(userOid)
      .select('location interests school college company followers following')
      .lean();

    if (!viewer) {
      throw new Error('User not found');
    }

    // Parallel candidate generation from all sources
    const [
      socialCandidates,
      interestCandidates,
      behavioralCandidates,
      contextualCandidates,
      discoveryCandidates
    ] = await Promise.all([
      this.getSocialGraphCandidates(userId, 400),
      this.getInterestBasedCandidates(viewer, 300),
      this.getBehavioralCandidates(userId, 200),
      this.getContextualCandidates(viewer, 150),
      this.getDiscoveryCandidates(50)
    ]);

    // Combine all candidates
    [
      ...socialCandidates,
      ...interestCandidates,
      ...behavioralCandidates,
      ...contextualCandidates,
      ...discoveryCandidates
    ].forEach(id => candidateSet.add(String(id)));

    return Array.from(candidateSet);
  }

  /**
   * Get candidates from social graph
   */
  async getSocialGraphCandidates(userId, limit) {
    const userOid = mongoose.Types.ObjectId(userId);
    const candidates = [];

    // Mutual followers (2-hop connections)
    const mutualFollowers = await this.getMutualFollowers(userId, limit / 2);
    candidates.push(...mutualFollowers);

    // Friends of friends (3-hop)
    const friendsOfFriends = await this.getFriendsOfFriends(userId, limit / 2);
    candidates.push(...friendsOfFriends);

    return candidates;
  }

  /**
   * Get mutual followers
   */
  async getMutualFollowers(userId, limit) {
    const userOid = mongoose.Types.ObjectId(userId);

    // Users who follow people I follow
    const result = await Friendship.aggregate([
      // Get people I follow
      { $match: { userId: userOid, status: 'accepted' } },
      // Get their followers
      {
        $lookup: {
          from: 'friendships',
          localField: 'friendId',
          foreignField: 'friendId',
          as: 'theirFollowers'
        }
      },
      { $unwind: '$theirFollowers' },
      // Exclude myself
      { $match: { 'theirFollowers.userId': { $ne: userOid } } },
      // Group and count
      {
        $group: {
          _id: '$theirFollowers.userId',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: limit }
    ]);

    return result.map(r => r._id);
  }

  /**
   * Get friends of friends
   */
  async getFriendsOfFriends(userId, limit) {
    const userOid = mongoose.Types.ObjectId(userId);

    // People followed by people I follow
    const result = await Friendship.aggregate([
      // Get people I follow
      { $match: { userId: userOid, status: 'accepted' } },
      // Get who they follow
      {
        $lookup: {
          from: 'friendships',
          localField: 'friendId',
          foreignField: 'userId',
          as: 'theirFollowing'
        }
      },
      { $unwind: '$theirFollowing' },
      // Exclude myself
      { $match: { 'theirFollowing.friendId': { $ne: userOid } } },
      // Group and count
      {
        $group: {
          _id: '$theirFollowing.friendId',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: limit }
    ]);

    return result.map(r => r._id);
  }

  /**
   * Get interest-based candidates
   */
  async getInterestBasedCandidates(viewer, limit) {
    if (!viewer.interests || viewer.interests.length === 0) {
      return [];
    }

    // Find users with at least 2 common interests
    const candidates = await User.find({
      _id: { $ne: viewer._id },
      interests: { $in: viewer.interests },
      isDeactivated: false,
      deletionScheduledAt: null
    })
      .select('_id')
      .limit(limit)
      .lean();

    return candidates.map(c => c._id);
  }

  /**
   * Get behavioral candidates
   */
  async getBehavioralCandidates(userId, limit) {
    const userOid = mongoose.Types.ObjectId(userId);
    const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days

    // Get users from search history and profile visits
    const [searchedUsers, visitedUsers] = await Promise.all([
      SearchHistory.distinct('searchedUserId', {
        userId: userOid,
        searchedUserId: { $ne: null },
        createdAt: { $gte: sinceDate }
      }),
      ProfileView.distinct('targetId', {
        viewerId: userOid,
        lastViewedAt: { $gte: sinceDate }
      })
    ]);

    return [...new Set([...searchedUsers, ...visitedUsers])].slice(0, limit);
  }

  /**
   * Get contextual candidates
   */
  async getContextualCandidates(viewer, limit) {
    const candidates = [];

    // Same location
    if (hasRealLocation(viewer.location?.coordinates)) {
      const nearbyUsers = await User.find({
        _id: { $ne: viewer._id },
        location: {
          $near: {
            $geometry: viewer.location,
            $maxDistance: 50000 // 50km
          }
        },
        isDeactivated: false
      })
        .select('_id')
        .limit(limit / 2)
        .lean();

      candidates.push(...nearbyUsers.map(u => u._id));
    }

    // Same school/college/company
    const contextFilters = [];
    if (viewer.school) contextFilters.push({ school: viewer.school });
    if (viewer.college) contextFilters.push({ college: viewer.college });
    if (viewer.company) contextFilters.push({ company: viewer.company });

    if (contextFilters.length > 0) {
      const contextualUsers = await User.find({
        _id: { $ne: viewer._id },
        $or: contextFilters,
        isDeactivated: false
      })
        .select('_id')
        .limit(limit / 2)
        .lean();

      candidates.push(...contextualUsers.map(u => u._id));
    }

    // Contact matches
    const contactMatches = await ContactMatch.distinct('matchedUserId', {
      userId: viewer._id
    });
    candidates.push(...contactMatches);

    return [...new Set(candidates)];
  }

  /**
   * Get discovery candidates (new/trending)
   */
  async getDiscoveryCandidates(limit) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Newly joined users
    const newUsers = await User.find({
      createdAt: { $gte: sevenDaysAgo },
      isDeactivated: false,
      accountQualityScore: { $gte: MIN_ACCOUNT_QUALITY }
    })
      .select('_id')
      .sort({ createdAt: -1 })
      .limit(limit / 2)
      .lean();

    // Trending users (high recent follower growth)
    // This requires a separate tracking mechanism - simplified here
    const trendingUsers = await User.find({
      isDeactivated: false,
      followersCount: { $gte: 100 }
    })
      .select('_id')
      .sort({ followersCount: -1 })
      .limit(limit / 2)
      .lean();

    return [...newUsers.map(u => u._id), ...trendingUsers.map(u => u._id)];
  }

  /**
   * Filter eligible candidates
   */
  async filterEligible(userId, candidateIds) {
    const userOid = mongoose.Types.ObjectId(userId);
    const dismissalDate = new Date(Date.now() - RECENT_DISMISSAL_DAYS * 24 * 60 * 60 * 1000);
    const inactiveDate = new Date(Date.now() - MAX_INACTIVE_DAYS * 24 * 60 * 60 * 1000);

    // Batch fetch exclusions
    const [following, dismissed, blocked] = await Promise.all([
      Friendship.distinct('friendId', { userId: userOid, status: 'accepted' }),
      RecommendationImpression.distinct('suggestedUserId', {
        userId: userOid,
        dismissed: true,
        dismissedAt: { $gte: dismissalDate }
      }),
      // Get blocked users from your existing block model
      this.getBlockedUserIds(userId)
    ]);

    const excludeSet = new Set([
      userId,
      ...following.map(String),
      ...dismissed.map(String),
      ...blocked.map(String)
    ]);

    // Filter candidates
    const candidateOids = candidateIds
      .filter(id => !excludeSet.has(String(id)))
      .map(id => mongoose.Types.ObjectId(id));

    // Final eligibility check
    const eligible = await User.find({
      _id: { $in: candidateOids },
      isDeactivated: false,
      deletionScheduledAt: null,
      lastSeen: { $gte: inactiveDate },
      spamScore: { $lte: MAX_SPAM_SCORE },
      accountQualityScore: { $gte: MIN_ACCOUNT_QUALITY },
      'privacySettings.showInSuggestions': { $ne: false }
    })
      .select('_id')
      .lean();

    return eligible.map(u => String(u._id));
  }

  /**
   * Get blocked user IDs (integrate with your existing block system)
   */
  async getBlockedUserIds(userId) {
    // TODO: Integrate with your existing block model
    // For now, return empty array
    return [];
  }

  /**
   * Calculate scores for candidates
   */
  async calculateScores(userId, candidateIds) {
    const userOid = mongoose.Types.ObjectId(userId);

    // Get viewer data
    const viewer = await User.findById(userOid)
      .select('interests location school college company followers following')
      .lean();

    // Batch fetch candidates
    const candidates = await User.find({
      _id: { $in: candidateIds.map(id => mongoose.Types.ObjectId(id)) }
    })
      .select(
        'publicId name age bio photo photos location interests school college company ' +
        'createdAt lastSeen isOnline followersCount followingCount ' +
        'accountQualityScore spamScore isVerified'
      )
      .lean();

    // Batch fetch graph data
    const graphData = await this.fetchGraphDataBatch(userId, candidateIds);

    // Batch fetch engagement data
    const engagementData = await this.fetchEngagementDataBatch(userId, candidateIds);

    // Calculate score for each candidate
    const scored = candidates.map(candidate => {
      const candidateId = String(candidate._id);
      const graph = graphData[candidateId] || {};
      const engagement = engagementData[candidateId] || {};

      const scoreData = this.calculateCandidateScore(viewer, candidate, graph, engagement);

      return {
        ...candidate,
        score: scoreData.score,
        reasons: scoreData.reasons,
        confidence: scoreData.confidence
      };
    });

    return scored;
  }

  /**
   * Fetch graph data in batch
   */
  async fetchGraphDataBatch(userId, candidateIds) {
    const userOid = mongoose.Types.ObjectId(userId);
    const candidateOids = candidateIds.map(id => mongoose.Types.ObjectId(id));

    // Get mutual followers count
    const mutualFollowers = await this.getMutualFollowersCounts(userId, candidateIds);

    // Get friends of friends count
    const friendsOfFriends = await this.getFriendsOfFriendsCounts(userId, candidateIds);

    // Get contact matches
    const contactMatches = await ContactMatch.find({
      userId: userOid,
      matchedUserId: { $in: candidateOids }
    }).lean();

    const contactMatchSet = new Set(contactMatches.map(c => String(c.matchedUserId)));

    // Combine results
    const graphData = {};
    candidateIds.forEach(candidateId => {
      graphData[candidateId] = {
        mutualFollowers: mutualFollowers[candidateId] || 0,
        friendsOfFriends: friendsOfFriends[candidateId] || 0,
        contactMatch: contactMatchSet.has(candidateId)
      };
    });

    return graphData;
  }

  /**
   * Get mutual followers counts for multiple candidates
   */
  async getMutualFollowersCounts(userId, candidateIds) {
    const userOid = mongoose.Types.ObjectId(userId);

    // Get user's followers
    const userFollowers = await Friendship.distinct('userId', {
      friendId: userOid,
      status: 'accepted'
    });

    // Get each candidate's followers
    const candidateFollowers = await Friendship.aggregate([
      {
        $match: {
          friendId: { $in: candidateIds.map(id => mongoose.Types.ObjectId(id)) },
          status: 'accepted'
        }
      },
      {
        $group: {
          _id: '$friendId',
          followers: { $addToSet: '$userId' }
        }
      }
    ]);

    // Calculate intersections
    const results = {};
    const userFollowerSet = new Set(userFollowers.map(String));

    candidateFollowers.forEach(item => {
      const candidateId = String(item._id);
      const intersection = item.followers.filter(f => userFollowerSet.has(String(f)));
      results[candidateId] = intersection.length;
    });

    return results;
  }

  /**
   * Get friends of friends counts
   */
  async getFriendsOfFriendsCounts(userId, candidateIds) {
    const userOid = mongoose.Types.ObjectId(userId);

    // Get people user follows
    const userFollowing = await Friendship.distinct('friendId', {
      userId: userOid,
      status: 'accepted'
    });

    // Get who follows each candidate
    const candidateFollowers = await Friendship.aggregate([
      {
        $match: {
          friendId: { $in: candidateIds.map(id => mongoose.Types.ObjectId(id)) },
          userId: { $in: userFollowing },
          status: 'accepted'
        }
      },
      {
        $group: {
          _id: '$friendId',
          count: { $sum: 1 }
        }
      }
    ]);

    const results = {};
    candidateFollowers.forEach(item => {
      results[String(item._id)] = item.count;
    });

    return results;
  }

  /**
   * Fetch engagement data in batch
   */
  async fetchEngagementDataBatch(userId, candidateIds) {
    const userOid = mongoose.Types.ObjectId(userId);
    const candidateOids = candidateIds.map(id => mongoose.Types.ObjectId(id));

    const [profileVisits, searchHistory] = await Promise.all([
      ProfileView.find({
        viewerId: userOid,
        targetId: { $in: candidateOids }
      })
        .select('targetId viewCount lastViewedAt')
        .lean(),
      SearchHistory.aggregate([
        {
          $match: {
            userId: userOid,
            searchedUserId: { $in: candidateOids }
          }
        },
        {
          $group: {
            _id: '$searchedUserId',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const engagementData = {};

    profileVisits.forEach(pv => {
      engagementData[String(pv.targetId)] = {
        profileVisits: pv.viewCount,
        lastVisit: pv.lastViewedAt
      };
    });

    searchHistory.forEach(sh => {
      const id = String(sh._id);
      if (!engagementData[id]) engagementData[id] = {};
      engagementData[id].searchCount = sh.count;
    });

    return engagementData;
  }

  /**
   * Calculate score for individual candidate
   */
  calculateCandidateScore(viewer, candidate, graph, engagement) {
    let score = 0;
    const reasons = [];

    // 1. Social Graph Signals
    if (graph.mutualFollowers > 0) {
      score += Math.min(graph.mutualFollowers * 2, WEIGHTS.mutualFollowers);
      if (graph.mutualFollowers >= 3) {
        reasons.push(`${graph.mutualFollowers} mutual friends`);
      }
    }

    if (graph.friendsOfFriends > 0) {
      score += Math.min(graph.friendsOfFriends * 0.5, WEIGHTS.friendsOfFriends);
      if (graph.friendsOfFriends > 10) {
        reasons.push(`Friends with ${graph.friendsOfFriends} people you follow`);
      }
    }

    if (graph.contactMatch) {
      score += WEIGHTS.contactMatch;
      reasons.push('In your contacts');
    }

    // 2. Interest Signals
    const commonInterests = this.getCommonInterests(viewer.interests, candidate.interests);
    if (commonInterests.length > 0) {
      score += Math.min(commonInterests.length * 2, WEIGHTS.commonInterests);
      if (commonInterests.length >= 3) {
        reasons.push(`${commonInterests.length} common interests`);
      }
    }

    // 3. Location Similarity
    if (
      hasRealLocation(viewer.location?.coordinates) &&
      hasRealLocation(candidate.location?.coordinates)
    ) {
      const distance = this.calculateDistance(
        viewer.location.coordinates,
        candidate.location.coordinates
      );

      if (distance < 50) {
        const locationScore = (1 - distance / 50) * WEIGHTS.locationSimilarity;
        score += locationScore;
        if (distance < 10) {
          reasons.push('Nearby');
        }
      }
    }

    // 4. Contextual Signals
    if (viewer.school && candidate.school === viewer.school) {
      score += 2;
      reasons.push('Same school');
    }

    if (viewer.college && candidate.college === viewer.college) {
      score += 2;
    }

    if (viewer.company && candidate.company === viewer.company) {
      score += 2;
      reasons.push('Same company');
    }

    // 5. Behavioral Signals
    if (engagement.profileVisits > 0) {
      score += Math.min(engagement.profileVisits * 4, WEIGHTS.profileVisits);
      if (engagement.profileVisits >= 2) {
        reasons.push('You viewed their profile');
      }
    }

    if (engagement.searchCount > 0) {
      score += Math.min(engagement.searchCount * 3, WEIGHTS.searchHistory);
    }

    // 6. Account Quality
    score += (candidate.accountQualityScore / 100) * WEIGHTS.accountQuality;

    // 7. New User Boost
    const accountAgeHours = (Date.now() - candidate.createdAt) / (1000 * 60 * 60);
    if (accountAgeHours < 72) {
      const boost = ((72 - accountAgeHours) / 72) * WEIGHTS.newUserBoost;
      score += boost;
      reasons.push('New to Luvstor');
    }

    // 8. Activity Score
    if (candidate.isOnline) {
      score += 1;
    }

    // 9. Spam Penalty
    if (candidate.spamScore > 0) {
      score *= 1 - candidate.spamScore / 100;
    }

    // Normalize to 0-100
    score = Math.min(Math.max(score, 0), 100);

    return {
      score: Math.round(score * 100) / 100,
      reasons: reasons.slice(0, 3),
      confidence: this.calculateConfidence(graph, engagement)
    };
  }

  /**
   * Get common interests
   */
  getCommonInterests(interests1, interests2) {
    if (!interests1 || !interests2) return [];
    const set1 = new Set(interests1);
    return interests2.filter(i => set1.has(i));
  }

  /**
   * Calculate distance between two points (Haversine formula)
   */
  calculateDistance([lon1, lat1], [lon2, lat2]) {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Calculate confidence score
   */
  calculateConfidence(graph, engagement) {
    let signalCount = 0;
    let signalStrength = 0;

    Object.values({ ...graph, ...engagement }).forEach(value => {
      if (value && value > 0) {
        signalCount++;
        signalStrength += Math.min(value, 10);
      }
    });

    return Math.min(signalCount * 5 + signalStrength, 100);
  }

  /**
   * Rank with diversity filters
   */
  async rankWithDiversity(userId, candidates) {
    // Sort by score descending
    let ranked = candidates.sort((a, b) => b.score - a.score);

    // Apply diversity constraints
    const schoolCounts = {};
    const companyCounts = {};
    const cityCounts = {};

    const diverse = [];

    for (const candidate of ranked) {
      // Check diversity limits
      const school = candidate.school || 'unknown';
      const company = candidate.company || 'unknown';
      const city = candidate.location?.city || 'unknown';

      if (
        (schoolCounts[school] || 0) >= 3 ||
        (companyCounts[company] || 0) >= 2 ||
        (cityCounts[city] || 0) >= 5
      ) {
        continue;
      }

      // Update counts
      schoolCounts[school] = (schoolCounts[school] || 0) + 1;
      companyCounts[company] = (companyCounts[company] || 0) + 1;
      cityCounts[city] = (cityCounts[city] || 0) + 1;

      diverse.push(candidate);

      if (diverse.length >= MAX_SUGGESTIONS) {
        break;
      }
    }

    // Apply freshness penalty
    const recentImpressions = await RecommendationImpression.find({
      userId: mongoose.Types.ObjectId(userId),
      lastShownAt: {
        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      }
    })
      .select('suggestedUserId')
      .lean();

    const recentSet = new Set(recentImpressions.map(i => String(i.suggestedUserId)));

    diverse.forEach(candidate => {
      if (recentSet.has(String(candidate._id))) {
        candidate.score *= 0.8; // Penalty for recently shown
      }
    });

    // Re-sort after freshness adjustment
    return diverse.sort((a, b) => b.score - a.score);
  }

  /**
   * Track impressions (fire-and-forget)
   */
  async trackImpressions(userId, impressions) {
    const userOid = mongoose.Types.ObjectId(userId);
    const now = new Date();

    const bulkOps = impressions.map(imp => ({
      updateOne: {
        filter: {
          userId: userOid,
          suggestedUserId: mongoose.Types.ObjectId(imp.userId)
        },
        update: {
          $set: {
            lastShownAt: now,
            position: imp.position,
            page: imp.page
          },
          $setOnInsert: {
            firstShownAt: now
          },
          $inc: {
            impressionCount: 1
          }
        },
        upsert: true
      }
    }));

    if (bulkOps.length > 0) {
      await RecommendationImpression.bulkWrite(bulkOps);
    }
  }

  /**
   * Track click
   */
  async trackClick(userId, targetId, metadata) {
    await RecommendationImpression.updateOne(
      {
        userId: mongoose.Types.ObjectId(userId),
        suggestedUserId: mongoose.Types.ObjectId(targetId)
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
   * Ignore user (remove from suggestions)
   */
  async ignoreUser(userId, targetId, reason) {
    await RecommendationImpression.updateOne(
      {
        userId: mongoose.Types.ObjectId(userId),
        suggestedUserId: mongoose.Types.ObjectId(targetId)
      },
      {
        $set: {
          dismissed: true,
          dismissedAt: new Date(),
          dismissReason: reason
        }
      },
      { upsert: true }
    );

    // Invalidate cache
    await recommendationCache.invalidateSuggestions(userId);
  }

  /**
   * Record feedback
   */
  async recordFeedback(userId, feedbackData) {
    // Store feedback for ML training
    // TODO: Create Feedback model
    return 'fb_' + Date.now();
  }

  /**
   * Refresh suggestions (clear cache)
   */
  async refreshSuggestions(userId) {
    await recommendationCache.invalidateSuggestions(userId);
    const suggestions = await this.generateSuggestions(userId);
    return { count: suggestions.length };
  }
}

module.exports = new RecommendationService();
