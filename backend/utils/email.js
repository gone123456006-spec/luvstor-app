const crypto = require('crypto');
const nodemailer = require('nodemailer');
const {
  smtpConfig,
  isSmtpConfigured,
  shouldUseDevMode,
  getFromAddress,
} = require('../config/smtp');
const { buildOtpHtml, buildOtpText, buildOtpSubject } = require('./emailTemplates');

let transporter = null;
let transporterVerified = false;

function createTransporter() {
  if (shouldUseDevMode()) return null;

  if (!isSmtpConfigured()) {
    throw new Error(
      'SMTP is not configured. Set SMTP_USER and SMTP_PASS in backend/.env (use a Gmail App Password for Gmail).'
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
      minVersion: 'TLSv1.2',
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });
}

function getTransporter() {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
}

async function verifySmtpConnection() {
  if (shouldUseDevMode()) {
    console.warn('⚠️  SMTP DEV MODE: OTP codes are logged to the console (no email sent).');
    console.warn('   Set SMTP_USER + SMTP_PASS in .env and SMTP_DEV_MODE=false to send real emails.');
    return { ok: true, mode: 'dev' };
  }

  const transport = getTransporter();
  await transport.verify();
  transporterVerified = true;
  console.log(`✅ SMTP connected: ${smtpConfig.host}:${smtpConfig.port} as ${smtpConfig.user}`);
  return { ok: true, mode: 'smtp', host: smtpConfig.host, port: smtpConfig.port };
}

function getSmtpStatus() {
  return {
    configured: isSmtpConfigured(),
    verified: transporterVerified,
    devMode: shouldUseDevMode(),
    host: smtpConfig.host,
    port: smtpConfig.port,
    from: getFromAddress(),
  };
}

function generateOTP() {
  if (shouldUseDevMode()) {
    return '123456';
  }
  return String(crypto.randomInt(100000, 1000000));
}

async function sendOTPEmail(to, otp) {
  const expiryMinutes = smtpConfig.otpExpiryMinutes;

  if (shouldUseDevMode()) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📧 DEV OTP for ${to}: ${otp}`);
    console.log(`   Expires in ${expiryMinutes} minutes`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return { messageId: 'dev-mode', dev: true };
  }

  const mailOptions = {
    from: getFromAddress(),
    to,
    subject: buildOtpSubject(otp),
    text: buildOtpText(otp, expiryMinutes, to),
    html: buildOtpHtml(otp, expiryMinutes, to),
  };

  const transport = getTransporter();
  return transport.sendMail(mailOptions);
}

module.exports = {
  generateOTP,
  sendOTPEmail,
  verifySmtpConnection,
  getSmtpStatus,
  shouldUseDevMode,
  isSmtpConfigured,
};
