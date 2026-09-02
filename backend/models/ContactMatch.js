/**
 * ContactMatch Model
 * Stores privacy-preserved contact matches between users
 * Uses hashed contacts (SHA256) to protect privacy
 */

const mongoose = require('mongoose');

const contactMatchSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    
    matchedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    
    // Type of contact match
    matchType: {
      type: String,
      enum: ['phone', 'email'],
      required: true
    },
    
    // SHA256 hash of the contact (never store plain text)
    hashedContact: {
      type: String,
      required: true
    },
    
    // Whether both users mutually have each other in contacts
    isMutual: {
      type: Boolean,
      default: false
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

// Compound unique index
contactMatchSchema.index(
  { userId: 1, matchedUserId: 1, matchType: 1 },
  { unique: true }
);

// Query optimization indexes
contactMatchSchema.index({ userId: 1, createdAt: -1 });
contactMatchSchema.index({ matchedUserId: 1, isMutual: 1 });

module.exports = mongoose.model('ContactMatch', contactMatchSchema);
