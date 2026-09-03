const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const { redisRateLimit } = require('../utils/scaleHelpers');

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) =>
    req.userId ? String(req.userId) : ipKeyGenerator(req, res),
  handler: (req, res) =>
    res.status(429).json({
      error: 'Too many support tickets. Try again later.',
      code: 'RATE_LIMIT',
    }),
});

const redisSubmitGuard = redisRateLimit({
  prefix: 'support-submit',
  windowMs: 60 * 60 * 1000,
  max: 8,
});

function makeTicketNumber() {
  const n = crypto.randomInt(100000, 1000000);
  return `LS-${n}`;
}

const CATEGORIES = new Set(['Account', 'Billing', 'Safety', 'Bug Report', 'Other']);

// POST /api/support/tickets — create ticket (authenticated user)
router.post('/tickets', auth, redisSubmitGuard, submitLimiter, async (req, res) => {
  try {
    const category = String(req.body.category || '').trim();
    const subject = String(req.body.subject || '').trim();
    const description = String(req.body.description || '').trim();

    if (!CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'Invalid category', code: 'INVALID_CATEGORY' });
    }
    if (subject.length < 3 || subject.length > 200) {
      return res.status(400).json({ error: 'Subject must be 3–200 characters' });
    }
    if (description.length < 10 || description.length > 5000) {
      return res.status(400).json({ error: 'Description must be 10–5000 characters' });
    }

    const me = await User.findById(req.userId).select('email');
    let ticket = null;
    let lastErr = null;
    for (let i = 0; i < 8; i += 1) {
      try {
        ticket = await SupportTicket.create({
          userId: req.userId,
          email: me?.email || '',
          category,
          subject,
          description,
          ticketNumber: makeTicketNumber(),
          status: 'open',
        });
        break;
      } catch (err) {
        lastErr = err;
        if (err?.code !== 11000) throw err;
      }
    }
    if (!ticket) {
      console.error('support ticket create failed after retries:', lastErr);
      return res.status(500).json({ error: 'Could not submit ticket' });
    }

    res.status(201).json({
      id: ticket._id,
      ticketNumber: ticket.ticketNumber,
      category: ticket.category,
      subject: ticket.subject,
      status: ticket.status,
      createdAt: ticket.createdAt,
      message: 'Ticket submitted. Our team will email you within 24 hours.',
    });
  } catch (err) {
    console.error('support/tickets create error:', err);
    res.status(500).json({ error: 'Could not submit ticket' });
  }
});

// GET /api/support/tickets — list my tickets
router.get('/tickets', auth, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('ticketNumber category subject status createdAt updatedAt resolvedAt')
      .lean();
    res.json({ tickets });
  } catch (err) {
    console.error('support/tickets list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/support/tickets/:ticketNumber — my ticket detail
router.get('/tickets/:ticketNumber', auth, async (req, res) => {
  try {
    const raw = String(req.params.ticketNumber || '').trim();
    const ticket = await SupportTicket.findOne({
      ticketNumber: raw.toUpperCase().startsWith('LS-')
        ? raw.toUpperCase().replace(/^LS-/, 'LS-')
        : raw,
      userId: req.userId,
    }).lean();
    // ticket numbers are LS-###### (case-sensitive prefix)
    const found =
      ticket ||
      (await SupportTicket.findOne({
        ticketNumber: raw,
        userId: req.userId,
      }).lean());
    if (!found) return res.status(404).json({ error: 'Ticket not found' });
    res.json({
      id: found._id,
      ticketNumber: found.ticketNumber,
      category: found.category,
      subject: found.subject,
      description: found.description,
      status: found.status,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
      resolvedAt: found.resolvedAt,
    });
  } catch (err) {
    console.error('support/tickets get error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin ──────────────────────────────────────────────────────────────
router.get('/admin/tickets', adminAuth, async (req, res) => {
  try {
    const status = String(req.query.status || 'open').trim();
    const filter = status === 'all' ? {} : { status };
    const tickets = await SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit) || 50, 200))
      .populate('userId', 'name email publicId')
      .lean();
    res.json({ tickets });
  } catch (err) {
    console.error('support/admin list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/admin/tickets/:id', adminAuth, async (req, res) => {
  try {
    const status = String(req.body.status || '').trim();
    const allowed = ['open', 'in_progress', 'resolved', 'closed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const updates = {
      status,
      adminNote: String(req.body.adminNote || '').slice(0, 2000),
    };
    if (status === 'resolved' || status === 'closed') {
      updates.resolvedAt = new Date();
    }
    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, updates, {
      returnDocument: 'after',
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ticket });
  } catch (err) {
    console.error('support/admin patch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
