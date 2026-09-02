# Suggested For You - Recommendation System Design Document

## Executive Summary

This document outlines the design and implementation of a production-grade recommendation system for Luvstor, capable of serving personalized user suggestions to 100M+ users with sub-100ms latency.

**System Goals:**
- Deliver highly personalized user recommendations
- Scale to 100M+ users with consistent performance
- Support real-time and batch processing
- Integrate seamlessly with existing architecture
- Provide explainable recommendations

---

## 1. Complete Recommendation Workflow

### High-Level Flow

```
User Opens App
    ↓
Check Redis Cache (TTL: 1 hour)
    ↓
If Cache Miss:
    ↓
Fetch User Profile & Graph Data
    ↓
Generate Candidate Pool (1000-5000 users)
    ↓
Calculate Recommendation Scores (Multi-Signal)
    ↓
Rank & Filter Top 50
    ↓
Store in Redis Cache
    ↓
Return Top 25 to Client
    ↓
Track Impressions & Interactions
    ↓
Background: Update ML Models & Scores
```

### Detailed Workflow Steps

1. **Request Reception**
   - User opens "Suggested For You" section
   - Client sends GET request with pagination params
   - Auth middleware validates token

2. **Cache Check**
   - Query Redis for `suggestions:{userId}:{page}`
   - If found and fresh (< 1 hour): return immediately
   - If stale or missing: proceed to generation

3. **Candidate Generation** (Multi-Stage Funnel)
   ```
   Stage 1: Social Graph Candidates
   - Mutual followers (2nd degree connections)
   - Friends of friends (3rd degree)
   - Followers of people you follow
   
   Stage 2: Interest-Based Candidates
   - Users with common interests
   - Users who liked similar content
   - Users in same groups/communities
   
   Stage 3: Behavioral Candidates
   - Users you searched for
   - Users whose profiles you visited
   - Users who engaged with your content
   
   Stage 4: Contextual Candidates
   - Same location/city
   - Same school/company
   - Newly joined users (boost)
   - Trending users
   
   Stage 5: Contact Matching (Privacy-Respecting)
   - Phone contact matches
   - Email contact matches
   ```

4. **Eligibility Filtering**
   - Remove current user
   - Remove already following
   - Remove blocked/blocking users
   - Remove muted users
   - Remove fake/spam accounts (ML-based)
   - Remove inactive accounts (no activity > 6 months)
   - Remove deactivated/deleted accounts
   - Respect privacy settings

5. **Score Calculation** (Parallel Processing)
   - For each candidate, calculate 25+ signals
   - Apply weighted formula
   - Normalize scores to 0-100 range

