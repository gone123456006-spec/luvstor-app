const crypto = require("crypto");
const nodemailer = require("nodemailer");
const {
  smtpConfig,
  isSmtpConfigured,
  isBrevoApiConfigured,
  isEmailConfigured,
  isRenderHost,
  shouldUseBrevoApi,
  shouldUseDevMode,
  getFromAddress,
  getFromParts,
} = require("../config/smtp");
const {
  buildOtpHtml,
  buildOtpText,
  buildOtpSubject,
} = require("./emailTemplates");

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";

let transporter = null;
let transporterVerified = false;
let emailMode = null; // 'dev' | 'brevo-api' | 'smtp' | 'unconfigured'

function createTransporter() {
  if (shouldUseDevMode()) return null;

  if (!isSmtpConfigured()) {
    throw new Error(
      "SMTP is not configured. Set SMTP_USER and SMTP_PASS, or BREVO_API_KEY for Render.",
    );
  }

  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass,
    },
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
    name: smtpConfig.host,
  });
}

function getTransporter() {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
}

async function sendViaBrevoApi({ to, subject, text, html }) {
  const from = getFromParts();
  if (!from.email) {
    throw new Error("SMTP_FROM_EMAIL (or SMTP_USER) is required for Brevo API");
  }

  const res = await fetch(BREVO_SEND_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": smtpConfig.brevoApiKey,
    },
    body: JSON.stringify({
      sender: { name: from.name, email: from.email },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      body?.message ||
      body?.error ||
      (Array.isArray(body?.code) ? JSON.stringify(body) : null) ||
      `HTTP ${res.status}`;
    const err = new Error(`Brevo API: ${detail}`);
    err.code = "BREVO_API";
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return { messageId: body.messageId || body.messageIds?.[0] || "brevo-api" };
}

async function verifySmtpConnection() {
  if (shouldUseDevMode()) {
    emailMode = "dev";
    console.warn(
      "⚠️  SMTP DEV MODE: OTP codes are logged to the console (no email sent).",
    );
    console.warn(
      "   Set BREVO_API_KEY (recommended on Render) or SMTP_USER + SMTP_PASS.",
    );
    return { ok: true, mode: "dev" };
  }

  // Render free tier blocks SMTP — use Brevo HTTPS API
  if (shouldUseBrevoApi()) {
    emailMode = "brevo-api";
    transporterVerified = true;
    console.log(
      `✅ Email ready via Brevo HTTPS API (from ${getFromParts().email})`,
    );
    if (isRenderHost()) {
      console.log(
        "   Render blocks SMTP ports 25/465/587 — API on :443 is required.",
      );
    }
    return { ok: true, mode: "brevo-api" };
  }

  if (isRenderHost() && !isBrevoApiConfigured()) {
    emailMode = "unconfigured";
    console.error(
      "❌ Render free tier blocks outbound SMTP (ports 25/465/587).",
    );
    console.error(
      "   Add BREVO_API_KEY in the Render dashboard (Brevo → SMTP & API → API keys).",
    );
    console.error(
      "   OTP emails will fail until BREVO_API_KEY is set. SMTP_* alone is not enough on Render free.",
    );
    return { ok: false, mode: "render-smtp-blocked" };
  }

  if (!isSmtpConfigured()) {
    emailMode = "unconfigured";
    console.error(
      "❌ Email not configured. Set BREVO_API_KEY or SMTP_USER + SMTP_PASS.",
    );
    return { ok: false, mode: "unconfigured" };
  }

  try {
    const transport = getTransporter();
    await transport.verify();
    transporterVerified = true;
    emailMode = "smtp";
    console.log(
      `✅ SMTP connected: ${smtpConfig.host}:${smtpConfig.port} as ${smtpConfig.user}`,
    );
    return {
      ok: true,
      mode: "smtp",
      host: smtpConfig.host,
      port: smtpConfig.port,
    };
  } catch (err) {
    emailMode = "smtp-failed";
    throw err;
  }
}

function getSmtpStatus() {
  return {
    configured: isEmailConfigured(),
    smtpConfigured: isSmtpConfigured(),
    brevoApiConfigured: isBrevoApiConfigured(),
    verified: transporterVerified,
    mode: emailMode,
    usingBrevoApi: shouldUseBrevoApi(),
    onRender: isRenderHost(),
    devMode: shouldUseDevMode(),
    host: smtpConfig.host,
    port: smtpConfig.port,
    from: getFromAddress(),
  };
}

function generateOTP() {
  if (shouldUseDevMode()) {
    return "123456";
  }
  return String(crypto.randomInt(100000, 1000000));
}

async function sendOTPEmail(to, otp) {
  const expiryMinutes = smtpConfig.otpExpiryMinutes;

  if (shouldUseDevMode()) {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`📧 DEV OTP for ${to}: ${otp}`);
    console.log(`   Expires in ${expiryMinutes} minutes`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { messageId: "dev-mode", dev: true };
  }

  if (!isEmailConfigured()) {
    const hint = isRenderHost()
      ? "Set BREVO_API_KEY on Render (SMTP ports are blocked on free tier)."
      : "Set BREVO_API_KEY or SMTP_USER + SMTP_PASS.";
    throw new Error(`Email is not configured. ${hint}`);
  }

  const subject = buildOtpSubject(otp);
  const text = buildOtpText(otp, expiryMinutes, to);
  const html = buildOtpHtml(otp, expiryMinutes, to);

  if (shouldUseBrevoApi()) {
    return sendViaBrevoApi({ to, subject, text, html });
  }

  if (isRenderHost()) {
    const err = new Error(
      "Cannot send email: Render free tier blocks SMTP. Set BREVO_API_KEY.",
    );
    err.code = "RENDER_SMTP_BLOCKED";
    throw err;
  }

  const transport = getTransporter();
  return transport.sendMail({
    from: getFromAddress(),
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  generateOTP,
  sendOTPEmail,
  verifySmtpConnection,
  getSmtpStatus,
  shouldUseDevMode,
  isSmtpConfigured,
  isBrevoApiConfigured,
  isEmailConfigured,
};
