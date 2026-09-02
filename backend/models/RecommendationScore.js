/**
 * RecommendationScore Model
 * Stores precomputed recommendation scores for faster lookups
 */

const mongoose = require('mongoose');

const recommendationScoreSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    
    // Individual signal scores
    signals: {
      mutualFollowers: { type: Number, default: 0 },
      mutualFollowing: { type: Number, default: 0 },
      friendsOfFriends: { type: Number, default: 0 },
      commonInterests: { type: Number, default: 0 },
      locationSimilarity: { type: Number, default: 0 },
      schoolMatch: { type: Boolean, default: false },
      collegeMatch: { type: Boolean, default: false },
      companyMatch: { type: Boolean, default: false },
      profileVisits: { type: Number, default: 0 },
      searchAppearances: { type: Number, default: 0 },
      engagementScore: { type: Number, default: 0 },
      contactMatch: { type: Boolean, default: false },
      accountQuality: { type: Number, default: 0 },
      activityScore: { type: Number, default: 0 },
      followBackProbability: { type: Number, default: 0 },
      recentlyJoinedBoost: { type: Number, default: 0 },
      trendingBoost: { type: Number, default: 0 }
    },
    
    // Aggregated score (0-100)
    totalScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true
    },
    
    // Optional ML-predicted score
    mlScore: {
      type: Number,
      min: 0,
      max: 100
    },
    
    // Explanation for transparency
    explanation: {
      topReasons: [String],
      confidence: {
        type: Number,
        min: 0,
        max: 100
      }
    },
    
    // Metadata
    computedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    
    version: {
      type: Number,
      default: 1
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
recommendationScoreSchema.index({ userId: 1, totalScore: -1, computedAt: -1 });
recommendationScoreSchema.index({ userId: 1, candidateId: 1 }, { unique: true });

// TTL index: auto-delete scores older than 7 days
recommendationScoreSchema.index(
  { computedAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 }
);

module.exports = mongoose.model('RecommendationScore', recommendationScoreSchema);
