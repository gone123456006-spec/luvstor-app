const express = require('express');
const { AuditLog } = require('../models/admin');
const { asyncHandler, pageParams, escapeRegex, isObjectId, cleanText } = require('../lib/http');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requirePermission('audit.view'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query, { defaultLimit: 50, maxLimit: 200 });
    const filter = {};
    const action = cleanText(req.query.action, 60);
    if (action) filter.action = { $regex: `^${escapeRegex(action)}` };
    const target = cleanText(req.query.targetId, 60);
    if (target) filter.targetId = target;
    const adminId = cleanText(req.query.adminId, 30);
    if (isObjectId(adminId)) filter.adminId = adminId;
    if (req.query.failed === 'true') filter.success = false;

    const [rows, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({
      entries: rows.map((e) => ({
        id: String(e._id),
        adminEmail: e.adminEmail,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        details: e.details || {},
        success: e.success !== false,
        ip: e.ip,
        createdAt: e.createdAt,
      })),
      page,
      limit,
      total,
    });
  }),
);

module.exports = router;
