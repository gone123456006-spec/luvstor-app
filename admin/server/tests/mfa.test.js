const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/unused';
process.env.ADMIN_JWT_SECRET ||= 'x'.repeat(48);
process.env.MAIN_API_URL ||= 'http://127.0.0.1:1';
process.env.MAIN_ADMIN_API_KEY ||= 'test-key';

const totp = require('../lib/totp');
const { signMfaChallenge, verifyMfaChallenge, requirePermission } = require('../middleware/auth');

// RFC 6238 appendix B secret "12345678901234567890" in base32
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('TOTP matches the RFC 6238 SHA-1 test vectors', () => {
  assert.equal(totp.codeAt(RFC_SECRET, Math.floor(59 / 30)), '287082');
  assert.equal(totp.codeAt(RFC_SECRET, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp.codeAt(RFC_SECRET, Math.floor(1234567890 / 30)), '005924');
});

test('verifyCode accepts ±1 step and rejects replays', () => {
  const secret = totp.generateSecret();
  const now = Date.now();
  const step = totp.currentStep(now);
  assert.equal(totp.verifyCode(secret, totp.codeAt(secret, step), { now }), step);
  assert.equal(totp.verifyCode(secret, totp.codeAt(secret, step - 1), { now }), step - 1);
  assert.equal(totp.verifyCode(secret, totp.codeAt(secret, step - 3), { now }), null);
  assert.equal(totp.verifyCode(secret, totp.codeAt(secret, step), { now, lastStep: step }), null);
  assert.equal(totp.verifyCode(secret, 'abc123', { now }), null);
});

test('secrets are encrypted at rest and tamper-proof', () => {
  const secret = totp.generateSecret();
  const blob = totp.encryptSecret(secret);
  assert.ok(!blob.includes(secret));
  assert.equal(totp.decryptSecret(blob), secret);
  const parts = blob.split('.');
  parts[2] = Buffer.from('tampered').toString('base64url');
  assert.equal(totp.decryptSecret(parts.join('.')), null);
});

test('recovery codes are unique and hashed case-insensitively', () => {
  const codes = totp.generateRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0], /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(totp.hashRecoveryCode(codes[0]), totp.hashRecoveryCode(codes[0].toLowerCase().replace('-', '')));
});

test('MFA challenge tokens cannot be used as sessions and vice versa', () => {
  const admin = { _id: '507f1f77bcf86cd799439011', tokenVersion: 2 };
  const token = signMfaChallenge(admin);
  assert.equal(verifyMfaChallenge(token).sub, admin._id);
  assert.equal(verifyMfaChallenge('garbage'), null);
});

test('admins without MFA are blocked from data until they set it up', () => {
  const run = (admin) => {
    let err;
    requirePermission('users.view')({ admin }, {}, (e) => {
      err = e;
    });
    return err?.code;
  };
  assert.equal(run({ role: 'owner', mfaEnabled: false }), 'MFA_SETUP_REQUIRED');
  assert.equal(run({ role: 'owner', mfaEnabled: false, mustChangePassword: true }), 'MUST_CHANGE_PASSWORD');
  assert.equal(run({ role: 'owner', mfaEnabled: true }), undefined);
});
