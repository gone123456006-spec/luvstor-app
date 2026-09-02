/**
 * Lightweight liveness endpoints for Render + external keep-alive cron.
 * /health — Render platform health check (always 200 when process is up)
 * /ping   — minimal keep-alive (no DB); secret-protected in production
 */

const { isProduction } = require('./production');

const stats = {
  pingTotal: 0,
  pingLastAt: null,
  pingLastMs: null,
  pingFailuresBlocked: 0,
};

/** Soft cap: ignore burst > 3/min without valid secret (cron sends 1/min). */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PUBLIC = 3;
const recentPublicPings = [];

function isSecretValid(req) {
  const expected = String(process.env.HEARTBEAT_SECRET || '').trim();
  if (!expected) return !isProduction();
  return req.get('X-Heartbeat-Secret') === expected;
}

function isRateLimited() {
  const now = Date.now();
  while (recentPublicPings.length && now - recentPublicPings[0] > RATE_WINDOW_MS) {
    recentPublicPings.shift();
  }
  if (recentPublicPings.length >= RATE_MAX_PUBLIC) return true;
  recentPublicPings.push(now);
  return false;
}

function mountHeartbeatRoutes(app) {
  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'Luvstor Backend',
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  app.get('/ping', (req, res) => {
    const authorized = isSecretValid(req);

    if (!authorized) {
      if (isProduction()) {
        stats.pingFailuresBlocked += 1;
        return res.status(401).type('text/plain').send('unauthorized');
      }
      if (isRateLimited()) {
        stats.pingFailuresBlocked += 1;
        return res.status(429).type('text/plain').send('rate limited');
      }
    }

    const started = Date.now();
    stats.pingTotal += 1;
    stats.pingLastAt = new Date().toISOString();
    stats.pingLastMs = Date.now() - started;

    res.status(200).type('text/plain').send('pong');
  });

  app.get('/heartbeat/stats', (req, res) => {
    const expected = String(process.env.HEARTBEAT_SECRET || '').trim();
    if (expected && req.get('X-Heartbeat-Secret') !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    res.json({
      ok: true,
      ...stats,
      uptimeSec: Math.floor(process.uptime()),
    });
  });
}

function isProbePath(path) {
  return (
    path === '/health' ||
    path === '/ping' ||
    path === '/ready' ||
    path === '/heartbeat/stats' ||
    path === '/'
  );
}

module.exports = {
  mountHeartbeatRoutes,
  isProbePath,
  stats,
};
