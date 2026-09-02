# Intelligent Push Notification System - Implementation Guide

## Overview

This guide provides step-by-step instructions to integrate the AI-powered "Suggested For You" notification system into your Luvstor app.

---

## ✅ What's Been Created

### 1. Core Implementation Files (3 files)

**Service** (`services/intelligentNotificationService.js`)
- ✅ Eligibility checking (10+ criteria)
- ✅ Profile selection algorithm
- ✅ Optimal timing calculator
- ✅ Engagement score tracking
- ✅ Notification fatigue detection
- ✅ Content generation (10 trigger types)
- ✅ Analytics and tracking

**Models** (2 files)
- ✅ `NotificationHistory.js` - Complete notification tracking
- ✅ `NotificationPreference.js` - User-specific preferences

### 2. Documentation (1 file)

**Design Document** (`NOTIFICATION_SYSTEM_DESIGN.md`)
- ✅ System architecture diagrams
- ✅ Intelligent notification engine design
- ✅ 10 notification triggers with detection algorithms
- ✅ Who/When/What/How many decision logic
- ✅ Notification messages and templates

---

## 📋 Integration Steps

### Phase 1: Database Setup (10 minutes)

#### Step 1.1: Create Database Indexes

Run this script to create all necessary indexes:

```bash
cd backend
node scripts/createNotificationIndexes.js
```

Create the script file:

```javascript
// backend/scripts/createNotificationIndexes.js
const mongoose = require('mongoose');
require('dotenv').config();

const NotificationHistory = require('../models/NotificationHistory');
const NotificationPreference = require('../models/NotificationPreference');

async function createIndexes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    console.log('Creating notification indexes...');
    await Promise.all([
      NotificationHistory.createIndexes(),
      NotificationPreference.createIndexes()
    ]);
    
    console.log('✅ All notification indexes created successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Index creation failed:', error);
    process.exit(1);
  }
}

createIndexes();
```

#### Step 1.2: Add Environment Variables

Add to `backend/.env`:

```env
# Notification System Configuration
MAX_DAILY_RECOMMENDATION_NOTIFS=2
MIN_HOURS_BETWEEN_NOTIFS=8
WEEKLY_MAX_NOTIFS=10
NOTIF_COOLDOWN_DAYS=30
MIN_ENGAGEMENT_SCORE=20
MIN_REC_SCORE_FOR_NOTIF=50
MIN_CONFIDENCE_FOR_NOTIF=60

# Notification Timing
DEFAULT_OPTIMAL_HOURS=9,12,18,20
QUIET_HOURS_START=22
QUIET_HOURS_END=8
```

---

### Phase 2: Queue Workers Setup (15 minutes)

#### Step 2.1: Create Notification Workers

Create `backend/workers/intelligentNotificationWorkers.js`:

```javascript
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const intelligentNotificationService = require('../services/intelligentNotificationService');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Queues
const notificationQueue = new Queue('intelligent-notifications', { connection });
const triggerQueue = new Queue('notification-triggers', { connection });

/**
 * Worker 1: Process Scheduled Notifications
 */
const notificationWorker = new Worker(
  'intelligent-notifications',
  async (job) => {
    const { userId, notification, immediate } = job.data;
    
    try {
      await intelligentNotificationService.sendNotification(userId, notification);
      return { success: true, userId };
    } catch (error) {
      console.error(`Notification worker error for user ${userId}:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 50, // Process 50 notifications concurrently
    limiter: {
      max: 1000,
      duration: 60000 // Max 1000 per minute
    }
  }
);

/**
 * Worker 2: Process Trigger Detection
 */
