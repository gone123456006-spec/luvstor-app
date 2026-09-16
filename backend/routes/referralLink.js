const express = require('express');
const router = express.Router();
const User = require('../models/User');
const {
  normalizeReferralCode,
  playStoreUrlForCode,
  REFERRAL_REWARD_TOKENS,
} = require('../services/referrals');

/**
 * GET /r/:code
 * Production bounce: try open app deep link, else Play Store with install referrer.
 */
router.get('/:code', async (req, res) => {
  const code = normalizeReferralCode(req.params.code);
  if (!code || code.length < 4) {
    return res.status(404).send('Invalid invite link');
  }

  const exists = await User.exists({ referralCode: code });
  if (!exists) {
    return res.status(404).send('Invite not found');
  }

  const play = playStoreUrlForCode(code);
  const appLink = `luvstor:///r/${code}`;
  const safeCode = code.replace(/[^A-Z0-9]/gi, '');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Join Luvstor — Get started</title>
  <meta name="description" content="Your friend invited you to Luvstor. Download the app and sign in — they earn ${REFERRAL_REWARD_TOKENS} tokens when you join." />
  <style>
    body { font-family: system-ui, sans-serif; background: #F5F0FF; color: #1A1A2E;
      display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 24px; }
    .card { background: #fff; border-radius: 20px; padding: 28px; max-width: 380px; width: 100%;
      box-shadow: 0 8px 32px rgba(124,58,237,.12); text-align: center; }
    h1 { color: #7C3AED; font-size: 1.5rem; margin: 0 0 8px; }
    p { color: #555; line-height: 1.45; margin: 0 0 20px; }
    a.btn { display: block; background: #7C3AED; color: #fff; text-decoration: none;
      padding: 14px 18px; border-radius: 12px; font-weight: 700; margin-bottom: 10px; }
    a.secondary { color: #7C3AED; font-weight: 600; font-size: .95rem; }
    .code { font-family: ui-monospace, monospace; background: #F3E8FF; padding: 4px 10px;
      border-radius: 8px; font-weight: 700; letter-spacing: .05em; }
  </style>
  <script>
    (function () {
      var app = ${JSON.stringify(appLink)};
      var store = ${JSON.stringify(play)};
      var ua = navigator.userAgent || '';
      var isAndroid = /Android/i.test(ua);
      // Try app first (if already installed)
      var t = Date.now();
      window.location = app;
      setTimeout(function () {
        if (Date.now() - t < 2200) {
          window.location = isAndroid ? store : store;
        }
      }, 900);
    })();
  </script>
</head>
<body>
  <div class="card">
    <h1>You're invited to Luvstor</h1>
    <p>Install the app and complete login. Your friend gets <strong>${REFERRAL_REWARD_TOKENS} tokens</strong>.</p>
    <p>Invite code: <span class="code">${safeCode}</span></p>
    <a class="btn" href="${play}">Download on Google Play</a>
    <a class="secondary" href="${appLink}">Open Luvstor app</a>
  </div>
</body>
</html>`);
});

module.exports = router;
