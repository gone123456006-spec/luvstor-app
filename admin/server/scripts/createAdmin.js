/**
 * Create (or reset) an admin account from the command line.
 *   npm run create-admin -- --email you@example.com --name "You" [--role owner]
 * Prints a one-time temporary password; it must be changed on first sign-in.
 */
const crypto = require('crypto');
const { config } = require('../config');
const { connectDb, ensureAdminIndexes, mongoose } = require('../db');
const { AdminUser, ROLES } = require('../models/admin');
const { hashPassword } = require('../lib/passwords');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function run() {
  const email = String(arg('email') || '').trim().toLowerCase();
  const name = String(arg('name') || '').trim();
  const role = String(arg('role') || 'owner');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('--email is required');
  if (!ROLES.includes(role)) throw new Error(`--role must be one of ${ROLES.join(', ')}`);
  if (!config.mongoUri) throw new Error('MONGODB_URI is not set (admin/.env)');

  await connectDb();
  await ensureAdminIndexes();
  const password = `${crypto.randomBytes(12).toString('base64url')}#A7`;
  const passwordHash = await hashPassword(password);
  const existing = await AdminUser.findOne({ email });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = role;
    existing.active = true;
    existing.mustChangePassword = true;
    existing.failedLogins = 0;
    existing.lockUntil = null;
    existing.tokenVersion = (existing.tokenVersion || 0) + 1;
    if (name) existing.name = name;
    await existing.save();
    console.log(`Reset admin ${email} (${role}).`);
  } else {
    await AdminUser.create({ email, name, role, passwordHash, mustChangePassword: true });
    console.log(`Created admin ${email} (${role}).`);
  }
  console.log(`Temporary password (shown once): ${password}`);
}

run()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close().catch(() => {}));