const triggerWorker = new Worker(
  'notification-triggers',
  async (job) => {
    const { userId, triggerType, candidateId } = job.data;
    
    try {
      const result = await intelligentNotificationService.evaluateAndSendRecommendation(
        userId,
        {
          triggerType,
          immediate: false,
          candidateId
        }
      );
      
      return result;
    } catch (error) {
      console.error(`Trigger worker error for user ${userId}:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 20
  }
);

/**
 * Schedule daily refresh for all active users
 */
async function scheduleDailyRefreshForAllUsers() {
  const User = require('../models/User');
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  // Get active users in batches
  const batchSize = 1000;
  let skip = 0;
  let hasMore = true;
  
  while (hasMore) {
    const users = await User.find({
      isDeactivated: false,
      lastSeen: { $gte: sevenDaysAgo }
    })
      .select('_id')
      .skip(skip)
      .limit(batchSize)
      .lean();
    
    if (users.length === 0) {
      hasMore = false;
      break;
    }
    
    // Queue trigger detection for each user
    await Promise.all(
      users.map(user =>
        triggerQueue.add(
          'daily-refresh',
          {
            userId: user._id,
            triggerType: 'daily_refresh'
          },
          {
            attempts: 2,
            backoff: {
              type: 'exponential',
              delay: 300000 // 5 minutes
            }
          }
        )
      )
    );
    
    skip += batchSize;
  }
  
  console.log(`Scheduled daily refresh for ${skip} users`);
}

/**
 * Schedule recurring jobs
 */
async function scheduleRecurringJobs() {
  // Daily refresh at 9 AM
  await triggerQueue.add(
    'daily-refresh-all',
    {},
    {
      repeat: {
        pattern: '0 9 * * *' // Every day at 9 AM
      }
    }
  );
  
  // Weekly refresh on Sundays at 10 AM
  await triggerQueue.add(
    'weekly-refresh-all',
    {},
    {
      repeat: {
        pattern: '0 10 * * 0' // Every Sunday at 10 AM
      }
    }
  );
}

module.exports = {
  notificationQueue,
  triggerQueue,
  scheduleDailyRefreshForAllUsers,
  scheduleRecurringJobs
};
```

#### Step 2.2: Register Workers in Server

Add to `backend/index.js`:

```javascript
// Add at the top with other requires
const {
  scheduleRecurringJobs
} = require('./workers/intelligentNotificationWorkers');

// Add after server starts (inside the main async function)
// Schedule recurring notification jobs
scheduleRecurringJobs().catch(err => {
  console.error('Failed to schedule notification jobs:', err);
});
```

---

### Phase 3: API Routes (20 minutes)

#### Step 3.1: Create Notification Routes

Create `backend/routes/intelligentNotifications.js`:

```javascript
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const intelligentNotificationService = require('../services/intelligentNotificationService');
const NotificationHistory = require('../models/NotificationHistory');
const NotificationPreference = require('../models/NotificationPreference');

/**
 * POST /api/notifications/intelligent/trigger
 * Manually trigger notification evaluation for a user
 */
router.post('/trigger', auth, async (req, res) => {
  try {
    const { triggerType, candidateId } = req.body;
    
    const result = await intelligentNotificationService.evaluateAndSendRecommendation(
      req.userId,
      {
        triggerType: triggerType || 'daily_refresh',
        immediate: true,
        candidateId
      }
    );
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('POST /notifications/intelligent/trigger error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger notification'
    });
  }
});

/**
 * POST /api/notifications/intelligent/viewed
 * Mark notification as viewed
 */
router.post('/viewed', auth, async (req, res) => {
  try {
    const { notificationId } = req.body;
    
    await intelligentNotificationService.markAsViewed(req.userId, notificationId);
    
    res.json({
      success: true,
      message: 'Notification marked as viewed'
    });
  } catch (error) {
    console.error('POST /notifications/intelligent/viewed error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark as viewed'
    });
  }
});

/**
 * POST /api/notifications/intelligent/clicked
 * Mark notification as clicked
 */
router.post('/clicked', auth, async (req, res) => {
  try {
    const { notificationId } = req.body;
    
    await intelligentNotificationService.markAsClicked(req.userId, notificationId);
    
    res.json({
      success: true,
      message: 'Notification marked as clicked'
    });
  } catch (error) {
    console.error('POST /notifications/intelligent/clicked error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark as clicked'
    });
  }
});

/**
 * GET /api/notifications/intelligent/history
 * Get notification history
 */
router.get('/history', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;
    
    const [notifications, total] = await Promise.all([
      NotificationHistory.find({
        userId: req.userId,
        type: 'recommendation'
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      NotificationHistory.countDocuments({
        userId: req.userId,
        type: 'recommendation'
      })
    ]);
    
    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('GET /notifications/intelligent/history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history'
    });
  }
});

/**
 * GET /api/notifications/intelligent/preferences
 * Get user notification preferences
 */
router.get('/preferences', auth, async (req, res) => {
  try {
    const prefs = await NotificationPreference.getOrCreate(req.userId);
    
    res.json({
      success: true,
      data: prefs
    });
  } catch (error) {
    console.error('GET /notifications/intelligent/preferences error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch preferences'
    });
  }
});

/**
 * PUT /api/notifications/intelligent/preferences
 * Update notification preferences
 */
router.put('/preferences', auth, async (req, res) => {
  try {
    const updates = req.body;
    
    const prefs = await NotificationPreference.findOneAndUpdate(
      { userId: req.userId },
      { $set: updates, updatedAt: new Date() },
      { new: true, upsert: true }
    );
    
    res.json({
      success: true,
      data: prefs
    });
  } catch (error) {
    console.error('PUT /notifications/intelligent/preferences error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update preferences'
    });
  }
});

/**
 * GET /api/notifications/intelligent/analytics
 * Get notification analytics (admin)
 */
router.get('/analytics', auth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const endDate = new Date();
    
    const analytics = await intelligentNotificationService.getAnalytics(
      startDate,
      endDate
    );
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('GET /notifications/intelligent/analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics'
    });
  }
});

module.exports = router;
```

#### Step 3.2: Register Routes

Add to `backend/index.js`:

```javascript
const intelligentNotificationRoutes = require('./routes/intelligentNotifications');
app.use('/api/notifications/intelligent', intelligentNotificationRoutes);
```

---

### Phase 4: Trigger Detection Integration (15 minutes)

#### Step 4.1: Add Trigger Hooks

Add these hooks to relevant parts of your app:

**When a new user registers** (in `routes/auth.js` after signup):

```javascript
const { triggerQueue } = require('../workers/intelligentNotificationWorkers');

// After user signup, notify nearby users
User.find({
  location: {
    $near: {
      $geometry: newUser.location,
      $maxDistance: 10000
    }
  },
  _id: { $ne: newUser._id }
})
  .select('_id')
  .limit(50)
  .lean()
  .then(nearbyUsers => {
    nearbyUsers.forEach(user => {
      triggerQueue.add('new-nearby', {
        userId: user._id,
        triggerType: 'new_nearby',
        candidateId: newUser._id
      });
    });
  });
```

**When someone views a profile** (in `routes/users.js`):

```javascript
// After recording profile view, check if threshold reached
const viewCount = await ProfileView.findOne({
  viewerId: req.userId,
  targetId: profileId
}).select('viewCount').lean();

if (viewCount && viewCount.viewCount >= 3) {
  triggerQueue.add('profile-visitor', {
    userId: profileId, // Notify the profile owner
    triggerType: 'profile_visitor',
    candidateId: req.userId
  });
}
```

**When someone follows another user** (in `routes/friends.js`):

```javascript
// After follow, notify mutual friends
const mutualFriends = await getMutualFriends(followerId, followedId);

mutualFriends.forEach(friendId => {
  triggerQueue.add('friend-followed', {
    userId: friendId,
    triggerType: 'friend_followed',
    candidateId: followedId
  });
});
```

---

### Phase 5: Frontend Integration (30 minutes)

#### Step 5.1: Add Notification Handlers

Create `frontend/services/intelligentNotifications.ts`:

```typescript
import { API_URL } from './api';

export interface NotificationPreferences {
  recommendations: boolean;
  recommendationSettings: {
    maxDaily: number;
    preferredHours: number[];
    quietStart: number;
    quietEnd: number;
    smartTiming: boolean;
    triggers: {
      newNearby: boolean;
      mutualFollowers: boolean;
      commonInterests: boolean;
      friendFollowed: boolean;
      profileVisitor: boolean;
      contactMatch: boolean;
      trending: boolean;
      activeCreator: boolean;
      dailyRefresh: boolean;
      weeklyRefresh: boolean;
    };
  };
}

export async function getNotificationPreferences(
  token: string
): Promise<NotificationPreferences> {
  const response = await fetch(
    `${API_URL}/notifications/intelligent/preferences`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to fetch preferences');
  }
  
  const data = await response.json();
  return data.data;
}

export async function updateNotificationPreferences(
  token: string,
  preferences: Partial<NotificationPreferences>
): Promise<void> {
  const response = await fetch(
    `${API_URL}/notifications/intelligent/preferences`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(preferences)
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to update preferences');
  }
}

export async function markNotificationViewed(
  token: string,
  notificationId: string
): Promise<void> {
  await fetch(`${API_URL}/notifications/intelligent/viewed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ notificationId })
  });
}

