const mongoose = require('mongoose');

/**
 * Upload model — tracks file ownership and metadata
 * Every uploaded file is owned by a user and must be accessed through auth
 */
const uploadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fileName: { type: String, required: true },
  originalName: { type: String, default: '' },
  mimeType: { type: String, default: 'image/jpeg' },
  size: { type: Number, default: 0 },
  path: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

// Index for efficient user-file lookups
uploadSchema.index({ userId: 1, uploadedAt: -1 });

module.exports = mongoose.model('Upload', uploadSchema);
