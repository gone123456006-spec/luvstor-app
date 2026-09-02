/**
 * NotificationPreference Model
 * 
 * User-specific notification preferences
 */

const mongoose = require('mongoose');

const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    
    // Category preferences
    recommendations: {
      type: Boolean,
      default: true
    },
    chat: {
      type: Boolean,
      default: true
    },
    social: {
      type: Boolean,
      default: true
    },
    calls: {
      type: Boolean,
      default: true
    },
    wallet: {
      type: Boolean,
      default: true
    },
    system: {
      type: Boolean,
      default: true
    },
    promotions: {
      type: Boolean,
      default: true
    },
    
    // Recommendation-specific settings
    recommendationSettings: {
      // Maximum per day
      maxDaily: {
        type: Number,
        default: 2,
        min: 0,
        max: 5
      },
      
      // Preferred times (hours in 24h format)
      preferredHours: {
        type: [Number],
        default: [9, 12, 18, 20],
        validate: {
          validator: function(arr) {
            return arr.every(h => h >= 0 && h <= 23);
          },
          message: 'Hours must be between 0 and 23'
        }
      },
      
      // Quiet hours (do not disturb)
      quietStart: {
        type: Number,
        default: 22, // 10 PM
        min: 0,
        max: 23
      },
      quietEnd: {
        type: Number,
        default: 8, // 8 AM
        min: 0,
        max: 23
      },
      
      // Enable smart timing (AI-optimized send times)
      smartTiming: {
        type: Boolean,
        default: true
      },
      
      // Trigger preferences
      triggers: {
        newNearby: { type: Boolean, default: true },
        mutualFollowers: { type: Boolean, default: true },
        commonInterests: { type: Boolean, default: true },
        friendFollowed: { type: Boolean, default: true },
        profileVisitor: { type: Boolean, default: true },
        contactMatch: { type: Boolean, default: true },
        trending: { type: Boolean, default: true },
        activeCreator: { type: Boolean, default: true },
        dailyRefresh: { type: Boolean, default: true },
        weeklyRefresh: { type: Boolean, default: true }
      }
    },
    
    // Global settings
    pauseUntil: {
      type: Date,
      default: null
    },
    
    // Device-specific settings
    devices: [{
      deviceId: String,
      platform: {
        type: String,
        enum: ['ios', 'android', 'web']
      },
      enabled: {
        type: Boolean,
        default: true
      },
      lastUpdated: Date
    }],
    
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Method to check if notifications are currently paused
notificationPreferenceSchema.methods.isPaused = function() {
  if (!this.pauseUntil) return false;
  return new Date() < this.pauseUntil;
};

// Method to check if current hour is in quiet hours
notificationPreferenceSchema.methods.isQuietHour = function(hour) {
  const settings = this.recommendationSettings;
  
  if (settings.quietStart < settings.quietEnd) {
    // Normal range (e.g., 22-8 wraps midnight)
    return hour >= settings.quietStart || hour < settings.quietEnd;
  } else {
    // Wrapped range
    return hour >= settings.quietStart && hour < settings.quietEnd;
  }
};

// Static method to get or create preferences
notificationPreferenceSchema.statics.getOrCreate = async function(userId) {
  let prefs = await this.findOne({ userId });
  
  if (!prefs) {
    prefs = await this.create({ userId });
  }
  
  return prefs;
};

module.exports = mongoose.model('NotificationPreference', notificationPreferenceSchema);
