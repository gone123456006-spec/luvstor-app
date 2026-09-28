const { AuditLog } = require('../models/admin');

/**
 * Append-only admin action log. Never throws — a failed audit write must not
 * turn a completed action into an error response.
 */
async function audit(req, action, { targetType = '', targetId = '', details = {}, success = true } = {}) {
  try {
    await AuditLog.create({
      adminId: req.admin?._id || null,
      adminEmail: req.admin?.email || details.email || '',
      action,
      targetType,
      targetId: targetId ? String(targetId) : '',
      details,
      success,
      ip: req.ip || '',
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    });
  } catch (err) {
    console.error('[audit] write failed:', err.message);
  }
}

module.exports = { audit };
