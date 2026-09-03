const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const adminAuth = require('../middleware/adminAuth');
const Report = require('../models/Report');
const User = require('../models/User');
const Friendship = require('../models/Friendship');

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const STATUSES = new Set(['open', 'reviewed', 'actioned', 'dismissed']);
const ACTIONS = new Set(['none', 'warned', 'hidden', 'banned', 'dismissed']);

/**
 * GET /api/admin/reports
 * Query: status=open|reviewed|actioned|dismissed|all, limit, page
 */
router.get('/reports', adminAuth, adminLimiter, async (req, res) => {
  try {
    const status = String(req.query.status || 'open').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const filter = status === 'all' || !STATUSES.has(status) ? {} : { status };

    const [total, reports] = await Promise.all([
      Report.countDocuments(filter),
      Report.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('reporterId', 'name email publicId photo')
        .populate('reportedUserId', 'name email publicId photo isDeactivated photoVerification')
        .lean(),
    ]);

    res.json({
      reports,
      pagination: {
        page,
        limit,
        total,
        hasMore: page * limit < total,
      },
    });
  } catch (err) {
    console.error('admin/reports list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/admin/reports/stats
 */
router.get('/reports/stats', adminAuth, adminLimiter, async (_req, res) => {
  try {
    const rows = await Report.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const byStatus = { open: 0, reviewed: 0, actioned: 0, dismissed: 0 };
    for (const row of rows) {
      if (row._id in byStatus) byStatus[row._id] = row.count;
    }
    res.json({ byStatus, open: byStatus.open });
  } catch (err) {
    console.error('admin/reports stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PATCH /api/admin/reports/:id
 * Body: { status, actionTaken, moderatorNote, alsoDeactivate?: boolean }
 *
 * Does not change the user-facing report create path.
 */
router.patch('/reports/:id', adminAuth, adminLimiter, async (req, res) => {
  try {
    const status = String(req.body.status || '').trim();
    const actionTaken = String(req.body.actionTaken || 'none').trim();
    const moderatorNote = String(req.body.moderatorNote || '').slice(0, 2000);

    if (!STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (!ACTIONS.has(actionTaken)) {
      return res.status(400).json({ error: 'Invalid actionTaken' });
    }

    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    report.status = status;
    report.actionTaken = actionTaken;
    report.moderatorNote = moderatorNote;
    report.reviewedAt = new Date();
    await report.save();

    let userAction = null;
    if (req.body.alsoDeactivate === true || actionTaken === 'banned') {
      const updated = await User.findByIdAndUpdate(
        report.reportedUserId,
        {
          isDeactivated: true,
          deletionReason: `moderation:${actionTaken}`,
        },
        { returnDocument: 'after' },
      ).select('_id email isDeactivated');
      userAction = updated
        ? { deactivated: true, userId: String(updated._id) }
        : null;
    }

    if (actionTaken === 'hidden' || actionTaken === 'banned') {
      // Soft-hide: mark reporter↔reported as blocked if friendship exists
      try {
        const pair = Friendship.getSortedPair(
          report.reporterId,
          report.reportedUserId,
        );
        await Friendship.findOneAndUpdate(
          pair,
          {
            $set: {
              status: 'blocked',
              blockedBy: report.reporterId,
              blockedAt: new Date(),
            },
          },
          { upsert: false },
        );
      } catch {
        /* non-fatal */
      }
    }

    res.json({
      report: {
        id: report._id,
        status: report.status,
        actionTaken: report.actionTaken,
        moderatorNote: report.moderatorNote,
        reviewedAt: report.reviewedAt,
        reportedUserId: report.reportedUserId,
        reporterId: report.reporterId,
        reason: report.reason,
      },
      userAction,
    });
  } catch (err) {
    console.error('admin/reports patch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
