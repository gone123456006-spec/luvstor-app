/**
 * SMTP configuration from environment variables.
 * Supports Gmail, Outlook, SendGrid, Mailgun, or any standard SMTP host.
 */

const PLACEHOLDER_VALUES = new Set([
  '',
  'your_gmail@gmail.com',
  'your_gmail_app_password',
  'your_email@example.com',
  'your_smtp_password',
]);

function env(key, fallback = '') {
  return (process.env[key] || fallback).trim();
}

function isPlaceholder(value) {
  return PLACEHOLDER_VALUES.has(String(value || '').trim());
}

const smtpConfig = {
  host: env('SMTP_HOST', 'smtp.gmail.com'),
  port: parseInt(env('SMTP_PORT', '587'), 10),
  secure: env('SMTP_SECURE', 'false').toLowerCase() === 'true',
  user: env('SMTP_USER'),
  pass: env('SMTP_PASS'),
  fromName: env('SMTP_FROM_NAME', 'Luvstor'),
  fromEmail: env('SMTP_FROM_EMAIL') || env('SMTP_USER'),
  devMode: env('SMTP_DEV_MODE', 'false').toLowerCase() === 'true',
  otpExpiryMinutes: parseInt(env('OTP_EXPIRY_MINUTES', '10'), 10),
  resendCooldownSeconds: parseInt(env('OTP_RESEND_COOLDOWN_SECONDS', '60'), 10),
  maxSendsPerHour: parseInt(env('OTP_MAX_SENDS_PER_HOUR', '5'), 10),
  maxVerifyAttempts: parseInt(env('OTP_MAX_VERIFY_ATTEMPTS', '5'), 10),
};

function isSmtpConfigured() {
  return !isPlaceholder(smtpConfig.user) && !isPlaceholder(smtpConfig.pass);
}

function shouldUseDevMode() {
  if (smtpConfig.devMode) return true;
  if (!isSmtpConfigured() && process.env.NODE_ENV !== 'production') return true;
  return false;
}

function getFromAddress() {
  const email = smtpConfig.fromEmail || smtpConfig.user;
  return `"${smtpConfig.fromName}" <${email}>`;
}

module.exports = {
  smtpConfig,
  isSmtpConfigured,
  shouldUseDevMode,
  getFromAddress,
  isPlaceholder,
};
