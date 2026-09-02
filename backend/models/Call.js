const mongoose = require('mongoose');

/**
 * Persisted call sessions / history (WhatsApp-style).
 * Active in-progress state also lives in services/calls.js memory (and Redis when available).
 */
const CallSchema = new mongoose.Schema(
  {
    callId: { type: String, required: true, unique: true, index: true },
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    calleeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    callType: {
      type: String,
      enum: ['voice', 'video'],
      required: true,
    },
    status: {
      type: String,
      enum: [
        'ringing',
        'connecting',
        'connected',
        'ended',
        'missed',
        'rejected',
        'cancelled',
        'busy',
        'failed',
        'unavailable',
      ],
      default: 'ringing',
      index: true,
    },
    endReason: {
      type: String,
      enum: [
        'hangup',
        'decline',
        'cancel',
        'timeout',
        'busy',
        'offline',
        'error',
        'disconnect',
        'replaced',
      ],
      default: undefined,
    },
    endedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    startedAt: { type: Date, default: Date.now },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSec: { type: Number, default: 0 },
    roomId: { type: String, default: '' },
  },
  { timestamps: true }
);

CallSchema.index({ callerId: 1, createdAt: -1 });
CallSchema.index({ calleeId: 1, createdAt: -1 });
CallSchema.index({ status: 1, startedAt: 1 });

module.exports = mongoose.model('Call', CallSchema);
