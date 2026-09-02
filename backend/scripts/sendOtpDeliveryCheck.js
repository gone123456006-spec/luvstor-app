require('dotenv').config();
const nodemailer = require('nodemailer');

const to = process.argv[2] || 'shyamroaster@gmail.com';
const otp = String(Math.floor(100000 + Math.random() * 900000));

async function sendWith(label, options) {
  const transporter = nodemailer.createTransport(options.transport);
  await transporter.verify();
  console.log(label, 'VERIFY_OK');
  const info = await transporter.sendMail({
    from: options.from,
    to,
    subject: 'Luvstor verification code',
    text: `Your Luvstor code is ${otp}. Valid for 10 minutes.`,
    html: `<div style="font-family:Arial,sans-serif;padding:24px"><h2>Luvstor</h2><p>Your verification code:</p><p style="font-size:32px;letter-spacing:6px;font-weight:bold">${otp}</p><p>Valid for 10 minutes.</p></div>`,
  });
  console.log(label, 'SEND_OK', info.response || info.messageId);
  return info;
}

async function main() {
  console.log('To:', to);
  console.log('OTP_CODE:', otp);

  // Gmail SMTP delivers reliably to Gmail inboxes (Brevo + From @gmail.com is blocked by Gmail DMARC)
  const gmailUser = process.env.GMAIL_SMTP_USER || 'luvstorauth@gmail.com';
  const gmailPass = process.env.GMAIL_SMTP_PASS || process.env.SMTP_PASS_GMAIL;
  if (!gmailPass) {
    // fall back: try current SMTP; if Brevo+gmail From, warn
    console.log('Trying configured SMTP...', process.env.SMTP_HOST);
  }

  if (process.env.GMAIL_SMTP_PASS || process.env.SMTP_PASS_GMAIL) {
    await sendWith('GMAIL', {
      transport: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: gmailUser, pass: process.env.GMAIL_SMTP_PASS || process.env.SMTP_PASS_GMAIL },
      },
      from: `"Luvstor" <${gmailUser}>`,
    });
    return;
  }

  await sendWith('CURRENT', {
    transport: {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    },
    from: `"${process.env.SMTP_FROM_NAME || 'Luvstor'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
  });
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
