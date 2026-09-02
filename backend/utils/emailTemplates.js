function formatOtpDisplay(otp) {
  const d = String(otp).replace(/\D/g, "");
  return d.length === 6 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Google Account–style verification email for Luvstor OTP.
 * Layout mirrors Google sign-in codes: clean card, large code, short security copy.
 */
function buildOtpHtml(otp, expiryMinutes, recipientEmail = "") {
  const codeDisplay = formatOtpDisplay(otp);
  const safeEmail = escapeHtml(recipientEmail);
  const year = new Date().getFullYear();
  const greeting = safeEmail
    ? `Hi <a href="mailto:${safeEmail}" style="color:#1a73e8;text-decoration:none;">${safeEmail}</a>,`
    : "Hi,";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(String(otp))} is your Luvstor verification code</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f9;font-family:'Google Sans',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f0f4f9;padding:40px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:460px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e0e3e8;">

          <!-- Logo -->
          <tr>
            <td style="padding:36px 40px 0;" align="center">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="width:48px;height:48px;border-radius:24px;background:#1a73e8;">
                    <span style="display:block;font-size:22px;font-weight:700;color:#ffffff;line-height:48px;font-family:Roboto,Arial,sans-serif;">L</span>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;font-size:20px;font-weight:500;color:#202124;letter-spacing:-0.2px;">
                <span style="color:#1a73e8;">Luv</span>stor
              </p>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:28px 40px 0;" align="center">
              <h1 style="margin:0;font-size:24px;font-weight:400;line-height:32px;color:#202124;">
                Your Luvstor verification code
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 40px 0;">
              <p style="margin:0 0 16px;font-size:14px;line-height:20px;color:#3c4043;">
                ${greeting}
              </p>
              <p style="margin:0;font-size:14px;line-height:20px;color:#3c4043;">
                We received a request to sign in to your Luvstor account.
                Your verification code is:
              </p>
            </td>
          </tr>

          <!-- Code (Google-style large digits) -->
          <tr>
            <td style="padding:28px 40px;" align="center">
              <p style="margin:0;font-size:36px;font-weight:400;letter-spacing:8px;color:#202124;font-family:'Google Sans',Roboto,Arial,sans-serif;line-height:44px;">
                ${codeDisplay}
              </p>
            </td>
          </tr>

          <!-- Expiry + security -->
          <tr>
            <td style="padding:0 40px 8px;">
              <p style="margin:0 0 16px;font-size:14px;line-height:20px;color:#3c4043;">
                This code will expire in ${expiryMinutes} minutes.
              </p>
              <p style="margin:0;font-size:14px;line-height:20px;color:#3c4043;">
                If you didn’t request this code, someone else might be trying to access your account.
                <strong style="font-weight:500;color:#202124;">Don’t forward or give this code to anyone.</strong>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr><td style="border-top:1px solid #e0e3e8;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px 36px;">
              <p style="margin:0;font-size:12px;line-height:18px;color:#5f6368;">
                You received this email because a verification code was requested for your Luvstor account.
                If you didn’t make this request, you can ignore this email.
              </p>
            </td>
          </tr>
        </table>

        <!-- Footer outside card (Google pattern) -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:460px;margin-top:24px;">
          <tr>
            <td align="center" style="padding:0 16px;">
              <p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#5f6368;">
                Luvstor &middot; Dating &amp; chat
              </p>
              <p style="margin:0;font-size:11px;line-height:16px;color:#80868b;">
                &copy; ${year} Luvstor. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildOtpText(otp, expiryMinutes, recipientEmail = "") {
  const codeDisplay = formatOtpDisplay(otp);
  return [
    "Luvstor",
    "",
    "Your Luvstor verification code",
    "",
    recipientEmail ? `Hi ${recipientEmail},` : "Hi,",
    "",
    "We received a request to sign in to your Luvstor account.",
    "Your verification code is:",
    "",
    codeDisplay,
    "",
    `This code will expire in ${expiryMinutes} minutes.`,
    "",
    "If you didn't request this code, someone else might be trying to access your account.",
    "Don't forward or give this code to anyone.",
    "",
    "— Luvstor",
  ].join("\n");
}

/** Same pattern as Google: "{code} is your … verification code" */
function buildOtpSubject(otp) {
  return `${otp} is your Luvstor verification code`;
}

module.exports = {
  buildOtpHtml,
  buildOtpText,
  buildOtpSubject,
  formatOtpDisplay,
};