6. **Ranking & Selection**
   - Sort by recommendation score (DESC)
   - Apply diversity filters (prevent homogeneous results)
   - Apply freshness (don't repeat recent suggestions)
   - Select top 50 for cache

7. **Response Delivery**
   - Return top 25 for current page
   - Include explanation metadata
   - Track impression in background

8. **Background Processing**
   - Record impression (userId, suggestedUserId, timestamp)
   - Update engagement metrics
   - Trigger ML model retraining (batch, nightly)
   - Refresh stale caches

---

## 2. Backend Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│  (React Native App - iOS/Android)                               │
└───────────────────┬─────────────────────────────────────────────┘
                    │ HTTPS/WSS
┌───────────────────▼─────────────────────────────────────────────┐
│                      API Gateway Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Load Balancer│  │   Rate       │  │    Auth      │         │
│  │   (Nginx)    │  │  Limiter     │  │  Middleware  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└───────────────────┬─────────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────────────────┐
│                   Application Layer (Node.js)                    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Express REST API Servers                       │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │ │
│  │  │ /api/       │  │ /api/       │  │ /api/       │       │ │
│  │  │ suggestions │  │ users       │  │ engagement  │       │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │           Recommendation Engine Core                        │ │
│  │  ┌──────────────────┐  ┌──────────────────┐               │ │
│  │  │ Candidate        │  │ Score Calculator │               │ │
│  │  │ Generator        │  │ (Multi-Signal)   │               │ │
│  │  └──────────────────┘  └──────────────────┘               │ │
│  │  ┌──────────────────┐  ┌──────────────────┐               │ │
│  │  │ Ranking Engine   │  │ Diversity Filter │               │ │
│  │  └──────────────────┘  └──────────────────┘               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Background Workers (BullMQ)                    │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │ │
│  │  │ Cache        │  │ Score        │  │ ML Model     │    │ │
│  │  │ Refresh      │  │ Precompute   │  │ Training     │    │ │
│  │  │ Worker       │  │ Worker       │  │ Worker       │    │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘    │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────┬─────────────────┬───────────────────────────┘
                    │                 │
        ┌───────────▼──────┐   ┌─────▼────────┐
        │                  │   │              │
┌───────▼───────┐  ┌───────▼──────┐  ┌───────▼──────────┐
│  Redis Cache  │  │   MongoDB    │  │  Python ML       │
│  (Hot Data)   │  │  (Primary DB)│  │  Service         │
│               │  │              │  │  (TensorFlow)    │
│ - Suggestions │  │ - Users      │  │                  │
│ - Scores      │  │ - Graph Data │  │ - Model Training │
│ - Sessions    │  │ - Events     │  │ - Prediction     │
└───────────────┘  └──────────────┘  └──────────────────┘
```

### Component Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                   Recommendation Engine                         │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                 Candidate Generation Layer             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │   Social     │  │   Interest   │  │  Behavioral │  │   │
│  │  │   Graph      │  │    Based     │  │    Based    │  │   │
│  │  │   Generator  │  │   Generator  │  │  Generator  │  │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  │   │
│  └────────────────────────────────────────────────────────┘   │
│                            ↓                                    │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                   Scoring Layer                        │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────┐ │   │
│  │  │ Social   │  │ Interest │  │ Behavior │  │ ML    │ │   │
│  │  │ Signals  │  │ Signals  │  │ Signals  │  │ Score │ │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └───────┘ │   │
│  │                      Weight Aggregator                 │   │
│  └────────────────────────────────────────────────────────┘   │
│                            ↓                                    │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                    Ranking Layer                       │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │   │
│  │  │   Score      │  │  Diversity   │  │  Freshness  │ │   │
│  │  │   Ranker     │  │   Filter     │  │   Filter    │ │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │   │
│  └────────────────────────────────────────────────────────┘   │
│                            ↓                                    │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                   Delivery Layer                       │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │   │
│  │  │   Cache      │  │  Pagination  │  │  Tracking   │ │   │
│  │  │   Manager    │  │   Handler    │  │   Service   │ │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │   │
│  └────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

### Technology Stack

- **API Server**: Node.js v18+ with Express.js
- **Database**: MongoDB v6+ (with sharding for scale)
- **Cache**: Redis v7+ (with Redis Cluster)
- **Queue**: BullMQ with Redis
- **ML Service**: Python 3.10+ with TensorFlow/PyTorch
- **Search**: MongoDB Atlas Search (or Elasticsearch)
- **Monitoring**: Prometheus + Grafana
- **Logging**: Winston + ELK Stack

---

## 3. Database Schema Design

### MongoDB Collections

#### 1. Users Collection (Existing - Extended)
```javascript
{
  _id: ObjectId,
  publicId: String,
  name: String,
  email: String,
  phone: String,
  age: Number,
  gender: String,
  bio: String,
  photo: String,
  photos: [String],
  location: {
    type: "Point",
    coordinates: [Number, Number] // [lng, lat]
  },
  city: String,
  
  // Profile completeness
  profileCompleteness: Number, // 0-100
  
  // Social graph
  followersCount: Number,
  followingCount: Number,
  
  // Interests & preferences
  interests: [String],
  relationshipGoal: String,
  
  // Education & Work
  school: String,
  college: String,
  company: String,
  
  // Account quality
  isVerified: Boolean,
  accountQualityScore: Number, // 0-100, ML-based
  spamScore: Number, // 0-100, higher = more likely spam
  
  // Activity
  lastSeen: Date,
  isOnline: Boolean,
  activityScore: Number, // 0-100
  
  // Recommendation metadata
  recommendationOptOut: Boolean,
  privacySettings: {
    showInSuggestions: Boolean,
    allowContactMatching: Boolean
  },
  
  // Contacts (hashed for privacy)
  hashedPhoneContacts: [String], // SHA256 hashes
  hashedEmailContacts: [String],
  
  createdAt: Date,
  updatedAt: Date,
  
  // Indexes
  indexes: [
    { location: "2dsphere" },
    { interests: 1 },
    { city: 1 },
    { school: 1 },
    { college: 1 },
    { company: 1 },
    { isOnline: 1, lastSeen: -1 },
    { accountQualityScore: -1 },
    { createdAt: -1 },
    { followersCount: -1 }
  ]
}
```

#### 2. Followers Collection (Graph Data)
```javascript
{
  _id: ObjectId,
  followerId: ObjectId, // Who is following
  followingId: ObjectId, // Who is being followed
  createdAt: Date,
  
  // Compound indexes for graph queries
  indexes: [
    { followerId: 1, followingId: 1 }, // Unique
    { followingId: 1, createdAt: -1 }, // Get followers
    { followerId: 1, createdAt: -1 }   // Get following
  ]
}
```

#### 3. RecommendationScores Collection (Precomputed)
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  candidateId: ObjectId,
  
  // Individual signal scores
  signals: {
    mutualFollowers: Number,
    mutualFollowing: Number,
    friendsOfFriends: Number,
    commonInterests: Number,
    locationSimilarity: Number,
    schoolMatch: Number,
    collegeMatch: Number,
    companyMatch: Number,
    profileVisits: Number,
    searchAppearances: Number,
    engagementScore: Number,
    contactMatch: Number,
    accountQuality: Number,
    activityScore: Number,
    followBackProbability: Number,
    recentlyJoinedBoost: Number,
    trendingBoost: Number
  },
  
  // Aggregated score
  totalScore: Number, // 0-100
  mlScore: Number, // Optional ML-predicted score
  
  // Explanation for transparency
  explanation: {
    topReasons: [String], // ["2 mutual friends", "Common interest: Music"]
    confidence: Number // 0-100
  },
  
  // Metadata
  computedAt: Date,
  version: Number, // For algorithm versioning
  
  indexes: [
    { userId: 1, totalScore: -1, computedAt: -1 },
    { userId: 1, candidateId: 1 }, // Unique
    { computedAt: 1 } // TTL index: 7 days
  ]
}
```

#### 4. RecommendationImpressions Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  suggestedUserId: ObjectId,
  
  // Impression details
  firstShownAt: Date,
  lastShownAt: Date,
  impressionCount: Number,
  
  // User actions
  clicked: Boolean,
  clickedAt: Date,
  followed: Boolean,
  followedAt: Date,
  dismissed: Boolean,
  dismissedAt: Date,
  
  // Context
  position: Number, // Position in the list (1-25)
  page: Number,
  source: String, // 'suggested', 'trending', 'nearby'
  
  indexes: [
    { userId: 1, suggestedUserId: 1 }, // Unique
    { userId: 1, lastShownAt: -1 },
    { suggestedUserId: 1, followed: 1 },
    { lastShownAt: 1 } // TTL index: 30 days
  ]
}
```

#### 5. ProfileVisits Collection (Existing - Extended)
```javascript
{
  _id: ObjectId,
  viewerId: ObjectId,
  targetId: ObjectId,
  
  firstViewedAt: Date,
  lastViewedAt: Date,
  viewCount: Number,
  
  // Engagement depth
  viewDurationSeconds: Number,
  photosViewed: Number,
  bioRead: Boolean,
  
  indexes: [
    { viewerId: 1, targetId: 1 }, // Unique
    { targetId: 1, lastViewedAt: -1 },
    { viewerId: 1, lastViewedAt: -1 },
    { lastViewedAt: 1 } // TTL: 90 days
  ]
}
```

#### 6. SearchHistory Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  query: String,
  searchedUserId: ObjectId, // If user was clicked
  
  createdAt: Date,
  
  indexes: [
    { userId: 1, createdAt: -1 },
    { searchedUserId: 1, createdAt: -1 },
    { createdAt: 1 } // TTL: 90 days
  ]
}
```

