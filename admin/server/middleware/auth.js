const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { AdminUser } = require('../models/admin');
const { can } = require('../lib/permissions');
const { HttpError } = require('../lib/http');

const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'luvstor-admin';

function signSession(admin) {
  return jwt.sign(
    { sub: String(admin._id), v: admin.tokenVersion || 0, r: admin.role },
    config.jwtSecret,
    { expiresIn: `${config.sessionHours}h`, issuer: 'luvstor-admin' },
  );
}

/** Proves the password step passed; only exchangeable for a session with a valid MFA code */
function signMfaChallenge(admin) {
  return jwt.sign({ sub: String(admin._id), v: admin.tokenVersion || 0 }, config.jwtSecret, {
    expiresIn: '5m',
    issuer: 'luvstor-admin-mfa',
  });
}

function verifyMfaChallenge(token) {
  try {
    return jwt.verify(String(token || ''), config.jwtSecret, {
      issuer: 'luvstor-admin-mfa',
      algorithms: ['HS256'],
    });
  } catch {
    return null;
  }
}

function mfaSetupRequired(admin) {
  return config.requireMfa && !admin?.mfaEnabled;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: config.sessionHours * 60 * 60 * 1000,
  };
}

function setSessionCookie(res, admin) {
  res.cookie(config.cookieName, signSession(admin), cookieOptions());
}

function clearSessionCookie(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(config.cookieName, opts);
}

/**
 * Mutating requests must carry a custom header. Browsers can't add it
 * cross-site without CORS (which this server never enables), and the cookie
 * is SameSite=Strict — together that blocks CSRF.
 */
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) !== CSRF_VALUE) {
    return next(new HttpError(403, 'Missing CSRF header', 'CSRF'));
  }
  return next();
}

async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.[config.cookieName];
    if (!token) throw new HttpError(401, 'Not signed in', 'NO_SESSION');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, {
        issuer: 'luvstor-admin',
        algorithms: ['HS256'],
      });
    } catch {
      clearSessionCookie(res);
      throw new HttpError(401, 'Session expired', 'SESSION_EXPIRED');
    }
    const admin = await AdminUser.findById(payload.sub).lean();
    if (!admin || !admin.active || (admin.tokenVersion || 0) !== payload.v) {
      clearSessionCookie(res);
      throw new HttpError(401, 'Session revoked', 'SESSION_REVOKED');
    }
    req.admin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
}

function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.admin || !can(req.admin.role, permission)) {
      return next(new HttpError(403, 'You do not have permission for this action', 'FORBIDDEN'));
    }
    // Force a password change before anything else
    if (req.admin.mustChangePassword) {
      return next(new HttpError(403, 'Change your password to continue', 'MUST_CHANGE_PASSWORD'));
    }
    if (mfaSetupRequired(req.admin)) {
      return next(new HttpError(403, 'Set up two-factor authentication to continue', 'MFA_SETUP_REQUIRED'));
    }
    return next();
  };
}

module.exports = {
  CSRF_HEADER,
  CSRF_VALUE,
  csrfGuard,
  requireAdmin,
  requirePermission,
  setSessionCookie,
  clearSessionCookie,
  signMfaChallenge,
  verifyMfaChallenge,
  mfaSetupRequired,
};
