const mongoose = require('mongoose');

/**
 * Friendship model
 * Tracks relationship status between users for the Friends & Match system.
 * 
 * Relationship flow:
 * 1. pending_like: User A likes User B (one-way)
 * 2. mutual_match: Both users have liked each other (shows in Friend Requests)
 * 3. friends: Both users accepted the friend request (full features unlocked)
 * 4. declined: One user declined the friend request
 * 5. blocked: One user blocked the other (if implemented)
 */
const friendshipSchema = new mongoose.Schema({
  // The two users in this relationship (always stored in sorted order for consistency)
  userA: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  userB: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  
  // Relationship status
  status: {
    type: String,
    enum: ['pending_like', 'mutual_match', 'friends', 'declined', 'blocked'],
    default: 'pending_like',
    index: true
  },
  
  // Who initiated the like (the first person to like)
  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // For mutual_match -> friends, track who accepted first
  acceptedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Timestamps for status changes
  likedAt: { type: Date, default: Date.now },
  matchedAt: { type: Date, default: null },
  friendsSince: { type: Date, default: null },
  declinedAt: { type: Date, default: null },
  blockedAt: { type: Date, default: null },
  /** Who initiated the block (null unless status === 'blocked') */
  blockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, { timestamps: true });

// Compound unique index to prevent duplicate friendships
// userA and userB are always in sorted order
friendshipSchema.index({ userA: 1, userB: 1 }, { unique: true });

// Index for efficient queries
friendshipSchema.index({ userA: 1, status: 1 });
friendshipSchema.index({ userB: 1, status: 1 });

// Helper method to get the sorted pair of user IDs
friendshipSchema.statics.getSortedPair = function(userId1, userId2) {
  const id1 = String(userId1);
  const id2 = String(userId2);
  return id1 < id2 
    ? { userA: id1, userB: id2 } 
    : { userA: id2, userB: id1 };
};

// Helper method to check if user is part of this friendship
friendshipSchema.methods.includesUser = function(userId) {
  const id = String(userId);
  return String(this.userA) === id || String(this.userB) === id;
};

// Helper method to get the other user in the friendship
friendshipSchema.methods.getOtherUser = function(userId) {
  const id = String(userId);
  return String(this.userA) === id ? this.userB : this.userA;
};

module.exports = mongoose.model('Friendship', friendshipSchema);
