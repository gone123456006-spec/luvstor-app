const mongoose = require('mongoose');

/**
 * One row per successful referral (referee completed login via referrer's link).
 */
const referralSchema = new mongoose.Schema(
  {
    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    refereeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    code: { type: String, required: true, index: true },
    refereeDeviceId: { type: String, default: null },
    tokensAwarded: { type: Number, default: 50, min: 0 },
    status: {
      type: String,
      enum: ['rewarded', 'revoked'],
      default: 'rewarded',
      index: true,
    },
    monthKey: { type: String, default: null, index: true },
  },
  { timestamps: true },
);

referralSchema.index({ referrerId: 1, createdAt: -1 });
referralSchema.index(
  { refereeDeviceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      refereeDeviceId: { $type: 'string', $gt: '' },
      status: 'rewarded',
    },
  },
);

module.exports = mongoose.model('Referral', referralSchema);
