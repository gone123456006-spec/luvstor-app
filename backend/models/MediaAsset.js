const mongoose = require('mongoose');

/**
 * Binary media stored in MongoDB (Atlas) — survives Render redeploys,
 * device transfer, and laptop↔production host mismatches.
 *
 * Public URL shape: /api/media/{ObjectId}
 */
const mediaAssetSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ['image', 'audio', 'other'],
      default: 'image',
      index: true,
    },
    mimeType: { type: String, default: 'image/jpeg', required: true },
    fileName: { type: String, default: '' },
    originalName: { type: String, default: '' },
    size: { type: Number, default: 0 },
    /** Raw file bytes — do not project in list queries */
    data: { type: Buffer, required: true, select: false },
  },
  { timestamps: true },
);

mediaAssetSchema.index({ userId: 1, createdAt: -1 });

/** Stable relative URL stored on User.photo / cover / photos / chat. */
mediaAssetSchema.methods.publicUrl = function publicUrl() {
  return `/api/media/${this._id}`;
};

module.exports = mongoose.model('MediaAsset', mediaAssetSchema);
