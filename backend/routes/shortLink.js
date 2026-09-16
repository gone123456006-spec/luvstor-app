const express = require('express');
const router = express.Router();
const {
  findBySlug,
  recordClick,
  getOnelinkTemplatePath,
} = require('../services/shareLinks');
const {
  playStoreUrlForCode,
  REFERRAL_REWARD_TOKENS,
} = require('../services/referrals');

const PLAY_STORE =
  process.env.ANDROID_PLAY_STORE_URL ||
  'https://play.google.com/store/apps/details?id=com.luvstor.app';

function bounceHtml({ title, description, appUrl, storeUrl, badge }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#8E2DE2" />
  <title>${title}</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <style>
    body { margin:0; min-height:100vh; font-family:system-ui,sans-serif;
      background:linear-gradient(160deg,#FDF8FF 0%,#EADDFF 55%,#FFD6E7 100%);
      display:flex; align-items:center; justify-content:center; padding:24px; color:#1C1B1F; }
    .card { width:100%; max-width:380px; background:#fff; border-radius:20px;
      padding:28px 22px 24px; box-shadow:0 12px 40px rgba(103,80,164,.18); text-align:center; }
    .logo { width:64px; height:64px; margin:0 auto 14px; border-radius:16px;
      background:linear-gradient(135deg,#8E2DE2,#FF4B6E); display:grid; place-items:center;
      color:#fff; font-weight:800; font-size:22px; }
    h1 { font-size:22px; margin:0 0 8px; }
    .badge { display:inline-block; margin:8px 0 16px; padding:8px 14px; border-radius:999px;
      background:#EADDFF; color:#6750A4; font-weight:700; letter-spacing:1px; font-size:14px; }
    p { margin:0 0 18px; color:#49454F; line-height:1.45; font-size:15px; }
    a.btn { display:block; width:100%; text-decoration:none; padding:14px 16px; border-radius:28px;
      font-weight:700; font-size:16px; margin-bottom:10px; box-sizing:border-box; }
    .primary { background:#6750A4; color:#fff; }
    .secondary { background:#F3EDF7; color:#6750A4; }
  </style>
  <script>
    (function () {
      var appUrl = ${JSON.stringify(appUrl)};
      var store = ${JSON.stringify(storeUrl)};
      window.location.href = appUrl;
      setTimeout(function () {
        var ua = navigator.userAgent || '';
        if (/Android/i.test(ua)) window.location.href = store;
      }, 1100);
    })();
  </script>
</head>
<body>
  <div class="card">
    <div class="logo">L</div>
    <h1>${title}</h1>
    ${badge ? `<div class="badge">${badge}</div>` : ''}
    <p>${description}</p>
    <a class="btn primary" href="${appUrl}">Open Luvstor</a>
    <a class="btn secondary" href="${storeUrl}">Get on Google Play</a>
  </div>
</body>
</html>`;
}

async function resolveSlug(req, res) {
  const slug = String(req.params.slug || '')
    .trim()
    .toUpperCase();
  const row = await findBySlug(slug);
  if (!row) {
    return res.status(404).type('html').send(
      bounceHtml({
        title: 'Link not found',
        description: 'This Luvstor link is invalid or expired.',
        appUrl: 'luvstor:///',
        storeUrl: PLAY_STORE,
      }),
    );
  }

  void recordClick(slug);

  if (row.type === 'referral' && row.referralCode) {
    const code = row.referralCode;
    const appUrl = `luvstor:///r/${code}`;
    const storeUrl = playStoreUrlForCode(code);
    return res
      .status(200)
      .type('html')
      .set('Cache-Control', 'public, max-age=120')
      .send(
        bounceHtml({
          title: "You're invited to Luvstor",
          description: `Install the app and complete login. Your friend earns ${REFERRAL_REWARD_TOKENS} tokens when you join.`,
          appUrl,
          storeUrl,
          badge: `Invite ${code}`,
        }),
      );
  }

  if (row.type === 'profile' && row.publicId) {
    const publicId = row.publicId;
    const appUrl = `luvstor:///u/${publicId}`;
    return res
      .status(200)
      .type('html')
      .set('Cache-Control', 'public, max-age=120')
      .send(
        bounceHtml({
          title: 'Open in Luvstor',
          description: 'Tap below to view this profile in the Luvstor app.',
          appUrl,
          storeUrl: PLAY_STORE,
          badge: `ID ${publicId}`,
        }),
      );
  }

  return res.status(404).type('html').send('Invalid link');
}

// GET /go/:slug
router.get('/:slug', (req, res, next) => {
  resolveSlug(req, res).catch(next);
});

module.exports = router;
module.exports.resolveSlug = resolveSlug;
module.exports.getOnelinkTemplatePath = getOnelinkTemplatePath;
