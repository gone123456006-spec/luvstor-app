/**
 * Email delivery config (Brevo SMTP + HTTPS API).
 *
 * Render free web services block outbound SMTP ports 25/465/587, so production
 * on Render must use BREVO_API_KEY (HTTPS :443) instead of SMTP.
 */

const PLACEHOLDER_VALUES = new Set([
  "",
  "your_gmail@gmail.com",
  "your_gmail_app_password",
  "your_email@example.com",
  "your_smtp_password",
  "your_brevo_smtp_key",
  "your_brevo_api_key",
  "REPLACE_WITH_BREVO_SMTP_KEY",
  "REPLACE_WITH_BREVO_API_KEY",
  "REPLACE_WITH_LUVSTORAPPS_GMAIL_APP_PASSWORD",
]);

function env(key, fallback = "") {
  return (process.env[key] || fallback).trim();
}

function isPlaceholder(value) {
  return PLACEHOLDER_VALUES.has(String(value || "").trim());
}

const smtpConfig = {
  host: env("SMTP_HOST", "smtp-relay.brevo.com"),
  port: parseInt(env("SMTP_PORT", "587"), 10),
  secure: env("SMTP_SECURE", "false").toLowerCase() === "true",
  user: env("SMTP_USER"),
  pass: env("SMTP_PASS"),
  fromName: env("SMTP_FROM_NAME", "Luvstor"),
  fromEmail: env("SMTP_FROM_EMAIL") || env("SMTP_USER"),
  // Prefer dedicated API key; accept common aliases
  brevoApiKey:
    env("BREVO_API_KEY") ||
    env("SENDINBLUE_API_KEY") ||
    env("SIB_API_KEY"),
  devMode: env("SMTP_DEV_MODE", "false").toLowerCase() === "true",
  otpExpiryMinutes: parseInt(env("OTP_EXPIRY_MINUTES", "10"), 10),
  resendCooldownSeconds: parseInt(env("OTP_RESEND_COOLDOWN_SECONDS", "60"), 10),
  maxSendsPerHour: parseInt(env("OTP_MAX_SENDS_PER_HOUR", "5"), 10),
  maxVerifyAttempts: parseInt(env("OTP_MAX_VERIFY_ATTEMPTS", "5"), 10),
};

function isSmtpConfigured() {
  return !isPlaceholder(smtpConfig.user) && !isPlaceholder(smtpConfig.pass);
}

function isBrevoApiConfigured() {
  return !isPlaceholder(smtpConfig.brevoApiKey);
}

/** True when email can actually be sent (API or SMTP credentials present). */
function isEmailConfigured() {
  return isBrevoApiConfigured() || isSmtpConfigured();
}

function isRenderHost() {
  return (
    env("RENDER").toLowerCase() === "true" ||
    Boolean(env("RENDER_EXTERNAL_URL")) ||
    Boolean(env("RENDER_SERVICE_ID"))
  );
}

/**
 * On Render free tier, SMTP ports are blocked — use HTTPS API.
 * Elsewhere, prefer API when configured, else SMTP.
 */
function shouldUseBrevoApi() {
  if (!isBrevoApiConfigured()) return false;
  if (isRenderHost()) return true;
  const force = env("EMAIL_TRANSPORT", "").toLowerCase();
  if (force === "smtp") return false;
  if (force === "brevo-api" || force === "api") return true;
  // Prefer API whenever the key exists (more reliable than SMTP)
  return true;
}

function shouldUseDevMode() {
  if (smtpConfig.devMode) return true;
  if (!isEmailConfigured() && process.env.NODE_ENV !== "production") return true;
  return false;
}

function getFromAddress() {
  const email = smtpConfig.fromEmail || smtpConfig.user;
  return `"${smtpConfig.fromName}" <${email}>`;
}

function getFromParts() {
  return {
    name: smtpConfig.fromName || "Luvstor",
    email: smtpConfig.fromEmail || smtpConfig.user,
  };
}

module.exports = {
  smtpConfig,
  isSmtpConfigured,
  isBrevoApiConfigured,
  isEmailConfigured,
  isRenderHost,
  shouldUseBrevoApi,
  shouldUseDevMode,
  getFromAddress,
  getFromParts,
  isPlaceholder,
};