#### 7. UserEngagement Collection (Aggregated)
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  targetUserId: ObjectId,
  
  // Engagement metrics
  likes: Number,
  comments: Number,
  shares: Number,
  saves: Number,
  storyViews: Number,
  reelViews: Number,
  totalWatchTimeSeconds: Number,
  messagesExchanged: Number,
  
  // Timestamps
  firstEngagementAt: Date,
  lastEngagementAt: Date,
  
  // Computed
  engagementScore: Number, // 0-100
  
  indexes: [
    { userId: 1, targetUserId: 1 }, // Unique
    { userId: 1, engagementScore: -1 },
    { lastEngagementAt: 1 } // TTL: 180 days
  ]
}
```

#### 8. ContactMatches Collection (Privacy-Preserved)
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  matchedUserId: ObjectId,
  matchType: String, // 'phone' or 'email'
  hashedContact: String, // SHA256 hash
  
  createdAt: Date,
  
  indexes: [
    { userId: 1, matchedUserId: 1, matchType: 1 }, // Unique
    { userId: 1, createdAt: -1 }
  ]
}
```

#### 9. RecommendationCache Collection (Redis Alternative)
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  page: Number,
  
  suggestions: [{
    userId: ObjectId,
    score: Number,
    reasons: [String]
  }],
  
  generatedAt: Date,
  expiresAt: Date, // TTL: 1 hour
  
  indexes: [
    { userId: 1, page: 1 }, // Unique
    { expiresAt: 1 } // TTL index
  ]
}
```

#### 10. MLTrainingData Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  candidateId: ObjectId,
  
  // Features (normalized 0-1)
  features: {
    mutualFollowers: Number,
    commonInterests: Number,
    locationDistance: Number,
    // ... 50+ features
  },
  
  // Label (did user follow?)
  followed: Boolean,
  followedWithinHours: Number,
  
  // Metadata
  impressionAt: Date,
  outcomeAt: Date,
  
  indexes: [
    { userId: 1, impressionAt: -1 },
    { followed: 1 },
    { impressionAt: -1 }
  ]
}
```

### Data Volume Estimates (100M Users)

| Collection | Est. Documents | Avg Size | Total Storage |
|-----------|---------------|----------|---------------|
| Users | 100M | 2 KB | 200 GB |
| Followers | 5B | 100 B | 500 GB |
| RecommendationScores | 500M | 500 B | 250 GB |
| RecommendationImpressions | 10B | 200 B | 2 TB |
| ProfileVisits | 2B | 150 B | 300 GB |
| SearchHistory | 5B | 100 B | 500 GB |
| UserEngagement | 1B | 300 B | 300 GB |
| **Total** | | | **~4 TB** |

---

## 4. Recommendation Score Calculation

### Signal Categories & Weights

```javascript
const SIGNAL_WEIGHTS = {
  // Social Graph (40% total)
  mutualFollowers: 12.0,
  mutualFollowing: 8.0,
  friendsOfFriends: 6.0,
  followersOfFollowing: 5.0,
  contactMatch: 9.0,
  
  // Interests & Affinity (25% total)
  commonInterests: 10.0,
  sameHashtags: 5.0,
  sameGroups: 5.0,
  locationSimilarity: 3.0,
  schoolMatch: 2.0,
  
  // Behavioral Signals (20% total)
  profileVisits: 8.0,
  searchHistory: 6.0,
  engagementScore: 6.0,
  
  // Content Interaction (10% total)
  likes: 2.0,
  comments: 3.0,
  shares: 2.0,
  saves: 1.0,
  watchTime: 2.0,
  
  // Account Quality (5% total)
  accountQuality: 3.0,
  profileCompleteness: 1.0,
  followBackProbability: 1.0,
  
  // Freshness & Trends (5% total - time-decaying)
  recentlyJoined: 2.0,
  trending: 2.0,
  activityScore: 1.0
};

// Total: 105 (normalized to 100)
```

### Score Calculation Algorithm

