const mongoose = require('mongoose');

/**
 * Help & Support tickets submitted from the app.
 * Separate from Report (user-vs-user safety) — this is user-vs-support.
 */
const supportTicketSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    email: { type: String, default: '', lowercase: true, trim: true },
    category: {
      type: String,
      enum: ['Account', 'Billing', 'Safety', 'Bug Report', 'Other'],
      required: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    /** Human-readable ticket number (e.g. LS-482913) */
    ticketNumber: { type: String, required: true, unique: true, index: true },
    adminNote: { type: String, default: '', maxlength: 2000 },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

supportTicketSchema.index({ userId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
