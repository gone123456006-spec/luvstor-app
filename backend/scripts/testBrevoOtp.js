require("dotenv").config();
const nodemailer = require("nodemailer");

const to = process.argv[2] || "Shyam123456006@gmail.com";
const otp = String(Math.floor(100000 + Math.random() * 900000));

async function main() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const fromEmail = process.env.SMTP_FROM_EMAIL || user;
  const fromName = process.env.SMTP_FROM_NAME || "Luvstor";

  console.log("Host:", host);
  console.log("User:", user);
  console.log("From:", `${fromName} <${fromEmail}>`);
  console.log("To:", to);

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user, pass },
  });

  await transporter.verify();
  console.log("VERIFY_OK");

  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: "Luvstor OTP",
    text: `Your Luvstor verification code is ${otp}. It expires in 10 minutes.`,
    html: `<p>Your Luvstor verification code is <b style="font-size:20px">${otp}</b>.</p><p>It expires in 10 minutes.</p>`,
  });

  console.log("SEND_OK", info.messageId || info.response);
  console.log("OTP_CODE", otp);
}

main().catch((err) => {
  console.error("SMTP_FAIL", err.message);
  process.exit(1);
});
