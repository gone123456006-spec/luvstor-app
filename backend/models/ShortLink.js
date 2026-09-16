const mongoose = require('mongoose');

/**
 * Branded short links (OneLink-style):
 * https://luvstor-one.onelink.me/luvstor/{slug}
 */
const shortLinkSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['referral', 'profile'],
      required: true,
      index: true,
    },
    /** Referral invite code (User.referralCode) */
    referralCode: { type: String, default: null, index: true },
    /** Profile public ID (ABCD1234) */
    publicId: { type: String, default: null, index: true },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    clickCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

shortLinkSchema.index(
  { type: 1, referralCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'referral',
      referralCode: { $type: 'string' },
    },
  },
);

shortLinkSchema.index(
  { type: 1, publicId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'profile',
      publicId: { $type: 'string' },
    },
  },
);

module.exports = mongoose.model('ShortLink', shortLinkSchema);