```javascript
/**
 * Calculate recommendation score for a candidate
 * Time Complexity: O(1) - all signals precomputed
 */
function calculateRecommendationScore(viewer, candidate, signals) {
  let score = 0;
  const reasons = [];
  
  // 1. Social Graph Signals
  if (signals.mutualFollowers > 0) {
    const points = Math.min(signals.mutualFollowers * 2, 12); // Cap at 12
    score += points;
    if (signals.mutualFollowers > 5) {
      reasons.push(`${signals.mutualFollowers} mutual friends`);
    }
  }
  
  if (signals.mutualFollowing > 0) {
    score += Math.min(signals.mutualFollowing * 1.5, 8);
  }
  
  if (signals.friendsOfFriends > 0) {
    score += Math.min(signals.friendsOfFriends * 0.5, 6);
    if (signals.friendsOfFriends > 10) {
      reasons.push(`Friends with ${signals.friendsOfFriends} people you follow`);
    }
  }
  
  if (signals.followersOfFollowing > 0) {
    score += Math.min(signals.followersOfFollowing * 0.3, 5);
  }
  
  if (signals.contactMatch) {
    score += 9;
    reasons.push('In your contacts');
  }
  
  // 2. Interest & Affinity Signals
  const commonInterestsCount = signals.commonInterests || 0;
  if (commonInterestsCount > 0) {
    score += Math.min(commonInterestsCount * 2, 10);
    if (commonInterestsCount >= 3) {
      reasons.push(`${commonInterestsCount} common interests`);
    }
  }
  
  if (signals.sameHashtags > 0) {
    score += Math.min(signals.sameHashtags * 0.5, 5);
  }
  
  if (signals.sameGroups > 0) {
    score += Math.min(signals.sameGroups * 2.5, 5);
    if (signals.sameGroups > 0) {
      reasons.push('In same community');
    }
  }
  
  // Location similarity (0-1, where 1 = same city)
  if (signals.locationSimilarity > 0.8) {
    score += signals.locationSimilarity * 3;
    reasons.push('Same city');
  }
  
  if (signals.schoolMatch) {
    score += 2;
    reasons.push('Same school');
  }
  
  if (signals.collegeMatch) {
    score += 2;
  }
  
  if (signals.companyMatch) {
    score += 2;
    reasons.push('Same company');
  }
  
  // 3. Behavioral Signals
  if (signals.profileVisits > 0) {
    score += Math.min(signals.profileVisits * 4, 8);
    if (signals.profileVisits >= 2) {
      reasons.push('You viewed their profile');
    }
  }
  
  if (signals.searchAppearances > 0) {
    score += Math.min(signals.searchAppearances * 3, 6);
  }
  
  // Engagement score (0-100, normalized)
  if (signals.engagementScore > 0) {
    score += (signals.engagementScore / 100) * 6;
  }
  
  // 4. Content Interaction Signals
  score += Math.min(signals.likes * 0.5, 2);
  score += Math.min(signals.comments * 1, 3);
  score += Math.min(signals.shares * 1, 2);
  score += Math.min(signals.saves * 0.5, 1);
  
  // Watch time (normalized minutes)
  if (signals.watchTimeMinutes > 0) {
    score += Math.min(signals.watchTimeMinutes * 0.1, 2);
  }
  
  // 5. Account Quality Signals
  score += (candidate.accountQualityScore / 100) * 3;
  score += (candidate.profileCompleteness / 100) * 1;
  score += (signals.followBackProbability / 100) * 1;
  
  // 6. Freshness & Trending (Time-Decaying)
  const accountAgeHours = (Date.now() - candidate.createdAt) / (1000 * 60 * 60);
  if (accountAgeHours < 72) { // New user within 3 days
    const boost = (72 - accountAgeHours) / 72 * 2;
    score += boost;
    reasons.push('New to Luvstor');
  }
  
  if (signals.trending) {
    score += 2;
    reasons.push('Trending');
  }
  
  score += (candidate.activityScore / 100) * 1;
  
  // 7. Apply ML Score (if available) - Weighted 20%
  if (signals.mlScore !== undefined) {
    score = score * 0.8 + (signals.mlScore / 100 * 20);
  }
  
  // 8. Penalties
  // Spam score penalty
  if (candidate.spamScore > 50) {
    score *= (1 - candidate.spamScore / 100);
  }
  
  // Normalize to 0-100
  score = Math.min(Math.max(score, 0), 100);
  
  return {
    score: Math.round(score * 100) / 100,
    reasons: reasons.slice(0, 3), // Top 3 reasons
    confidence: calculateConfidence(signals)
  };
}

function calculateConfidence(signals) {
  // Confidence based on signal diversity and strength
  let signalCount = 0;
  let signalStrength = 0;
  
  Object.keys(signals).forEach(key => {
    if (signals[key] > 0) {
      signalCount++;
      signalStrength += Math.min(signals[key], 10);
    }
  });
  
  // More diverse signals = higher confidence
  return Math.min((signalCount * 5 + signalStrength), 100);
}
```

---

## 5. Hybrid Recommendation Algorithm

### Algorithm: Multi-Stage Candidate Ranking

```
Input: userId, requestedCount (default 25)
Output: List of recommended users with scores

STAGE 1: Candidate Generation (Target: 1000-5000 candidates)
┌─────────────────────────────────────────────────────────┐
│ 1. Social Graph Candidates (Weight: 40%)               │
│    - Get mutual followers (2-hop connections)          │
│    - Get friends of friends (3-hop)                    │
│    - Get followers of people user follows              │
│    Target: 500-1000 candidates                         │
├─────────────────────────────────────────────────────────┤
│ 2. Interest-Based Candidates (Weight: 25%)            │
│    - Users with overlapping interests (≥2 common)      │
│    - Users in same groups/communities                  │
│    - Users with same hashtags                          │
│    Target: 300-500 candidates                          │
├─────────────────────────────────────────────────────────┤
│ 3. Behavioral Candidates (Weight: 20%)                │
│    - Users viewer searched for (last 90 days)          │
│    - Users whose profiles viewer visited               │
│    - Users who engaged with viewer's content           │
│    Target: 200-400 candidates                          │
├─────────────────────────────────────────────────────────┤
│ 4. Contextual Candidates (Weight: 10%)                │
│    - Same location (city/region)                       │
│    - Same school/college/company                       │
│    - Contact matches                                   │
│    Target: 100-200 candidates                          │
├─────────────────────────────────────────────────────────┤
│ 5. Discovery Candidates (Weight: 5%)                  │
│    - Newly joined users (< 7 days)                     │
│    - Trending users (high recent engagement)           │
│    - Random exploration (prevent filter bubble)        │
│    Target: 50-100 candidates                           │
└─────────────────────────────────────────────────────────┘

STAGE 2: Eligibility Filtering
┌─────────────────────────────────────────────────────────┐
│ Remove:                                                 │
│ - Self                                                  │
│ - Already following                                     │
│ - Blocked/blocking users                               │
│ - Muted users                                          │
│ - Fake accounts (spamScore > 70)                       │
│ - Inactive accounts (lastSeen > 180 days)              │
│ - Deactivated/deleted accounts                         │
│ - Recently dismissed suggestions (< 7 days)            │
│ - Privacy: users who opted out of suggestions          │
│                                                         │
│ After filtering: ~500-2000 eligible candidates         │
└─────────────────────────────────────────────────────────┘

STAGE 3: Score Calculation (Parallel)
┌─────────────────────────────────────────────────────────┐
│ For each eligible candidate:                           │
│                                                         │
│ 1. Fetch precomputed signals (RecommendationScores)    │
│ 2. If stale (> 24 hours), recompute in background      │
│ 3. Calculate weighted score (see formula above)        │
│ 4. Attach explanation metadata                         │
│                                                         │
│ Optimization: Batch fetch in chunks of 100             │
│ Time: ~50-100ms for 1000 candidates                    │
└─────────────────────────────────────────────────────────┘

STAGE 4: Ranking & Diversity
┌─────────────────────────────────────────────────────────┐
│ 1. Sort by score (DESC)                                │
│ 2. Apply diversity filters:                            │
│    - Max 3 users from same school                      │
│    - Max 2 users from same company                     │
│    - Max 5 users from same city                        │
│    - Ensure gender balance (if applicable)             │
│ 3. Apply freshness:                                    │
│    - Deprioritize users shown in last 7 days           │
│    - Boost unseen users                                │
│ 4. Apply position-aware ranking:                       │
│    - Top 5: High-confidence, strong signals            │
│    - Middle 15: Mix of confidence levels               │
│    - Bottom 5: Exploration/discovery                   │
└─────────────────────────────────────────────────────────┘

STAGE 5: Final Selection
┌─────────────────────────────────────────────────────────┐
│ 1. Select top 50 for cache                             │
│ 2. Return top 25 for current page                      │
│ 3. Store in Redis cache (TTL: 1 hour)                  │
│ 4. Track impressions in background                     │
└─────────────────────────────────────────────────────────┘
```

