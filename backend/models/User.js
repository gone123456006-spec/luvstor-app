const mongoose = require('mongoose');
const { MAX_PROFILE_PHOTOS } = require('../config/profileLimits');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  /**
   * Google / Firebase UID. Only set for Google logins.
   * Must stay unset (not null) for email users — unique sparse index.
   */
  googleUid: { type: String, sparse: true, unique: true },
  authProvider: { type: String, enum: ['google', 'email'], default: 'email' },
  /** Public display ID — format ABCD1234 (unique, random) */
  publicId: {
    type: String,
    unique: true,
    sparse: true,
    uppercase: true,
    trim: true,
    match: [/^[A-Z]{4}[0-9]{4}$/, 'publicId must be ABCD1234 format'],
  },
  name: { type: String, default: '' },
  age: { type: Number, default: null },
  bio: { type: String, default: '' },
  gender: { type: String, default: '' },
  /**
   * Who this user wants to see in Nearby: Man | Woman | Other | All.
   * Empty means "not set yet" — Nearby then defaults to the opposite gender.
   */
  showMe: { type: String, default: '', trim: true },
  interests: { type: [String], default: [] },
  relationshipGoal: { type: String, default: '' },
  photo: { type: String, default: '' },
  /** Profile gallery — up to 6 images */
  photos: {
    type: [String],
    default: [],
    validate: {
      validator: (arr) => !Array.isArray(arr) || arr.length <= MAX_PROFILE_PHOTOS,
      message: `You can add a maximum of ${MAX_PROFILE_PHOTOS} photos`,
    },
  },
  height: { type: Number, default: null },
  distance: { type: Number, default: 10 },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
  },
  isVerified: { type: Boolean, default: false },
  /** Single-device session: only this installation may use the account */
  activeDeviceId: { type: String, default: null },
  activeDeviceBoundAt: { type: Date, default: null },
  /** Chat access tokens (independent of offers / premiums / trials) */
  tokenBalance: { type: Number, default: 0, min: 0 },
  lastSpinDate: { type: String, default: null },
  /** 1–7 daily spin reward cycle; wraps back to 1 after day 7 */
  spinCycleDay: { type: Number, default: 0, min: 0, max: 7 },
  spinCycleDate: { type: String, default: null },
  /** Active chat session (server time; duration depends on subscription tier) */
  chatSessionStartedAt: { type: Date, default: null },
  chatSessionExpiresAt: { type: Date, default: null, index: true },
  /** Subscription: free | gold | platinum | black */
  subscriptionPlan: {
    type: String,
    enum: ['free', 'gold', 'platinum', 'black'],
    default: 'free',
  },
  subscriptionExpiresAt: { type: Date, default: null, index: true },
  /** Last processed Razorpay payment for subscription (idempotency) */
  lastSubscriptionPaymentId: { type: String, default: null, index: true },
  /** Daily spin allowance (resets by UTC date key) */
  subscriptionSpinsUsedToday: { type: Number, default: 0, min: 0 },
  subscriptionSpinsDate: { type: String, default: null },
  /** Black tier: cap spin token wins per day */
  spinTokensWonToday: { type: Number, default: 0, min: 0 },
  /** Black: daily 40-min discover top spot window */
  discoverTopSpotUntil: { type: Date, default: null },
  discoverTopSpotDate: { type: String, default: null },
  /**
   * Lifetime count of Discover impressions across all viewers. Powers exposure
   * fairness: profiles that have already been served to a lot of people earn
   * less ranking credit, so a handful of popular accounts cannot absorb every
   * impression while newer profiles never surface.
   */
  discoveryExposureCount: { type: Number, default: 0, min: 0 },
  /**
   * The viewer's last-used Discover filters, persisted so the feed can score
   * mutual relevance — "would this person's own filters have shown me?" — and
   * so the app can restore the filters after a restart.
   */
  discoveryPrefs: {
    gender: { type: String, default: '' },
    radiusKm: { type: Number, default: null },
    activeWithinMinutes: { type: Number, default: 0 },
    updatedAt: { type: Date, default: null },
  },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  /** Account deletion fields */
  deletionScheduledAt: { type: Date, default: null, index: true },
  deletionReason: { type: String, default: null },
  isDeactivated: { type: Boolean, default: false, index: true },
  reminderSentAt: { type: Date, default: null },
  /**
   * Per-category push opt-outs. Security notifications are intentionally not
   * listed — account alerts are always delivered.
   */
  notificationPrefs: {
    chat: { type: Boolean, default: true },
    social: { type: Boolean, default: true },
    calls: { type: Boolean, default: true },
    wallet: { type: Boolean, default: true },
    system: { type: Boolean, default: true },
    promotions: { type: Boolean, default: true },
    /** WhatsApp-style: show message text in the tray, or only "New message" */
    showMessagePreview: { type: Boolean, default: true },
  },
}, { timestamps: true });

// Geospatial index for nearby queries
userSchema.index({ location: '2dsphere' });

// Discovery eligibility — narrows the candidate pool alongside the $near scan
userSchema.index({ isVerified: 1, isDeactivated: 1, deletionScheduledAt: 1 });
// Discovery "active within" filter
userSchema.index({ lastSeen: -1 });
// Discovery freshness boost for newly registered profiles
userSchema.index({ createdAt: -1 });
// Daily suggestion digest — pick recently active accounts without a full scan
userSchema.index({ isDeactivated: 1, deletionScheduledAt: 1, lastSeen: -1 });

module.exports = mongoose.model('User', userSchema);
