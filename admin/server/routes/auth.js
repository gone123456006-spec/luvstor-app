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
const {
  requireAdmin,
  setSessionCookie,
  clearSessionCookie,
  signMfaChallenge,
  verifyMfaChallenge,
  mfaSetupRequired,
} = require('../middleware/auth');
const totp = require('../lib/totp');

const router = express.Router();

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

async function registerFailure(admin) {
  admin.failedLogins = (admin.failedLogins || 0) + 1;
  if (admin.failedLogins >= MAX_FAILED) {
    admin.lockUntil = new Date(Date.now() + LOCK_MS);
    admin.failedLogins = 0;
  }
  await admin.save();
}

function assertNotLocked(admin) {
  if (admin.lockUntil && admin.lockUntil > new Date()) {
    const mins = Math.ceil((admin.lockUntil - Date.now()) / 60000);
    throw new HttpError(423, `Account locked. Try again in ${mins} min.`, 'LOCKED');
  }
}

/**
 * Checks an authenticator code (or a one-time recovery code) against the
 * admin's active secret and records it so it can't be reused. Caller saves.
 */
function consumeMfaCode(admin, code) {
  const secret = totp.decryptSecret(admin.mfaSecret);
  const step = secret ? totp.verifyCode(secret, code, { lastStep: admin.mfaLastStep ?? -1 }) : null;
  if (step !== null) {
    admin.mfaLastStep = step;
    return 'totp';
  }
  const hash = totp.hashRecoveryCode(code);
  const idx = (admin.mfaRecoveryCodes || []).indexOf(hash);
  if (String(code || '').replace(/[^A-Za-z0-9]/g, '').length === 8 && idx >= 0) {
    admin.mfaRecoveryCodes.splice(idx, 1);
    return 'recovery';
  }
  return null;
}

function issueRecoveryCodes(admin) {
  const codes = totp.generateRecoveryCodes();
  admin.mfaRecoveryCodes = codes.map(totp.hashRecoveryCode);
  return codes;
}

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
    mfaEnabled: !!admin.mfaEnabled,
    mfaSetupRequired: mfaSetupRequired(admin),
    mfaPolicyRequired: config.requireMfa,
    mfaRecoveryCodesLeft: (admin.mfaRecoveryCodes || []).length,
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
    assertNotLocked(admin);
    const ok = await verifyPassword(password, admin.passwordHash);
    if (!ok || !admin.active) {
      await registerFailure(admin);
      await audit(req, 'auth.login', {
        targetType: 'admin',
        targetId: admin._id,
        details: { email, reason: admin.active ? 'bad_password' : 'disabled' },
        success: false,
      });
      throw new HttpError(401, 'Invalid email or password', 'BAD_CREDENTIALS');
    }

    if (admin.mfaEnabled) {
      res.json({ mfaRequired: true, mfaToken: signMfaChallenge(admin) });
      return;
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
  '/mfa/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const challenge = verifyMfaChallenge(req.body?.mfaToken);
    if (!challenge) throw new HttpError(401, 'Sign-in expired. Enter your password again.', 'MFA_EXPIRED');
    const admin = await AdminUser.findById(challenge.sub);
    if (!admin || !admin.active || !admin.mfaEnabled || (admin.tokenVersion || 0) !== challenge.v) {
      throw new HttpError(401, 'Sign-in expired. Enter your password again.', 'MFA_EXPIRED');
    }
    assertNotLocked(admin);

    const method = consumeMfaCode(admin, req.body?.code);
    if (!method) {
      await registerFailure(admin);
      await audit(req, 'auth.mfa_login', {
        targetType: 'admin',
        targetId: admin._id,
        details: { email: admin.email },
        success: false,
      });
      throw new HttpError(401, 'Invalid code', 'BAD_MFA_CODE');
    }

    admin.failedLogins = 0;
    admin.lockUntil = null;
    admin.lastLoginAt = new Date();
    admin.lastLoginIp = req.ip || '';
    await admin.save();

    setSessionCookie(res, admin);
    req.admin = admin;
    await audit(req, 'auth.login', {
      targetType: 'admin',
      targetId: admin._id,
      details: { mfa: method, recoveryCodesLeft: method === 'recovery' ? admin.mfaRecoveryCodes.length : undefined },
    });
    res.json({ admin: sessionView(admin) });
  }),
);