### Pseudocode Implementation

```python
def getRecommendations(userId, page=1, count=25):
    """
    Main recommendation function
    Time Complexity: O(n log n) where n = candidate count
    """
    # STEP 1: Check cache
    cacheKey = f"suggestions:{userId}:{page}"
    cached = redis.get(cacheKey)
    if cached and not isStale(cached):
        return cached
    
    # STEP 2: Generate candidates
    candidates = generateCandidates(userId)
    # Time: O(1) - mostly index lookups
    # Returns: 1000-5000 candidate IDs
    
    # STEP 3: Apply eligibility filters
    eligible = filterEligible(userId, candidates)
    # Time: O(n) where n = candidates
    # Returns: ~500-2000 eligible IDs
    
    # STEP 4: Calculate scores (parallel)
    scored = []
    for batch in chunk(eligible, 100):
        scores = calculateScoresBatch(userId, batch)
        scored.extend(scores)
    # Time: O(n) with parallel processing
    
    # STEP 5: Rank and apply diversity
    ranked = rankWithDiversity(scored)
    # Time: O(n log n) for sorting
    
    # STEP 6: Select top 50 and cache
    topSuggestions = ranked[:50]
    redis.setex(cacheKey, 3600, topSuggestions)
    
    # STEP 7: Track impressions (async)
    trackImpressions(userId, topSuggestions[:count])
    
    # STEP 8: Return paginated results
    startIdx = (page - 1) * count
    return topSuggestions[startIdx:startIdx + count]


def generateCandidates(userId):
    """
    Multi-source candidate generation
    """
    candidates = Set()
    
    # 1. Social graph candidates (40% target)
    mutualFollowers = getMutualFollowers(userId, limit=500)
    friendsOfFriends = getFriendsOfFriends(userId, limit=500)
    candidates.add_all(mutualFollowers)
    candidates.add_all(friendsOfFriends)
    
    # 2. Interest-based candidates (25% target)
    userInterests = getUserInterests(userId)
    interestMatches = findUsersWithInterests(
        userInterests, 
        minCommon=2, 
        limit=400
    )
    candidates.add_all(interestMatches)
    
    # 3. Behavioral candidates (20% target)
    searchHistory = getSearchHistory(userId, days=90, limit=200)
    profileVisits = getProfileVisits(userId, days=90, limit=200)
    candidates.add_all(searchHistory)
    candidates.add_all(profileVisits)
    
    # 4. Contextual candidates (10% target)
    user = getUser(userId)
    locationMatches = getUsersByLocation(
        user.location, 
        maxDistanceKm=50, 
        limit=200
    )
    schoolMatches = getUsersBySchool(user.school, limit=100)
    contactMatches = getContactMatches(userId, limit=100)
    candidates.add_all(locationMatches)
    candidates.add_all(schoolMatches)
    candidates.add_all(contactMatches)
    
    # 5. Discovery candidates (5% target)
    newUsers = getNewUsers(days=7, limit=50)
    trendingUsers = getTrendingUsers(limit=50)
    randomUsers = getRandomEligibleUsers(limit=50)
    candidates.add_all(newUsers)
    candidates.add_all(trendingUsers)
    candidates.add_all(randomUsers)
    
    return list(candidates)


def filterEligible(userId, candidates):
    """
    Remove ineligible candidates
    Time: O(n) with batched queries
    """
    # Batch fetch to minimize queries
    following = getFollowingIds(userId)
    blocked = getBlockedIds(userId)
    mutedUsers = getMutedIds(userId)
    recentDismissals = getRecentDismissals(userId, days=7)
    
    eligible = []
    for candidateId in candidates:
        # Skip self
        if candidateId == userId:
            continue
        
        # Skip already following
        if candidateId in following:
            continue
        
        # Skip blocked/muted
        if candidateId in blocked or candidateId in mutedUsers:
            continue
        
        # Skip recent dismissals
        if candidateId in recentDismissals:
            continue
        
        # Check account status
        candidate = getUser(candidateId)
        if not candidate or candidate.isDeactivated:
            continue
        
        # Check activity
        daysSinceActive = (now() - candidate.lastSeen) / DAY_MS
        if daysSinceActive > 180:
            continue
        
        # Check spam score
        if candidate.spamScore > 70:
            continue
        
        # Check privacy settings
        if candidate.privacySettings.showInSuggestions == False:
            continue
        
        eligible.append(candidateId)
    
    return eligible


def calculateScoresBatch(userId, candidateIds):
    """
    Batch score calculation
    Time: O(n) with single query
    """
    # Try to fetch precomputed scores
    precomputed = RecommendationScores.find({
        userId: userId,
        candidateId: { $in: candidateIds },
        computedAt: { $gt: now() - 24 * HOUR_MS }
    })
    
    precomputedMap = {}
    for score in precomputed:
        precomputedMap[score.candidateId] = score
    
    results = []
    recomputeQueue = []
    
    for candidateId in candidateIds:
        if candidateId in precomputedMap:
            # Use cached score
            results.append(precomputedMap[candidateId])
        else:
            # Recompute needed
            recomputeQueue.append(candidateId)
    
    # Recompute stale/missing scores
    if recomputeQueue:
        viewer = getUser(userId)
        candidates = getUsers(recomputeQueue)
        
        for candidate in candidates:
            signals = computeSignals(viewer, candidate)
            scoreData = calculateRecommendationScore(
                viewer, 
                candidate, 
                signals
            )
            
            # Save for future use
            RecommendationScores.upsert({
                userId: userId,
                candidateId: candidate._id,
                signals: signals,
                totalScore: scoreData.score,
                explanation: scoreData.reasons,
                computedAt: now()
            })
            
            results.append(scoreData)
    
    return results


def rankWithDiversity(scoredCandidates):
    """
    Apply diversity and freshness constraints
    Time: O(n log n) for sorting + O(n) for filtering
    """
    # Sort by score descending
    sorted_candidates = sorted(
        scoredCandidates, 
        key=lambda x: x.score, 
        reverse=True
    )
    
    # Apply diversity constraints
    schoolCounts = {}
    companyCounts = {}
    cityCounts = {}
    
    diverse_results = []
    
    for candidate in sorted_candidates:
        # Check diversity limits
        if (schoolCounts.get(candidate.school, 0) >= 3 or
            companyCounts.get(candidate.company, 0) >= 2 or
            cityCounts.get(candidate.city, 0) >= 5):
            continue
        
        # Update counts
        schoolCounts[candidate.school] = schoolCounts.get(candidate.school, 0) + 1
        companyCounts[candidate.company] = companyCounts.get(candidate.company, 0) + 1
        cityCounts[candidate.city] = cityCounts.get(candidate.city, 0) + 1
        
        diverse_results.append(candidate)
        
        if len(diverse_results) >= 50:
            break
    
    # Apply freshness boost
    recentImpressions = getRecentImpressions(userId, days=7)
    
    for result in diverse_results:
        if result.candidateId in recentImpressions:
            # Penalize recently shown
            result.score *= 0.8
    
    # Re-sort after freshness adjustment
    final_results = sorted(
        diverse_results, 
        key=lambda x: x.score, 
        reverse=True
    )
    
    return final_results
```

