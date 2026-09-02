/**
 * SearchHistory Model
 * Tracks user search queries and clicked results
 */

const mongoose = require('mongoose');

const searchHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    
    // Search query text
    query: {
      type: String,
      required: true
    },
    
    // User that was clicked from search results (if any)
    searchedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },
    
    // Search metadata
    resultCount: {
      type: Number,
      default: 0
    },
    clickPosition: {
      type: Number
    },
    
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

// Indexes for efficient queries
searchHistorySchema.index({ userId: 1, createdAt: -1 });
searchHistorySchema.index({ searchedUserId: 1, createdAt: -1 });

// TTL index: auto-delete history older than 90 days
searchHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

module.exports = mongoose.model('SearchHistory', searchHistorySchema);
