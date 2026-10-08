const express = require('express');
const crypto = require('crypto');
const { AdminUser, ROLES } = require('../models/admin');
const { asyncHandler, HttpError, cleanText, toObjectId } = require('../lib/http');
const { audit } = require('../lib/audit');
const { hashPassword } = require('../lib/passwords');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requirePermission('admins.manage'));

function view(a) {
  return {
    id: String(a._id),
    email: a.email,
    name: a.name || '',
    role: a.role,
    active: !!a.active,
    lastLoginAt: a.lastLoginAt,
    lockedUntil: a.lockUntil && a.lockUntil > new Date() ? a.lockUntil : null,
    mustChangePassword: !!a.mustChangePassword,
    mfaEnabled: !!a.mfaEnabled,
    createdAt: a.createdAt,
  };
}

/** Temporary password shown once to the owner; admin must change it on first login. */
function tempPassword() {
  return `${crypto.randomBytes(9).toString('base64url')}#A7`;
}

async function assertNotLastOwner(target, nextRole, nextActive) {
  if (target.role !== 'owner') return;
  const losesOwner = nextRole !== 'owner' || nextActive === false;
  if (!losesOwner) return;
  const owners = await AdminUser.countDocuments({ role: 'owner', active: true });
  if (owners <= 1) throw new HttpError(400, 'There must be at least one active owner');
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const admins = await AdminUser.find().sort({ createdAt: 1 }).lean();
    res.json({ admins: admins.map(view), roles: ROLES });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const email = cleanText(req.body?.email, 200).toLowerCase();
    const name = cleanText(req.body?.name, 80);
    const role = String(req.body?.role || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Valid email required');
    if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
    if (await AdminUser.exists({ email })) throw new HttpError(409, 'An admin with this email exists');

    const password = tempPassword();
    const admin = await AdminUser.create({
      email,
      name,
      role,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
    });
    await audit(req, 'admins.create', { targetType: 'admin', targetId: admin._id, details: { email, role } });
    res.status(201).json({ admin: view(admin), temporaryPassword: password });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const admin = await AdminUser.findById(toObjectId(req.params.id));
    if (!admin) throw new HttpError(404, 'Admin not found');

    const changes = {};
    const nextRole = req.body?.role !== undefined ? String(req.body.role) : admin.role;
    const nextActive = req.body?.active !== undefined ? Boolean(req.body.active) : admin.active;
    if (!ROLES.includes(nextRole)) throw new HttpError(400, 'Invalid role');
    if (String(admin._id) === String(req.admin._id) && (nextRole !== admin.role || !nextActive)) {
      throw new HttpError(400, 'You cannot change your own role or disable yourself');
    }
    await assertNotLastOwner(admin, nextRole, nextActive);

    if (nextRole !== admin.role) changes.role = [admin.role, nextRole];
    if (nextActive !== admin.active) changes.active = [admin.active, nextActive];
    admin.role = nextRole;
    admin.active = nextActive;
    if (req.body?.name !== undefined) admin.name = cleanText(req.body.name, 80);

    let temporaryPassword;
    if (req.body?.resetPassword === true) {
      temporaryPassword = tempPassword();
      admin.passwordHash = await hashPassword(temporaryPassword);
      admin.mustChangePassword = true;
      changes.passwordReset = true;
    }
    if (req.body?.unlock === true) {
      admin.lockUntil = null;
      admin.failedLogins = 0;
      changes.unlocked = true;
    }
    if (req.body?.resetMfa === true) {
      if (String(admin._id) === String(req.admin._id)) {
        throw new HttpError(400, 'Use your Account page to manage your own two-factor authentication');
      }
      admin.mfaEnabled = false;
      admin.mfaSecret = '';
      admin.mfaPendingSecret = '';
      admin.mfaRecoveryCodes = [];
      admin.mfaLastStep = -1;
      admin.mfaEnabledAt = null;
      changes.mfaReset = true;
    }
    // Any security-relevant change kills existing sessions
    if (changes.role || changes.active || changes.passwordReset || changes.mfaReset) {
      admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    }
    await admin.save();
    await audit(req, 'admins.update', { targetType: 'admin', targetId: admin._id, details: changes });
    res.json({ admin: view(admin), temporaryPassword });
  }),
);

module.exports = router;