export async function markNotificationClicked(
  token: string,
  notificationId: string
): Promise<void> {
  await fetch(`${API_URL}/notifications/intelligent/clicked`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ notificationId })
  });
}
```

#### Step 5.2: Handle Notification Deep Links

Update `frontend/utils/push.ts`:

```typescript
// Add to your notification handler
export function handleNotificationReceived(notification: any) {
  const { type, data } = notification;
  
  if (type === 'recommendation' && data.suggestedUserIds) {
    // Mark as viewed
    markNotificationViewed(token, notification.id);
    
    // Navigate to suggested profile
    const userId = data.suggestedUserIds[0];
    router.push(`/profile/${userId}`);
    
    // Track click
    markNotificationClicked(token, notification.id);
  }
}
```

---

### Phase 6: Testing (20 minutes)

#### Step 6.1: Manual Testing

```bash
# Start Redis
redis-server

# Start backend
cd backend
npm run dev

# Test notification trigger
curl -X POST "http://localhost:5000/api/notifications/intelligent/trigger" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"triggerType": "daily_refresh"}'

# Get notification preferences
curl -X GET "http://localhost:5000/api/notifications/intelligent/preferences" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Get notification analytics
curl -X GET "http://localhost:5000/api/notifications/intelligent/analytics?days=7" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Step 6.2: Test Notification Eligibility

