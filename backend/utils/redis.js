/**
 * Shared Redis connection for multi-instance scale (1M+ users).
 *
 * When REDIS_URL is unset, every caller falls back to in-memory behaviour so
 * local `npm run dev` keeps working without Redis.
 */
const REDIS_URL = (process.env.REDIS_URL || '').trim();

let client = null;
let subClient = null;
let ready = false;
let initPromise = null;

function isConfigured() {
  return !!REDIS_URL;
}

function isReady() {
  return ready && !!client;
}

async function getRedis() {
  if (!REDIS_URL) return null;
  if (client && ready) return client;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const Redis = require('ioredis');
      const opts = {
        maxRetriesPerRequest: null, // required by BullMQ
        enableReadyCheck: true,
        retryStrategy(times) {
          if (times > 25) return null;
          return Math.min(times * 200, 3000);
        },
      };

      if (REDIS_URL.startsWith('rediss://')) {
        opts.tls = {};
      }

      client = new Redis(REDIS_URL, opts);
      client.on('error', (err) => {
        console.warn('[Redis] error:', err.message);
      });

      await client.ping();
      ready = true;
      console.log('🟥 Redis connected');
      return client;
    } catch (err) {
      ready = false;
      client = null;
      initPromise = null;
      console.warn(
        '[Redis] unavailable — running single-process fallback:',
        err.message,
      );
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
    await subClient.ping();
    return subClient;
  } catch (err) {
    console.warn('[Redis sub] failed:', err.message);
    return null;
  }
}

async function closeRedis() {
  ready = false;
  const closes = [];
  if (subClient) closes.push(subClient.quit().catch(() => {}));
  if (client) closes.push(client.quit().catch(() => {}));
  await Promise.all(closes);
  client = null;
  subClient = null;
  initPromise = null;
}

module.exports = {
  isConfigured,
  isReady,
  getRedis,
  getRedisSubscriber,
  closeRedis,
  REDIS_URL,
};
