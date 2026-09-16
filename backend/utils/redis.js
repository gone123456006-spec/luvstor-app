/**
 * Shared Redis connection for multi-instance scale (1M+ users).
 *
 * When REDIS_URL is unset, every caller falls back to in-memory behaviour so
 * local `npm run dev` keeps working without Redis.
 *
 * When REDIS_URL is set but unreachable (e.g. Render internal host from a
 * laptop), fail fast and cool down so For You / sockets don't hang.
 */
const REDIS_URL = (process.env.REDIS_URL || '').trim();

/** How long to skip reconnect attempts after a failed connect (ms) */
const FAIL_COOLDOWN_MS = 30_000;
/** Max wait for initial connect + ping (ms) */
const CONNECT_TIMEOUT_MS = 800;

let client = null;
let subClient = null;
let ready = false;
let initPromise = null;
let failedUntil = 0;

function isConfigured() {
  return !!REDIS_URL;
}

function isReady() {
  return ready && !!client;
}

function markFailed() {
  ready = false;
  failedUntil = Date.now() + FAIL_COOLDOWN_MS;
  initPromise = null;
  if (client) {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
    client = null;
  }
}

async function getRedis() {
  if (!REDIS_URL) return null;
  if (client && ready) return client;
  if (Date.now() < failedUntil) return null;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const Redis = require('ioredis');
      const opts = {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        connectTimeout: CONNECT_TIMEOUT_MS,
        retryStrategy(times) {
          // Fail fast — unreachable Render Redis must not block API routes
          if (times > 2) return null;
          return 150;
        },
        lazyConnect: true,
      };

      if (REDIS_URL.startsWith('rediss://')) {
        opts.tls = {};
      }

      const next = new Redis(REDIS_URL, opts);
      next.on('error', (err) => {
        // Keep logs quiet during cooldown reconnect storms
        if (Date.now() >= failedUntil) {
          console.warn('[Redis] error:', err.message);
        }
      });

      client = next;

      await Promise.race([
        next.connect().then(() => next.ping()),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis connect timeout')),
            CONNECT_TIMEOUT_MS,
          ),
        ),
      ]);

      ready = true;
      failedUntil = 0;
      console.log('🟥 Redis connected');
      return client;
    } catch (err) {
      console.warn(
        '[Redis] unavailable — running single-process fallback:',
        err.message,
      );
      markFailed();
      return null;
    }
  })();

  return initPromise;
}

/** Second connection for Socket.IO pub/sub (required by redis-adapter). */
async function getRedisSubscriber() {
  if (!REDIS_URL) return null;
  if (subClient) return subClient;

  const primary = await getRedis();
  if (!primary) return null;

  try {
    subClient = primary.duplicate();
    subClient.on('error', (err) => {
      console.warn('[Redis sub] error:', err.message);
    });
    await Promise.race([
      subClient.ping(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Redis sub timeout')),
          CONNECT_TIMEOUT_MS,
        ),
      ),
    ]);
    return subClient;
  } catch (err) {
    console.warn('[Redis sub] failed:', err.message);
    try {
      subClient?.disconnect();
    } catch {
      /* ignore */
    }
    subClient = null;
    return null;
  }
}

async function closeRedis() {
  ready = false;
  failedUntil = 0;
  initPromise = null;
  const closes = [];
  if (subClient) closes.push(subClient.quit().catch(() => {}));
  if (client) closes.push(client.quit().catch(() => {}));
  await Promise.all(closes);
  client = null;
  subClient = null;
}

module.exports = {
  isConfigured,
  isReady,
  getRedis,
  getRedisSubscriber,
  closeRedis,
  REDIS_URL,
};
