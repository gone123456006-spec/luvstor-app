const mongoose = require('mongoose');

/**
 * ConversationState model
 * Tracks per-conversation message limits and reply states for anti-spam system.
 * Each user has separate state for each conversation they're in.
 */
const conversationStateSchema = new mongoose.Schema({
  // The user who is sending messages (the one being tracked)
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  // The other party in the conversation
  otherUserId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  // Room ID for easy lookup (consistent with Message model)
  roomId: { 
    type: String, 
    required: true, 
    index: true 
  },
  // Number of consecutive messages sent without a reply from the other user
  consecutiveMessages: { 
    type: Number, 
    default: 0, 
    min: 0 
  },
  // Whether this user is waiting for a reply (hit 10 message limit)
  waitingForReply: { 
    type: Boolean, 
    default: false, 
    index: true 
  },
  // Timestamp of the last message sent in this conversation
  lastMessageAt: { 
    type: Date, 
    default: null 
  },
  // Timestamp of the last reply received from other user
  lastReplyReceivedAt: { 
    type: Date, 
    default: null 
  },
  /** WhatsApp-style: mute push notifications for this conversation */
  muted: {
    type: Boolean,
    default: false,
    index: true,
  },
  mutedAt: {
    type: Date,
    default: null,
  },
  /** WhatsApp-style: hide chat from main list */
  archived: {
    type: Boolean,
    default: false,
    index: true,
  },
  archivedAt: {
    type: Date,
    default: null,
  },
  /** User deleted this chat — hidden until a new message arrives */
  clearedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

// Compound index for efficient lookups by user and conversation
conversationStateSchema.index({ userId: 1, otherUserId: 1 }, { unique: true });
conversationStateSchema.index({ userId: 1, waitingForReply: 1 });

module.exports = mongoose.model('ConversationState', conversationStateSchema);
