const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true }, // e.g. "userId1_userId2" (sorted)
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, default: '' },
  type: { type: String, enum: ['text', 'image', 'audio'], default: 'text' },
  mediaUrl: { type: String, default: null },
  /** WhatsApp ticks: delivered → double gray, read → blue */
  delivered: { type: Boolean, default: false, index: true },
  deliveredAt: { type: Date, default: null },
  read: { type: Boolean, default: false, index: true },
  readAt: { type: Date, default: null },
  /**
   * Blocked path — message is kept for the sender only.
   * Never delivered / shown to the other person (single tick forever).
   */
  undelivered: { type: Boolean, default: false, index: true },
  /** Soft-delete for everyone (sender + receiver) */
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  /** WhatsApp "delete for me" — hidden only for these users */
  deletedFor: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    default: [],
    index: true,
  },
  /** Instagram/WhatsApp-style reply target */
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null,
    index: true,
  },
  /** WhatsApp-style view-once photo */
  viewOnce: { type: Boolean, default: false, index: true },
  viewOnceOpened: { type: Boolean, default: false, index: true },
  viewOnceOpenedAt: { type: Date, default: null },
}, { timestamps: true });

// Compound index for efficient room queries and sender/receiver queries
messageSchema.index({ roomId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, delivered: 1, undelivered: 1 });

// Validation: senderId cannot equal receiverId
// Mongoose 9: pre hooks are async/sync without next() callback
messageSchema.pre('save', function () {
  if (this.senderId && this.receiverId && this.senderId.equals(this.receiverId)) {
    throw new Error('Cannot send messages to yourself');
  }
});

module.exports = mongoose.model('Message', messageSchema);
