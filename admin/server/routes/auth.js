const express = require('express');
const rateLimit = require('express-rate-limit');
const { AdminUser } = require('../models/admin');
const { config } = require('../config');
const { asyncHandler, HttpError, cleanText } = require('../lib/http');
const { audit } = require('../lib/audit');
const { permissionsFor } = require('../lib/permissions');
const {
  passwordProblem,
  hashPassword,
  verifyPassword,
  DUMMY_HASH,
} = require('../lib/passwords');
const { requireAdmin, setSessionCookie, clearSessionCookie } = require('../middleware/auth');

const router = express.Router();

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

function sessionView(admin) {
  return {
    id: String(admin._id),
    email: admin.email,
    name: admin.name || '',
    role: admin.role,
    mustChangePassword: !!admin.mustChangePassword,
    permissions: permissionsFor(admin.role),
    mediaBaseUrl: config.mediaBaseUrl,
  };
}

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = cleanText(req.body?.email, 200).toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) throw new HttpError(400, 'Email and password are required');

    const admin = await AdminUser.findOne({ email });
    if (!admin) {
      await verifyPassword(password, DUMMY_HASH);
      await audit(req, 'auth.login', { details: { email }, success: false });
      throw new HttpError(401, 'Invalid email or password', 'BAD_CREDENTIALS');
    }
    if (admin.lockUntil && admin.lockUntil > new Date()) {
      const mins = Math.ceil((admin.lockUntil - Date.now()) / 60000);
      throw new HttpError(423, `Account locked. Try again in ${mins} min.`, 'LOCKED');
    }
    const ok = await verifyPassword(password, admin.passwordHash);
    if (!ok || !admin.active) {
      admin.failedLogins = (admin.failedLogins || 0) + 1;
      if (admin.failedLogins >= MAX_FAILED) {
        admin.lockUntil = new Date(Date.now() + LOCK_MS);
        admin.failedLogins = 0;
      }
      await admin.save();
      await audit(req, 'auth.login', {
        targetType: 'admin',
        targetId: admin._id,
        details: { email, reason: admin.active ? 'bad_password' : 'disabled' },
        success: false,
      });
      throw new HttpError(401, 'Invalid email or password', 'BAD_CREDENTIALS');
    }

    admin.failedLogins = 0;
    admin.lockUntil = null;
    admin.lastLoginAt = new Date();
    admin.lastLoginIp = req.ip || '';
    await admin.save();

    setSessionCookie(res, admin);
    req.admin = admin;
    await audit(req, 'auth.login', { targetType: 'admin', targetId: admin._id });
    res.json({ admin: sessionView(admin) });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ admin: sessionView(req.admin) });
  }),
);

router.post(
  '/change-password',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const current = String(req.body?.currentPassword || '');
    const next = String(req.body?.newPassword || '');
    const admin = await AdminUser.findById(req.admin._id);
    if (!admin || !(await verifyPassword(current, admin.passwordHash))) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    const problem = passwordProblem(next);
    if (problem) throw new HttpError(400, problem);
    if (await verifyPassword(next, admin.passwordHash)) {
      throw new HttpError(400, 'New password must be different');
    }
    admin.passwordHash = await hashPassword(next);
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    admin.mustChangePassword = false;
    await admin.save();
    setSessionCookie(res, admin);
    await audit(req, 'auth.change_password', { targetType: 'admin', targetId: admin._id });
    res.json({ admin: sessionView(admin) });
  }),
);

module.exports = router;