---

## 6. Weighted Ranking Formula

### Mathematical Formula

```
RecommendationScore(v, c) = Σ(i=1 to n) [wi × fi(v, c)]

Where:
- v = viewer (user requesting recommendations)
- c = candidate (potential recommendation)
- wi = weight for signal i
- fi(v, c) = signal function returning normalized value [0, 1]
- n = number of signals (~25)

Constraints:
- Σ wi = 100 (weights sum to 100)
- 0 ≤ RecommendationScore ≤ 100
- Each fi is normalized to [0, 1] range
```

### Expanded Formula

```
Score = 
  // Social Graph (40 points max)
  + min(mutualFollowers × 2, 12)
  + min(mutualFollowing × 1.5, 8)
  + min(friendsOfFriends × 0.5, 6)
  + min(followersOfFollowing × 0.3, 5)
  + (contactMatch ? 9 : 0)
  
  // Interests (25 points max)
  + min(commonInterests × 2, 10)
  + min(sameHashtags × 0.5, 5)
  + min(sameGroups × 2.5, 5)
  + (locationSimilarity × 3)
  + (schoolMatch ? 2 : 0)
  
  // Behavior (20 points max)
  + min(profileVisits × 4, 8)
  + min(searchAppearances × 3, 6)
  + (engagementScore / 100 × 6)
  
  // Content (10 points max)
  + min(likes × 0.5, 2)
  + min(comments × 1, 3)
  + min(shares × 1, 2)
  + min(saves × 0.5, 1)
  + min(watchTimeMinutes × 0.1, 2)
  
  // Quality (5 points max)
  + (accountQuality / 100 × 3)
  + (profileCompleteness / 100 × 1)
  + (followBackProbability / 100 × 1)
  
  // Freshness (5 points max, time-decaying)
  + (newUserBoost × 2)           // Decays over 72 hours
  + (trending ? 2 : 0)
  + (activityScore / 100 × 1)
  
  // ML Enhancement (20% weight if available)
  × 0.8 + (mlScore / 100 × 20)
  
  // Penalties
  × (1 - spamScore / 100)        // Reduce score for spam
  × freshnessMultiplier          // 0.8 if shown recently
```

### Configurable Weights (Environment Variables)

```javascript
// backend/.env
RECOMMENDATION_WEIGHT_MUTUAL_FOLLOWERS=12
RECOMMENDATION_WEIGHT_MUTUAL_FOLLOWING=8
RECOMMENDATION_WEIGHT_FRIENDS_OF_FRIENDS=6
RECOMMENDATION_WEIGHT_CONTACT_MATCH=9
RECOMMENDATION_WEIGHT_COMMON_INTERESTS=10
RECOMMENDATION_WEIGHT_LOCATION=3
RECOMMENDATION_WEIGHT_PROFILE_VISITS=8
RECOMMENDATION_WEIGHT_SEARCH=6
RECOMMENDATION_WEIGHT_ENGAGEMENT=6
RECOMMENDATION_WEIGHT_QUALITY=3
RECOMMENDATION_WEIGHT_NEW_USER=2
RECOMMENDATION_WEIGHT_TRENDING=2
RECOMMENDATION_ML_WEIGHT=20
```

---

## 7. Machine Learning Enhancement

### ML Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   ML Training Pipeline                       │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────┐  │
│  │   Feature    │ → │   Model      │ → │   Model     │  │
│  │  Engineering │   │   Training   │   │  Deployment │  │
│  └──────────────┘    └──────────────┘    └─────────────┘  │
│        ↑                    ↑                    ↓          │
│        │                    │                    │          │
│  ┌─────┴────────┐    ┌──────┴──────┐    ┌───────▼──────┐  │
│  │ Training     │    │ Validation  │    │  Prediction  │  │
│  │ Data         │    │ & Testing   │    │   Service    │  │
│  │ Collection   │    │   Data      │    │   (API)      │  │
│  └──────────────┘    └─────────────┘    └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Feature Engineering (50+ Features)

