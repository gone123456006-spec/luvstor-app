const mongoose = require('mongoose');

/**
 * User reports (spam, harassment, fake profile, etc.).
 * Kept separate from Friendship so reports survive even after unblock.
 */
const reportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reportedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reason: {
      type: String,
      enum: [
        'spam',
        'harassment',
        'inappropriate',
        'fake_profile',
        'underage',
        'other',
      ],
      required: true,
    },
    details: { type: String, default: '', maxlength: 1000 },
    status: {
      type: String,
      enum: ['open', 'reviewed', 'actioned', 'dismissed'],
      default: 'open',
      index: true,
    },
    /** Admin moderation fields — set only via admin API */
    moderatorNote: { type: String, default: '', maxlength: 2000 },
    reviewedAt: { type: Date, default: null },
    actionTaken: {
      type: String,
      enum: ['none', 'warned', 'hidden', 'banned', 'dismissed'],
      default: 'none',
    },
  },
  { timestamps: true },
);

reportSchema.index({ status: 1, createdAt: -1 });

reportSchema.index({ reporterId: 1, reportedUserId: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
