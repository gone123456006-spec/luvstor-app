/**
 * Records which app version each signed-in user runs (sent by the app as
 * X-App-Version / X-App-Build / X-App-Platform). Writes only when the value
 * changes or every few hours, never blocking the request.
 */
const User = require('../models/User');

const REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 50000;
const seen = new Map();

const VERSION_RE = /^\d{1,4}(?:\.\d{1,4}){0,3}$/;
const BUILD_RE = /^[0-9A-Za-z.\-]{1,32}$/;
const PLATFORMS = new Set(['ios', 'android']);

function readAppVersionHeaders(req) {
  const version = String(req.get?.('x-app-version') || '').trim();
  if (!VERSION_RE.test(version)) return null;
  const build = String(req.get?.('x-app-build') || '').trim();
  const platform = String(req.get?.('x-app-platform') || '').trim().toLowerCase();
  return {
    appVersion: version,
    appBuild: BUILD_RE.test(build) ? build : null,
    appPlatform: PLATFORMS.has(platform) ? platform : null,
  };
}

function recordAppVersion(userId, req) {
  try {
    const info = readAppVersionHeaders(req);
    if (!info || !userId) return;
    const key = String(userId);
    const fingerprint = `${info.appVersion}|${info.appBuild || ''}|${info.appPlatform || ''}`;
    const prev = seen.get(key);
    const now = Date.now();
    if (prev && prev.fingerprint === fingerprint && now - prev.at < REFRESH_MS) return;

    if (seen.size >= MAX_ENTRIES) seen.delete(seen.keys().next().value);
    seen.delete(key);
    seen.set(key, { fingerprint, at: now });

    User.updateOne({ _id: key }, { $set: { ...info, appVersionSeenAt: new Date(now) } }).catch((err) => {
      seen.delete(key);
      console.warn('appVersion: save failed:', err?.message || err);
    });
  } catch {
    /* tracking must never affect the request */
  }
}

module.exports = { recordAppVersion, readAppVersionHeaders, _seen: seen };
