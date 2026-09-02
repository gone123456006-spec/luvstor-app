/**
 * Run a cron job on only one instance when Redis is available.
 * Prevents duplicate work when Render scales to multiple nodes.
 */
const { isReady, getRedis } = require('./redis');

const DEFAULT_LOCK_TTL_SEC = 300;

async function withCronLeader(lockKey, fn, ttlSec = DEFAULT_LOCK_TTL_SEC) {
  if (!isReady()) {
    return fn();
  }

  try {
    const redis = await getRedis();
    if (!redis) return fn();

    const key = `cron:lock:${lockKey}`;
    const acquired = await redis.set(key, String(process.pid), 'EX', ttlSec, 'NX');
    if (acquired !== 'OK') {
      return undefined;
    }

    return await fn();
  } catch (err) {
    console.warn(`[CronLeader] ${lockKey} failed, running anyway:`, err.message);
    return fn();
  }
}

module.exports = { withCronLeader };
