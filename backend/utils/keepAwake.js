/**
 * Server-side keep-alive: GET /health on a fixed interval while the process runs.
 *
 * Render free web services sleep after 15 min without inbound traffic. Pinging
 * the public URL (RENDER_EXTERNAL_URL) goes through Render's edge and counts
 * as traffic, so the instance never idles out. Locally it pings 127.0.0.1.
 * It cannot wake an instance that is already asleep — an external pinger on
 * /health covers crashes / restarts.
 *
 * Env:
 *   KEEP_AWAKE=false            disable
 *   KEEP_AWAKE_INTERVAL_MS      default 600000 (10 min — under Render's 15 min idle)
 *   KEEP_AWAKE_URL              override base URL (default RENDER_EXTERNAL_URL)
 */

const DEFAULT_INTERVAL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 5000;
const FAILURE_LOG_EVERY_MS = 60_000;

// One keep-alive per process even if this module is loaded twice
// (hot reload, duplicate require paths).
const STATE_KEY = Symbol.for('luvstor.keepAwake');
const state =
  globalThis[STATE_KEY] ||
  (globalThis[STATE_KEY] = {
    timer: null,
    url: null,
    intervalMs: DEFAULT_INTERVAL_MS,
    inFlight: false,
    ok: 0,
    failed: 0,
    consecutiveFailures: 0,
    lastFailureLogAt: 0,
    lastOkAt: null,
  });

function intervalMs() {
  const n = Number(process.env.KEEP_AWAKE_INTERVAL_MS);
  return Number.isFinite(n) && n >= 250 ? n : DEFAULT_INTERVAL_MS;
}

function keepAwakeUrl(localPort) {
  if (String(process.env.KEEP_AWAKE || '').toLowerCase() === 'false') return null;
  const base = String(
    process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL || '',
  ).trim();
  if (base) return `${base.replace(/\/+$/, '')}/health`;
  if (localPort) return `http://127.0.0.1:${localPort}/health`;
  return null;
}

function logFailure(message) {
  state.failed += 1;
  state.consecutiveFailures += 1;
  const now = Date.now();
  if (
    state.consecutiveFailures === 1 ||
    now - state.lastFailureLogAt >= FAILURE_LOG_EVERY_MS
  ) {
    state.lastFailureLogAt = now;
    console.warn(
      `[KeepAwake] ping failed (${state.consecutiveFailures} in a row): ${message}`,
    );
  }
}

async function pingOnce() {
  // A slow response must not stack requests
  if (state.inFlight || !state.url) return;
  state.inFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(state.url, {
      method: 'GET',
      headers: { 'User-Agent': 'luvstor-keep-awake' },
      signal: controller.signal,
    });
    // Drain so the socket is returned to the keep-alive pool
    await res.arrayBuffer().catch(() => undefined);
    if (!res.ok) {
      logFailure(`HTTP ${res.status}`);
      return;
    }
    if (state.consecutiveFailures > 0) {
      console.log(
        `[KeepAwake] recovered after ${state.consecutiveFailures} failed ping(s)`,
      );
    }
    state.ok += 1;
    state.consecutiveFailures = 0;
    state.lastOkAt = new Date().toISOString();
  } catch (err) {
    logFailure(err?.name === 'AbortError' ? 'timeout' : err?.message || String(err));
  } finally {
    clearTimeout(timeout);
    state.inFlight = false;
  }
}

/**
 * Start the keep-alive. Safe to call more than once — only one interval runs.
 * @param {number} [localPort] actual listening port (fallback target off Render)
 */
function startKeepAwake(localPort) {
  try {
    if (state.timer) {
      console.log(`⏰ Keep-alive already running → ${state.url}`);
      return false;
    }
    const url = keepAwakeUrl(localPort);
    if (!url) {
      console.log('⏰ Keep-alive disabled (KEEP_AWAKE=false or no target URL)');
      return false;
    }
    state.url = url;
    state.intervalMs = intervalMs();
    state.timer = setInterval(() => {
      pingOnce().catch(() => undefined);
    }, state.intervalMs);
    // Never keep the process alive on its own (clean shutdown)
    state.timer.unref?.();
    console.log(
      `⏰ Keep-alive running: GET ${url} every ${state.intervalMs} ms`,
    );
    return true;
  } catch (err) {
    console.warn('[KeepAwake] could not start:', err?.message || err);
    return false;
  }
}

function stopKeepAwake() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
    console.log('⏰ Keep-alive stopped');
  }
}

function getKeepAwakeStats() {
  return {
    running: Boolean(state.timer),
    url: state.url,
    intervalMs: state.intervalMs,
    ok: state.ok,
    failed: state.failed,
    consecutiveFailures: state.consecutiveFailures,
    lastOkAt: state.lastOkAt,
  };
}

module.exports = {
  startKeepAwake,
  stopKeepAwake,
  keepAwakeUrl,
  getKeepAwakeStats,
};
