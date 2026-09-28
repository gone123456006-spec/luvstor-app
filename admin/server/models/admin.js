const mongoose = require('mongoose');

const { Schema } = mongoose;

const ROLES = ['owner', 'admin', 'moderator', 'support', 'analyst'];

const adminUserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: '', trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    active: { type: Boolean, default: true },
    /** Bumped on password change / disable — invalidates existing sessions */
    tokenVersion: { type: Number, default: 0 },
    failedLogins: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: '' },
    mustChangePassword: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'admin_users' },
);

const auditLogSchema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, default: null },
    adminEmail: { type: String, default: '' },
    action: { type: String, required: true },
    targetType: { type: String, default: '' },
    targetId: { type: String, default: '' },
    details: { type: Schema.Types.Mixed, default: {} },
    success: { type: Boolean, default: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'admin_audit_logs' },
);
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ adminId: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const ticketNoteSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, required: true },
    adminId: { type: Schema.Types.ObjectId, required: true },
    adminEmail: { type: String, default: '' },
    kind: { type: String, enum: ['note', 'reply'], default: 'note' },
    text: { type: String, required: true, maxlength: 2000 },
    notified: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'admin_ticket_notes' },
);
ticketNoteSchema.index({ ticketId: 1, createdAt: 1 });

const CAMPAIGN_STATUSES = ['scheduled', 'sending', 'sent', 'failed', 'cancelled'];

const campaignSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 1000 },
    type: { type: String, required: true },
    deepLink: { type: String, default: '' },
    segment: { type: String, required: true },
    sendAt: { type: Date, required: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'scheduled' },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    createdByEmail: { type: String, default: '' },
    audienceAtSend: { type: Number, default: null },
    error: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'admin_campaigns' },
);
campaignSchema.index({ status: 1, sendAt: 1 });
campaignSchema.index({ createdAt: -1 });

const AdminUser = mongoose.model('AdminUser', adminUserSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);
const TicketNote = mongoose.model('TicketNote', ticketNoteSchema);
const Campaign = mongoose.model('Campaign', campaignSchema);

module.exports = { AdminUser, AuditLog, TicketNote, Campaign, ROLES, CAMPAIGN_STATUSES };