const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

/** Starts setup: new secret kept as "pending" until a code from the app confirms it */
router.post(
  '/mfa/setup',
  requireAdmin,
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const admin = await AdminUser.findById(req.admin._id);
    if (!admin) throw new HttpError(401, 'Not signed in', 'NO_SESSION');
    if (admin.mfaEnabled) throw new HttpError(400, 'Two-factor authentication is already on');
    const secret = totp.generateSecret();
    admin.mfaPendingSecret = totp.encryptSecret(secret);
    await admin.save();
    const otpauthUrl = totp.otpauthUrl(secret, admin.email);
    let qr = '';
    try {
      qr = await require('qrcode').toDataURL(otpauthUrl, { margin: 1, width: 220 });
    } catch {
      qr = '';
    }
    res.json({ secret, otpauthUrl, qr });
  }),
);

router.post(
  '/mfa/enable',
  requireAdmin,
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const admin = await AdminUser.findById(req.admin._id);
    if (!admin) throw new HttpError(401, 'Not signed in', 'NO_SESSION');
    if (admin.mfaEnabled) throw new HttpError(400, 'Two-factor authentication is already on');
    const secret = totp.decryptSecret(admin.mfaPendingSecret);
    if (!secret) throw new HttpError(400, 'Start setup again');
    const step = totp.verifyCode(secret, req.body?.code);
    if (step === null) throw new HttpError(400, 'That code is not correct. Check the time on your phone and try again.');

    admin.mfaSecret = admin.mfaPendingSecret;
    admin.mfaPendingSecret = '';
    admin.mfaEnabled = true;
    admin.mfaEnabledAt = new Date();
    admin.mfaLastStep = step;
    const recoveryCodes = issueRecoveryCodes(admin);
    // Sign out other sessions that were opened without MFA
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    await admin.save();
    setSessionCookie(res, admin);
    await audit(req, 'auth.mfa_enable', { targetType: 'admin', targetId: admin._id });
    res.json({ admin: sessionView(admin), recoveryCodes });
  }),
);

router.post(
  '/mfa/disable',
  requireAdmin,
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const admin = await AdminUser.findById(req.admin._id);
    if (!admin) throw new HttpError(401, 'Not signed in', 'NO_SESSION');
    if (!admin.mfaEnabled) throw new HttpError(400, 'Two-factor authentication is not on');
    if (config.requireMfa) {
      throw new HttpError(400, 'Two-factor authentication is required for all admins and cannot be turned off');
    }
    if (!(await verifyPassword(String(req.body?.password || ''), admin.passwordHash))) {
      throw new HttpError(400, 'Password is incorrect');
    }
    if (!consumeMfaCode(admin, req.body?.code)) throw new HttpError(400, 'Invalid code');
    admin.mfaEnabled = false;
    admin.mfaSecret = '';
    admin.mfaPendingSecret = '';
    admin.mfaRecoveryCodes = [];
    admin.mfaLastStep = -1;
    admin.mfaEnabledAt = null;
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    await admin.save();
    setSessionCookie(res, admin);
    await audit(req, 'auth.mfa_disable', { targetType: 'admin', targetId: admin._id });
    res.json({ admin: sessionView(admin) });
  }),
);

router.post(
  '/mfa/recovery-codes',
  requireAdmin,
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const admin = await AdminUser.findById(req.admin._id);
    if (!admin) throw new HttpError(401, 'Not signed in', 'NO_SESSION');
    if (!admin.mfaEnabled) throw new HttpError(400, 'Two-factor authentication is not on');
    const secret = totp.decryptSecret(admin.mfaSecret);
    const step = secret ? totp.verifyCode(secret, req.body?.code, { lastStep: admin.mfaLastStep ?? -1 }) : null;
    if (step === null) throw new HttpError(400, 'Enter a current code from your authenticator app');
    admin.mfaLastStep = step;
    const recoveryCodes = issueRecoveryCodes(admin);
    await admin.save();
    await audit(req, 'auth.mfa_recovery_codes', { targetType: 'admin', targetId: admin._id });
    res.json({ admin: sessionView(admin), recoveryCodes });
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
