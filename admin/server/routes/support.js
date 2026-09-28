const express = require('express');
const { User, SupportTicket } = require('../models/app');
const { TicketNote } = require('../models/admin');
const { asyncHandler, HttpError, toObjectId, pageParams, cleanText, oneOf, escapeRegex } = require('../lib/http');
const { audit } = require('../lib/audit');
const { invalidate } = require('../lib/cache');
const { mainApi } = require('../lib/mainApi');
const { loadUserRefs } = require('../lib/users');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const CATEGORIES = ['Account', 'Billing', 'Safety', 'Bug Report', 'Other'];

function ticketView(t, refs) {
  return {
    id: String(t._id),
    ticketNumber: t.ticketNumber,
    category: t.category,
    subject: t.subject,
    description: t.description,
    status: t.status,
    adminNote: t.adminNote || '',
    email: t.email || '',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    resolvedAt: t.resolvedAt || null,
    user: refs.get(String(t.userId)) || null,
  };
}

router.get(
  '/tickets',
  requirePermission('support.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const status = oneOf(req.query.status, [...STATUSES, 'active', 'all'], 'active');
    const category = oneOf(req.query.category, CATEGORIES, '');
    const filter = {};
    if (status === 'active') filter.status = { $in: ['open', 'in_progress'] };
    else if (status !== 'all') filter.status = status;
    if (category) filter.category = category;
    const q = cleanText(req.query.q, 100);
    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { ticketNumber: { $regex: `^${safe}`, $options: 'i' } },
        { subject: { $regex: safe, $options: 'i' } },
        { email: { $regex: `^${safe.toLowerCase()}` } },
      ];
    }
    const [rows, total, counts] = await Promise.all([
      // Oldest open first so nothing waits forever
      SupportTicket.find(filter)
        .sort(status === 'active' || status === 'open' ? { createdAt: 1 } : { createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SupportTicket.countDocuments(filter),
      SupportTicket.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const refs = await loadUserRefs(User, rows.map((t) => t.userId));
    res.json({
      tickets: rows.map((t) => ticketView(t, refs)),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
      page,
      limit,
      total,
    });
  }),
);

router.get(
  '/tickets/:id',
  requirePermission('support.view'),
  asyncHandler(async (req, res) => {
    const id = toObjectId(req.params.id);
    const ticket = await SupportTicket.findById(id).lean();
    if (!ticket) throw new HttpError(404, 'Ticket not found');
    const [refs, notes] = await Promise.all([
      loadUserRefs(User, [ticket.userId]),
      TicketNote.find({ ticketId: id }).sort({ createdAt: 1 }).lean(),
    ]);
    res.json({
      ticket: ticketView(ticket, refs),
      notes: notes.map((n) => ({
        id: String(n._id),
        kind: n.kind,
        text: n.text,
        adminEmail: n.adminEmail,
        notified: n.notified,
        createdAt: n.createdAt,
      })),
    });
  }),
);

router.patch(
  '/tickets/:id',
  requirePermission('support.act'),
  asyncHandler(async (req, res) => {
    const id = toObjectId(req.params.id);
    const status = oneOf(req.body?.status, STATUSES, '');
    if (!status) throw new HttpError(400, 'Invalid status');
    const adminNote = cleanText(req.body?.adminNote, 2000);
    const result = await mainApi(`/api/support/admin/tickets/${id}`, {
      method: 'PATCH',
      body: { status, adminNote },
    });
    invalidate('overview');
    await audit(req, 'support.ticket_update', { targetType: 'ticket', targetId: id, details: { status } });
    res.json({ ok: true, ticket: result?.ticket || null });
  }),
);

/**
 * Internal note (admins only) or reply (also pushed to the user as a
 * system notification that opens Support in the app).
 */
router.post(
  '/tickets/:id/notes',
  requirePermission('support.act'),
  asyncHandler(async (req, res) => {
    const id = toObjectId(req.params.id);
    const kind = oneOf(req.body?.kind, ['note', 'reply'], 'note');
    const text = cleanText(req.body?.text, 2000);
    if (!text) throw new HttpError(400, 'Text is required');
    const ticket = await SupportTicket.findById(id).select('userId ticketNumber subject').lean();
    if (!ticket) throw new HttpError(404, 'Ticket not found');

    let notified = false;
    if (kind === 'reply') {
      await mainApi('/api/notifications/send', {
        method: 'POST',
        body: {
          userIds: [String(ticket.userId)],
          type: 'system',
          title: `Support reply · ${ticket.ticketNumber}`,
          body: text.slice(0, 1000),
          data: { screen: 'support', ticketId: String(id), ticketNumber: ticket.ticketNumber },
        },
      });
      notified = true;
    }
    const note = await TicketNote.create({
      ticketId: id,
      adminId: req.admin._id,
      adminEmail: req.admin.email,
      kind,
      text,
      notified,
    });
    await audit(req, `support.ticket_${kind}`, { targetType: 'ticket', targetId: id, details: { notified } });
    res.status(201).json({
      note: { id: String(note._id), kind, text, adminEmail: note.adminEmail, notified, createdAt: note.createdAt },
    });
  }),
);

module.exports = router;
