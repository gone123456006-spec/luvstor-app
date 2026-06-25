const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, default: '' },
  age: { type: Number, default: null },
  bio: { type: String, default: '' },
  gender: { type: String, default: '' },
  interests: { type: [String], default: [] },
  relationshipGoal: { type: String, default: '' },
  photo: { type: String, default: '' },
  height: { type: Number, default: null },
  distance: { type: Number, default: 10 },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
  },
  isVerified: { type: Boolean, default: false },
  tokenBalance: { type: Number, default: 0 },
  lastSpinDate: { type: String, default: null },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
}, { timestamps: true });

// Geospatial index for nearby queries
userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', userSchema);
