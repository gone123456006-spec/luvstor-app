/**
 * Production environment validation and helpers (Render, etc.).
 */

const WEAK_JWT_SECRETS = new Set([
  '',
  'change_this_to_a_long_random_secret',
  'secret',
  'jwt_secret',
  'your_jwt_secret',
]);

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function validateProductionEnv() {
  if (!isProduction()) return;

  const errors = [];
  const warnings = [];

  if (!process.env.MONGODB_URI?.trim()) {
    errors.push('MONGODB_URI is required in production');
  }

  const jwt = String(process.env.JWT_SECRET || '').trim();
  if (!jwt || WEAK_JWT_SECRETS.has(jwt) || jwt.length < 32) {
    errors.push(
      'JWT_SECRET must be set to a random string of at least 32 characters',
    );
  }

  if (!process.env.REDIS_URL?.trim()) {
    warnings.push(
      'REDIS_URL is not set — running single-instance mode (OK for launch, add Redis before scaling)',
    );
  }

  const hasFirebase =
    process.env.FIREBASE_SERVICE_ACCOUNT?.trim()?.startsWith('{') ||
    Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim()) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());

  if (!hasFirebase) {
    warnings.push(
      'Firebase credentials missing — set FIREBASE_SERVICE_ACCOUNT_BASE64 for FCM push',
    );
  }

  if (!process.env.GOOGLE_WEB_CLIENT_ID?.trim()) {
    warnings.push('GOOGLE_WEB_CLIENT_ID not set — Google Sign-In disabled');
  }

  if (!process.env.HEARTBEAT_SECRET?.trim()) {
    warnings.push(
      'HEARTBEAT_SECRET not set — /ping is open in production (Render blueprint auto-generates this)',
    );
  }

  if (warnings.length) {
    console.warn('[Production] Warnings:');
    warnings.forEach((w) => console.warn(`  ⚠️  ${w}`));
  }

  if (errors.length) {
    console.error('[Production] Fatal configuration errors:');
    errors.forEach((e) => console.error(`  ❌ ${e}`));
    throw new Error('Fix environment variables before deploying to production');
  }

  console.log('✅ Production environment validation passed');
}

module.exports = {
  isProduction,
  validateProductionEnv,
};