Create `backend/scripts/testNotificationEligibility.js`:

```javascript
const intelligentNotificationService = require('../services/intelligentNotificationService');

async function testEligibility(userId) {
  console.log(`Testing eligibility for user: ${userId}`);
  
  const eligibility = await intelligentNotificationService.isEligibleForNotification(userId);
  console.log('Eligibility result:', eligibility);
  
  if (eligibility.eligible) {
    console.log('✅ User is eligible for notifications');
    console.log(`Engagement score: ${eligibility.engagementScore}`);
  } else {
    console.log(`❌ User is NOT eligible. Reason: ${eligibility.reason}`);
  }
}

// Usage: node testNotificationEligibility.js USER_ID
const userId = process.argv[2];
testEligibility(userId).then(() => process.exit(0));
```

---

## 📊 Monitoring & Analytics

### Key Metrics to Track

1. **Delivery Metrics**:
   - Total notifications sent
   - Delivery success rate
   - Failed deliveries

2. **Engagement Metrics**:
   - View rate
   - Click-through rate (CTR)
   - Conversion rate (follows after notification)

3. **User Experience**:
   - Notification fatigue rate
   - Opt-out rate
   - Timing accuracy

4. **System Performance**:
   - Queue processing time
   - Worker throughput
   - Redis cache hit rate

### Analytics Dashboard Query

