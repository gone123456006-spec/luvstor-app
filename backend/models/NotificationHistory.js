/**
 * NotificationHistory Model
 * 
 * Tracks all sent notifications for analytics and history
 */

const mongoose = require('mongoose');

const notificationHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    
    // Notification type
    type: {
      type: String,
      enum: [
        'recommendation', // Our new intelligent suggestions
        'chat',
        'social',
        'call',
        'wallet',
        'system',
        'promo'
      ],
      required: true,
      index: true
    },
    
    // Trigger that caused this notification
    triggerType: {
      type: String,
      enum: [
        'new_nearby',
        'mutual_followers',
        'common_interests',
        'friend_followed',
        'profile_visitor',
        'contact_match',
        'trending',
        'active_creator',
        'daily_refresh',
        'weekly_refresh',
        'manual' // Manually triggered
      ]
    },
    
    // Notification content
    title: {
      type: String,
      required: true
    },
    body: {
      type: String,
      required: true
    },
    icon: String,
    imageUrl: String,
    
    // For recommendation notifications
    suggestedUserIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    
    // Deep link for app navigation
    deepLink: String,
    
    // Additional data payload
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // Delivery tracking
    deliveryStatus: {
      type: String,
      enum: ['pending', 'delivered', 'failed'],
      default: 'pending',
      index: true
    },
    deliveredAt: Date,
    failureReason: String,
    
    // Engagement tracking
    viewed: {
      type: Boolean,
      default: false,
      index: true
    },
    viewedAt: Date,
    
    clicked: {
      type: Boolean,
      default: false,
      index: true
    },
    clickedAt: Date,
    
    // Conversion tracking (for recommendations)
    converted: {
      type: Boolean,
      default: false
    },
    convertedAt: Date,
    convertedAction: {
      type: String,
      enum: ['followed', 'messaged', 'profile_visit']
    },
    
    // Scheduling
    scheduledFor: Date,
    
    // Device info
    deviceType: {
      type: String,
      enum: ['ios', 'android', 'web']
    },
    
    // A/B testing
    variant: String,
    
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: false
  }
);

// Compound indexes for efficient queries
notificationHistorySchema.index({ userId: 1, type: 1, createdAt: -1 });
notificationHistorySchema.index({ userId: 1, clicked: 1, createdAt: -1 });
notificationHistorySchema.index({ type: 1, deliveryStatus: 1, createdAt: -1 });
notificationHistorySchema.index({ userId: 1, suggestedUserIds: 1 });

// TTL index: auto-delete notifications older than 90 days
notificationHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

// Virtual for engagement metrics
notificationHistorySchema.virtual('engagementScore').get(function() {
  let score = 0;
  if (this.viewed) score += 33;
  if (this.clicked) score += 34;
  if (this.converted) score += 33;
  return score;
});

module.exports = mongoose.model('NotificationHistory', notificationHistorySchema);
