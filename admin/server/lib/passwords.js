const bcrypt = require('bcryptjs');

const BCRYPT_COST = 12;
const MIN_LENGTH = 12;

function passwordProblem(password) {
  const p = String(password || '');
  if (p.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters`;
  if (p.length > 128) return 'Password must be at most 128 characters';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length;
  if (classes < 3) return 'Use at least 3 of: lowercase, uppercase, number, symbol';
  return null;
}

function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_COST);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(String(password || ''), String(hash || ''));
}

// Constant-ish timing for unknown emails
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

module.exports = { passwordProblem, hashPassword, verifyPassword, DUMMY_HASH, MIN_LENGTH };
