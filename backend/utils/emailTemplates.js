function formatOtpDisplay(otp) {
  const d = String(otp).replace(/\D/g, '');
  return d.length === 6 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Google Account–style verification email + Luvstor vibe (purple gradient accent).
 */
function buildOtpHtml(otp, expiryMinutes, recipientEmail = '') {
  const codeDisplay = formatOtpDisplay(otp);
  const safeEmail = escapeHtml(recipientEmail);
  const year = new Date().getFullYear();
  const helloLine = safeEmail
    ? `Hello <span style="color:#202124;font-weight:500;">${safeEmail}</span>,`
    : 'Hello,';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Luvstor verification code</title>
</head>
<body style="margin:0;padding:0;background:#f1f3f4;font-family:Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f1f3f4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(60,64,67,0.12),0 1px 2px rgba(60,64,67,0.08);">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#7C3AED,#8E2DE2,#4A00E0,#1a73e8);font-size:0;line-height:4px;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <span style="font-size:22px;font-weight:500;letter-spacing:-0.5px;">
                      <span style="color:#7C3AED;font-weight:700;">Luv</span><span style="color:#202124;">stor</span>
                    </span>
                  </td>
                  <td align="right">
                    <span style="font-size:11px;font-weight:500;color:#5f6368;background:#f1f3f4;padding:6px 10px;border-radius:16px;">2-STEP VERIFY</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0;">
              <h1 style="margin:0;font-size:24px;font-weight:400;line-height:32px;color:#202124;">Verify your email</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 0;">
              <p style="margin:0 0 12px;font-size:14px;line-height:20px;color:#3c4043;">${helloLine}</p>
              <p style="margin:0;font-size:14px;line-height:20px;color:#3c4043;">
                We received a request to sign in to <strong style="color:#202124;font-weight:500;">Luvstor</strong>.
                Use this verification code to continue.
                <span style="color:#7C3AED;font-weight:500;"> Find your vibe, find your person.</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:linear-gradient(145deg,#faf8ff 0%,#f5f0ff 50%,#eef2ff 100%);border:1px solid #e8e0f5;border-radius:12px;">
                <tr>
                  <td align="center" style="padding:32px 24px;">
                    <p style="margin:0 0 8px;font-size:12px;font-weight:500;color:#5f6368;text-transform:uppercase;letter-spacing:1.2px;">Verification code</p>
                    <p style="margin:0;font-size:40px;font-weight:400;font-family:Roboto,monospace;letter-spacing:10px;color:#202124;line-height:48px;">${codeDisplay}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 8px;">
              <p style="margin:0 0 16px;font-size:14px;line-height:20px;color:#3c4043;">
                This code expires in <strong style="color:#202124;">${expiryMinutes} minutes</strong>.
              </p>
              <p style="margin:0;font-size:14px;line-height:20px;color:#3c4043;">
                <strong style="color:#202124;">Do not share this code</strong> with anyone. Luvstor will never ask for it by call or message.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr><td style="height:1px;background:#e8eaed;font-size:0;line-height:1px;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px;">
              <p style="margin:0;font-size:12px;line-height:18px;color:#5f6368;">
                If you didn't request this code, you can safely ignore this email. Someone else might have typed your address by mistake.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f8f9fa;border-top:1px solid #e8eaed;">
              <p style="margin:0 0 8px;font-size:11px;line-height:16px;color:#5f6368;">
                You received this email because a sign-in was requested for your account on Luvstor.
              </p>
              <p style="margin:0;font-size:11px;line-height:16px;color:#9aa0a6;">&copy; ${year} Luvstor &middot; Secure sign-in</p>
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0;font-size:11px;line-height:16px;color:#9aa0a6;text-align:center;max-width:520px;">
          Sent with care for your vibe &#10022;
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildOtpText(otp, expiryMinutes, recipientEmail = '') {
  const codeDisplay = formatOtpDisplay(otp);
  return [
    'Luvstor',
    '',
    'Verify your email',
    '',
    recipientEmail ? `Hello ${recipientEmail},` : 'Hello,',
    '',
    'We received a request to sign in to Luvstor.',
    'Use this verification code to continue:',
    '',
    `    ${codeDisplay}`,
    '',
    `This code expires in ${expiryMinutes} minutes.`,
    '',
    'Do not share this code with anyone.',
    '',
    "If you didn't request this code, you can safely ignore this email.",
    '',
    '— Luvstor · Find your vibe, find your person',
  ].join('\n');
}

/** Google-style subject line */
function buildOtpSubject(otp) {
  return `${otp} is your Luvstor verification code`;
}

module.exports = {
  buildOtpHtml,
  buildOtpText,
  buildOtpSubject,
  formatOtpDisplay,
};