```javascript
// Get comprehensive analytics
const analytics = await NotificationHistory.aggregate([
  {
    $match: {
      type: 'recommendation',
      createdAt: { $gte: last30Days }
    }
  },
  {
    $group: {
      _id: '$triggerType',
      total: { $sum: 1 },
      delivered: {
        $sum: { $cond: [{ $eq: ['$deliveryStatus', 'delivered'] }, 1, 0] }
      },
      viewed: { $sum: { $cond: ['$viewed', 1, 0] } },
      clicked: { $sum: { $cond: ['$clicked', 1, 0] } },
      converted: { $sum: { $cond: ['$converted', 1, 0] } }
    }
  },
  {
    $project: {
      triggerType: '$_id',
      total: 1,
      delivered: 1,
      viewed: 1,
      clicked: 1,
      converted: 1,
      deliveryRate: { $multiply: [{ $divide: ['$delivered', '$total'] }, 100] },
      viewRate: { $multiply: [{ $divide: ['$viewed', '$delivered'] }, 100] },
      ctr: { $multiply: [{ $divide: ['$clicked', '$delivered'] }, 100] },
      conversionRate: { $multiply: [{ $divide: ['$converted', '$clicked'] }, 100] }
    }
  }
]);
```

---

## 🎯 Optimization Tips

### 1. Improve Engagement Score Calculation

Monitor which activities correlate best with notification engagement and adjust weights:

```javascript
const score = Math.min(
  profileVisits * 2 +      // Adjust these weights
  searches * 3 +
  follows * 10 +
  notificationClicks * 8,
  100
);
```

### 2. Optimize Send Times

Analyze notification history to find user-specific optimal hours:

```javascript
// Get best hour for user based on historical CTR
const bestHours = await NotificationHistory.aggregate([
  { $match: { userId, clicked: true } },
  { $group: {
    _id: { $hour: '$createdAt' },
    clicks: { $sum: 1 }
  }},
  { $sort: { clicks: -1 } },
  { $limit: 3 }
]);
```

### 3. A/B Test Notification Messages

```javascript
const variants = ['A', 'B'];
const variant = variants[Math.floor(Math.random() * variants.length)];

const messages = {
  A: 'Someone near you shares your interests',
  B: 'We found someone you might like nearby'
};

// Track variant in notification history
await NotificationHistory.create({
  ...notification,
  variant
});
```

---

## 🚨 Common Issues & Solutions

### Issue 1: Notifications not sending

**Check:**
- Redis server running
- BullMQ workers started
- FCM credentials configured
- Device tokens active

### Issue 2: Too many/too few notifications

**Solution:**
- Adjust `MAX_DAILY_RECOMMENDATIONS` in env
- Modify eligibility criteria
- Fine-tune engagement score thresholds

### Issue 3: Poor engagement

**Solution:**
- Analyze trigger performance
- Optimize send times
- Improve recommendation quality
- Test different message variants

### Issue 4: High opt-out rate

**Solution:**
- Reduce frequency
- Improve targeting
- Add more granular preferences
- Respect quiet hours better

---

## ✅ Success Checklist

- [ ] Database models created and indexed
- [ ] Environment variables configured
- [ ] Queue workers running
- [ ] API routes integrated
- [ ] Trigger hooks added
- [ ] Frontend handlers implemented
- [ ] FCM configured
- [ ] Testing completed
- [ ] Analytics dashboard created
- [ ] Monitoring alerts set up

---

## 📚 Additional Resources

- **Design Document**: `NOTIFICATION_SYSTEM_DESIGN.md` - Complete architecture
- **Service Code**: `services/intelligentNotificationService.js` - Core logic
- **Models**: `models/NotificationHistory.js`, `models/NotificationPreference.js`
- **Firebase Docs**: https://firebase.google.com/docs/cloud-messaging
- **BullMQ Docs**: https://docs.bullmq.io/

---

**🎉 Your intelligent notification system is ready for production!**

The system will automatically:
- Detect 10 different triggers
- Evaluate user eligibility
- Select best profiles to suggest
- Optimize send timing
- Track engagement
- Learn and improve over time

Users will receive timely, relevant, non-spammy notifications that drive real engagement.
