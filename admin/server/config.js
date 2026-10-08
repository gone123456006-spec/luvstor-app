const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function str(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

const isProd = str('NODE_ENV') === 'production';

const config = {
  isProd,
  port: Number(str('PORT', '4000')) || 4000,
  mongoUri: str('MONGODB_URI'),
  jwtSecret: str('ADMIN_JWT_SECRET'),
  sessionHours: Math.min(Math.max(Number(str('ADMIN_SESSION_HOURS', '8')) || 8, 1), 72),
  mainApiUrl: str('MAIN_API_URL').replace(/\/+$/, ''),
  mainAdminKey: str('MAIN_ADMIN_API_KEY'),
  mediaBaseUrl: (str('MEDIA_BASE_URL') || str('MAIN_API_URL')).replace(/\/+$/, ''),
  razorpayKeyId: str('RAZORPAY_KEY_ID'),
  razorpayKeySecret: str('RAZORPAY_KEY_SECRET'),
  trustProxy: Number(str('TRUST_PROXY', isProd ? '1' : '0')) || 0,
  cookieName: 'lv_admin',
  /** Authenticator-app codes required for every admin (set ADMIN_MFA_REQUIRED=false to make it optional) */
  requireMfa: str('ADMIN_MFA_REQUIRED', 'true').toLowerCase() !== 'false',
  /** Encrypts stored MFA secrets; defaults to ADMIN_JWT_SECRET. Keep it stable or MFA must be reset. */
  mfaKey: str('ADMIN_MFA_KEY'),
};

function validateConfig() {
  const problems = [];
  if (!config.mongoUri) problems.push('MONGODB_URI is required');
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    problems.push('ADMIN_JWT_SECRET must be at least 32 characters');
  }
  if (!config.mainApiUrl) problems.push('MAIN_API_URL is required');
  if (!config.mainAdminKey) problems.push('MAIN_ADMIN_API_KEY is required');
  return problems;
}

module.exports = { config, validateConfig };