```python
class RecommendationFeatures:
    """
    Feature extraction for ML model
    All features normalized to [0, 1] range
    """
    
    def extract_features(viewer, candidate, graph_data, engagement_data):
        features = {}
        
        # 1. Social Graph Features (10 features)
        features['mutual_followers_norm'] = normalize(
            graph_data.mutual_followers, 
            max_val=100
        )
        features['mutual_following_norm'] = normalize(
            graph_data.mutual_following, 
            max_val=50
        )
        features['friends_of_friends_norm'] = normalize(
            graph_data.friends_of_friends, 
            max_val=200
        )
        features['follower_ratio'] = candidate.followers / (candidate.following + 1)
        features['following_ratio'] = candidate.following / (candidate.followers + 1)
        features['graph_distance'] = 1.0 / (graph_data.shortest_path + 1)
        features['common_followers_ratio'] = (
            graph_data.mutual_followers / viewer.followers
        )
        features['is_contact_match'] = 1.0 if graph_data.contact_match else 0.0
        
        # 2. Interest Affinity Features (8 features)
        features['common_interests_count'] = normalize(
            len(set(viewer.interests) & set(candidate.interests)),
            max_val=10
        )
        features['interest_jaccard'] = jaccard_similarity(
            viewer.interests, 
            candidate.interests
        )
        features['same_hashtags'] = normalize(
            graph_data.common_hashtags, 
            max_val=20
        )
        features['same_groups'] = normalize(
            graph_data.common_groups, 
            max_val=5
        )
        
        # 3. Behavioral Features (10 features)
        features['profile_visit_count'] = normalize(
            engagement_data.profile_visits, 
            max_val=10
        )
        features['search_count'] = normalize(
            engagement_data.search_appearances, 
            max_val=5
        )
        features['avg_visit_duration'] = normalize(
            engagement_data.avg_visit_duration_sec, 
            max_val=300
        )
        features['photos_viewed'] = normalize(
            engagement_data.photos_viewed, 
            max_val=10
        )
        features['bio_read'] = 1.0 if engagement_data.bio_read else 0.0
        
        # 4. Engagement Features (8 features)
        features['likes_given'] = normalize(engagement_data.likes, max_val=50)
        features['comments_given'] = normalize(engagement_data.comments, max_val=20)
        features['shares'] = normalize(engagement_data.shares, max_val=10)
        features['saves'] = normalize(engagement_data.saves, max_val=10)
        features['watch_time'] = normalize(
            engagement_data.watch_time_minutes, 
            max_val=60
        )
        features['engagement_score'] = engagement_data.score / 100.0
        features['message_exchanges'] = normalize(
            engagement_data.messages, 
            max_val=100
        )
        
        # 5. Demographic Features (8 features)
        features['location_distance_km'] = normalize(
            calculate_distance(viewer.location, candidate.location),
            max_val=100,
            inverse=True  # Closer = higher
        )
        features['same_city'] = 1.0 if viewer.city == candidate.city else 0.0
        features['same_school'] = 1.0 if viewer.school == candidate.school else 0.0
        features['same_college'] = 1.0 if viewer.college == candidate.college else 0.0
        features['same_company'] = 1.0 if viewer.company == candidate.company else 0.0
        features['age_difference'] = 1.0 - normalize(
            abs(viewer.age - candidate.age), 
            max_val=20
        )
        
        # 6. Account Quality Features (6 features)
        features['account_quality'] = candidate.account_quality_score / 100.0
        features['profile_completeness'] = candidate.profile_completeness / 100.0
        features['is_verified'] = 1.0 if candidate.is_verified else 0.0
        features['spam_score'] = candidate.spam_score / 100.0  # Lower is better
        features['activity_score'] = candidate.activity_score / 100.0
        features['follower_count_log'] = np.log1p(candidate.followers) / 10.0
        
        # 7. Temporal Features (5 features)
        account_age_days = (now() - candidate.created_at) / DAY_MS
        features['account_age_norm'] = 1.0 - normalize(
            account_age_days, 
            max_val=365
        )
        features['is_new_user'] = 1.0 if account_age_days < 7 else 0.0
        
        last_seen_hours = (now() - candidate.last_seen) / HOUR_MS
        features['recency'] = 1.0 - normalize(last_seen_hours, max_val=168)
        features['is_online'] = 1.0 if candidate.is_online else 0.0
        features['is_trending'] = 1.0 if candidate.is_trending else 0.0
        
        return features


def normalize(value, max_val, inverse=False):
    """Normalize value to [0, 1]"""
    normalized = min(value / max_val, 1.0)
    return 1.0 - normalized if inverse else normalized


def jaccard_similarity(set_a, set_b):
    """Jaccard similarity coefficient"""
    if not set_a or not set_b:
        return 0.0
    intersection = len(set(set_a) & set(set_b))
    union = len(set(set_a) | set(set_b))
    return intersection / union if union > 0 else 0.0
```

### Model Architecture

