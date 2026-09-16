const express = require('express');
const router = express.Router();

const ID_RE = /^[A-Za-z]{4}\d{4}$/;

/**
 * GET /u/:publicId
 * Shareable profile bounce page.
 * - Opens luvstor://u/ID when the app is installed
 * - Shows a friendly page with Open / Get Luvstor CTAs otherwise
 */
router.get('/:publicId', (req, res) => {
  const publicId = String(req.params.publicId || '')
    .trim()
    .toUpperCase();

  if (!ID_RE.test(publicId)) {
    return res.status(400).type('html').send(errorPage('Invalid profile link'));
  }

  const appUrl = `luvstor:///u/${publicId}`;
  const playStore =
    process.env.ANDROID_PLAY_STORE_URL ||
    'https://play.google.com/store/apps/details?id=com.luvstor.app';

  res
    .status(200)
    .type('html')
    .set('Cache-Control', 'public, max-age=300')
    .send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#8E2DE2" />
  <title>Luvstor · ${publicId}</title>
  <meta property="og:title" content="Meet someone on Luvstor" />
  <meta property="og:description" content="Open profile ${publicId} in the Luvstor app" />
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: linear-gradient(160deg, #FDF8FF 0%, #EADDFF 55%, #FFD6E7 100%);
      display: flex; align-items: center; justify-content: center; padding: 24px;
      color: #1C1B1F;
    }
    .card {
      width: 100%; max-width: 380px; background: #fff; border-radius: 20px;
      padding: 28px 22px 24px; box-shadow: 0 12px 40px rgba(103,80,164,.18);
      text-align: center;
    }
    .logo {
      width: 64px; height: 64px; margin: 0 auto 14px; border-radius: 16px;
      background: linear-gradient(135deg, #8E2DE2, #FF4B6E);
      display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 22px;
    }
    h1 { font-size: 22px; margin: 0 0 6px; }
    .id {
      display: inline-block; margin: 10px 0 18px; padding: 8px 14px; border-radius: 999px;
      background: #EADDFF; color: #6750A4; font-weight: 700; letter-spacing: 1px; font-size: 15px;
    }
    p { margin: 0 0 18px; color: #49454F; line-height: 1.45; font-size: 15px; }
    .btn {
      display: block; width: 100%; text-decoration: none; border: none; cursor: pointer;
      padding: 14px 16px; border-radius: 28px; font-weight: 700; font-size: 16px; margin-bottom: 10px;
    }
    .primary { background: #6750A4; color: #fff; }
    .secondary { background: #F3EDF7; color: #6750A4; }
    .hint { font-size: 12px; color: #888; margin-top: 8px; }
  </style>
  <script>
    (function () {
      var appUrl = ${JSON.stringify(appUrl)};
      // Try to open the app immediately
      window.location.href = appUrl;
      setTimeout(function () {
        // If still here, user likely needs the store / manual open
      }, 1200);
    })();
  </script>
</head>
<body>
  <div class="card">
    <div class="logo">L</div>
    <h1>Open in Luvstor</h1>
    <div class="id">ID ${publicId}</div>
    <p>Tap below to view this profile in the Luvstor app.</p>
    <a class="btn primary" href="${appUrl}">Open profile</a>
    <a class="btn secondary" href="${playStore}">Get Luvstor</a>
    <p class="hint">Already installed? Use “Open profile”.</p>
  </div>
</body>
</html>`);
});

function errorPage(message) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Luvstor</title>
<style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#FDF8FF;color:#1C1B1F}p{color:#49454F}</style>
</head><body><div style="text-align:center"><h1>Luvstor</h1><p>${message}</p></div></body></html>`;
}

module.exports = router;
