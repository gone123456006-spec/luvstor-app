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
  },
  { timestamps: true },
);

reportSchema.index({ reporterId: 1, reportedUserId: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