```python
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

class RecommendationModel:
    """
    Deep Learning model for recommendation scoring
    Architecture: Wide & Deep Neural Network
    """
    
    def __init__(self, num_features=50):
        self.num_features = num_features
        self.model = self._build_model()
    
    def _build_model(self):
        """
        Wide & Deep Architecture:
        - Wide: Linear model for memorization
        - Deep: DNN for generalization
        """
        # Input layer
        inputs = keras.Input(shape=(self.num_features,), name='features')
        
        # Wide component (linear)
        wide = layers.Dense(1, activation='linear', name='wide')(inputs)
        
        # Deep component (neural network)
        deep = layers.Dense(128, activation='relu', name='deep_1')(inputs)
        deep = layers.BatchNormalization()(deep)
        deep = layers.Dropout(0.3)(deep)
        
        deep = layers.Dense(64, activation='relu', name='deep_2')(deep)
        deep = layers.BatchNormalization()(deep)
        deep = layers.Dropout(0.3)(deep)
        
        deep = layers.Dense(32, activation='relu', name='deep_3')(deep)
        deep = layers.BatchNormalization()(deep)
        deep = layers.Dropout(0.2)(deep)
        
        deep = layers.Dense(1, activation='linear', name='deep_out')(deep)
        
        # Combine wide and deep
        combined = layers.Add(name='wide_deep_add')([wide, deep])
        
        # Output: probability of follow (sigmoid)
        output = layers.Activation('sigmoid', name='output')(combined)
        
        # Build model
        model = keras.Model(inputs=inputs, outputs=output)
        
        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=0.001),
            loss='binary_crossentropy',
            metrics=[
                'accuracy',
                keras.metrics.AUC(name='auc'),
                keras.metrics.Precision(name='precision'),
                keras.metrics.Recall(name='recall')
            ]
        )
        
        return model
    
    def train(self, X_train, y_train, X_val, y_val, epochs=10):
        """
        Train the model with early stopping
        """
        early_stopping = keras.callbacks.EarlyStopping(
            monitor='val_auc',
            patience=3,
            restore_best_weights=True
        )
        
        history = self.model.fit(
            X_train, y_train,
            validation_data=(X_val, y_val),
            epochs=epochs,
            batch_size=256,
            callbacks=[early_stopping],
            verbose=1
        )
        
        return history
    
    def predict(self, features):
        """
        Predict follow probability
        Returns: score 0-100
        """
        probability = self.model.predict(features)
        return probability * 100  # Convert to 0-100 scale
```

### Training Pipeline

```python
class RecommendationMLPipeline:
    """
    End-to-end ML pipeline for recommendations
    """
    
    def __init__(self):
        self.model = RecommendationModel(num_features=50)
        self.feature_extractor = RecommendationFeatures()
    
    def collect_training_data(self, days=30):
        """
        Collect labeled training data
        Positive: User followed within 48 hours of impression
        Negative: User did not follow
        """
        # Query impressions from last N days
        impressions = RecommendationImpressions.find({
            'firstShownAt': {
                '$gte': datetime.now() - timedelta(days=days)
            }
        })
        
        training_samples = []
        
        for impression in impressions:
            viewer = get_user(impression.userId)
            candidate = get_user(impression.suggestedUserId)
            
            # Extract features
            features = self.feature_extractor.extract_features(
                viewer, 
                candidate,
                get_graph_data(viewer.id, candidate.id),
                get_engagement_data(viewer.id, candidate.id)
            )
            
            # Label: did user follow?
            label = 1 if impression.followed else 0
            
            training_samples.append({
                'features': features,
                'label': label,
                'weight': self._calculate_sample_weight(impression)
            })
        
        return training_samples
    
    def _calculate_sample_weight(self, impression):
        """
        Weight recent samples higher
        Weight positive samples higher (class imbalance)
        """
        # Time decay: more recent = higher weight
        days_old = (datetime.now() - impression.firstShownAt).days
        time_weight = np.exp(-0.05 * days_old)  # Exponential decay
        
        # Class weight: positive samples rarer
        class_weight = 3.0 if impression.followed else 1.0
        
        return time_weight * class_weight
    
    def train_model(self):
        """
        Full training pipeline
        Runs nightly as cron job
        """
        print("Collecting training data...")
        samples = self.collect_training_data(days=90)
        
        # Split features and labels
        X = np.array([s['features'] for s in samples])
        y = np.array([s['label'] for s in samples])
        weights = np.array([s['weight'] for s in samples])
        
        # Train/val split (80/20)
        split_idx = int(0.8 * len(X))
        X_train, X_val = X[:split_idx], X[split_idx:]
        y_train, y_val = y[:split_idx], y[split_idx:]
        
        print(f"Training on {len(X_train)} samples...")
        print(f"Validation on {len(X_val)} samples...")
        print(f"Positive rate: {y.mean():.2%}")
        
        # Train model
        history = self.model.train(
            X_train, y_train,
            X_val, y_val,
            epochs=20
        )
        
        # Evaluate
        val_auc = max(history.history['val_auc'])
        print(f"Best validation AUC: {val_auc:.4f}")
        
        # Save model
        self.model.model.save('recommendation_model.h5')
        
        return history
    
    def predict_score(self, viewer_id, candidate_id):
        """
        Predict recommendation score using trained model
        """
        viewer = get_user(viewer_id)
        candidate = get_user(candidate_id)
        
        features = self.feature_extractor.extract_features(
            viewer,
            candidate,
            get_graph_data(viewer_id, candidate_id),
            get_engagement_data(viewer_id, candidate_id)
        )
        
        feature_vector = np.array([list(features.values())])
        score = self.model.predict(feature_vector)
        
        return score[0]  # 0-100
```

### Continuous Improvement Strategy

1. **A/B Testing Framework**
```python
def ab_test_recommendations():
    """
    Split traffic between rule-based and ML-based
    Track conversion metrics
    """
    users = get_active_users()
    
    for user in users:
        # 50/50 split
        variant = 'ml' if hash(user.id) % 2 == 0 else 'rule_based'
        
        if variant == 'ml':
            suggestions = get_ml_recommendations(user.id)
        else:
            suggestions = get_rule_based_recommendations(user.id)
        
        # Track which variant was shown
        track_experiment(user.id, variant, suggestions)
```

2. **Metrics to Track**
- Click-through rate (CTR)
- Follow-through rate (FTR)
- Time to follow
- Engagement after follow
- User satisfaction (surveys)

3. **Model Retraining Schedule**
- Full retrain: Weekly (Sunday night)
- Incremental update: Daily
- Online learning: Per-batch (if needed)

4. **Feature Importance Analysis**
```python
def analyze_feature_importance():
    """
    Identify which signals drive recommendations
    """
    # Use SHAP (SHapley Additive exPlanations)
    import shap
    
    explainer = shap.DeepExplainer(model, X_train[:100])
    shap_values = explainer.shap_values(X_test[:100])
    
    # Plot feature importance
    shap.summary_plot(shap_values, X_test[:100])
```

---

*Continuing in next message due to length...*
