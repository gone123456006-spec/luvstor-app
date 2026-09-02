/**
 * RecommendationImpression Model
 * Tracks when users see and interact with recommendations
 */

const mongoose = require('mongoose');

const recommendationImpressionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    suggestedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    
    // Impression details
    firstShownAt: {
      type: Date,
      default: Date.now
    },
    lastShownAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    impressionCount: {
      type: Number,
      default: 1,
      min: 0
    },
    
    // User actions
    clicked: {
      type: Boolean,
      default: false
    },
    clickedAt: {
      type: Date
    },
    followed: {
      type: Boolean,
      default: false,
      index: true
    },
    followedAt: {
      type: Date
    },
    dismissed: {
      type: Boolean,
      default: false
    },
    dismissedAt: {
      type: Date
    },
    dismissReason: {
      type: String,
      enum: ['not_interested', 'spam', 'inappropriate', 'other']
    },
    
    // Context
    position: {
      type: Number,
      min: 1
    },
    page: {
      type: Number,
      min: 1
    },
    source: {
      type: String,
      enum: ['suggested', 'trending', 'nearby', 'search'],
      default: 'suggested'
    },
    
    // Score at time of impression
    scoreAtImpression: {
      type: Number,
      min: 0,
      max: 100
    }
  },
  {
    timestamps: true
  }
);

// Compound unique index
recommendationImpressionSchema.index(
  { userId: 1, suggestedUserId: 1 },
  { unique: true }
);

// Query optimization indexes
recommendationImpressionSchema.index({ userId: 1, lastShownAt: -1 });
recommendationImpressionSchema.index({ suggestedUserId: 1, followed: 1 });
recommendationImpressionSchema.index({ userId: 1, dismissed: 1, dismissedAt: -1 });

// TTL index: auto-delete impressions older than 30 days
recommendationImpressionSchema.index(
  { lastShownAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 }
);

module.exports = mongoose.model('RecommendationImpression', recommendationImpressionSchema);
