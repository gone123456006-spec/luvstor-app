/**
 * Push delivery queue — scales to millions of users.
 *
 * Mode A (REDIS_URL set): BullMQ + Redis — durable, multi-worker, survives restarts.
 * Mode B (no Redis): in-process queue — fine for local / single-node demos.
 *
 * Public API stays: enqueue / drain / stats / hookShutdown
 */
const NotificationLog = require('../models/NotificationLog');
const Notification = require('../models/Notification');
const fcm = require('./fcm');
const deviceTokens = require('./deviceTokens');
const { isConfigured, getRedis } = require('../utils/redis');

const MAX_ATTEMPTS = Number(process.env.PUSH_MAX_ATTEMPTS || 5);
const BASE_BACKOFF_MS = Number(process.env.PUSH_BACKOFF_MS || 2000);
const CONCURRENCY = Number(process.env.PUSH_CONCURRENCY || 20);
const FCM_BATCH_SIZE = 500;
const MAX_QUEUE_SIZE = Number(process.env.PUSH_MAX_QUEUE || 100000);
const QUEUE_NAME = process.env.PUSH_QUEUE_NAME || 'luvstor-fcm';

const memoryQueue = [];
let activeWorkers = 0;
let draining = false;
let bullQueue = null;
let bullWorker = null;
let mode = 'memory';

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function init() {
  if (!isConfigured()) {
    mode = 'memory';
    console.log(`[PushQueue] memory mode (concurrency=${CONCURRENCY})`);
    return;
  }

  try {
    const connection = await getRedis();
    if (!connection) {
      mode = 'memory';
      console.log('[PushQueue] Redis down — memory fallback');
      return;
    }

    const { Queue, Worker } = require('bullmq');
    bullQueue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: BASE_BACKOFF_MS },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });

    bullWorker = new Worker(
      QUEUE_NAME,
      async (job) => {
        await runJob(
          { ...job.data, attempts: job.attemptsMade },
          { rethrow: true },
        );
      },
      {
        connection: connection.duplicate(),
        concurrency: CONCURRENCY,
      },
    );

    bullWorker.on('failed', (job, err) => {
      console.error(
        `[PushQueue] job ${job?.id} failed:`,
        err?.message || err,
      );
    });

    mode = 'bullmq';
    console.log(
      `[PushQueue] BullMQ ready (queue=${QUEUE_NAME}, concurrency=${CONCURRENCY})`,
    );
  } catch (err) {
    mode = 'memory';
    console.warn('[PushQueue] BullMQ init failed — memory fallback:', err.message);
  }
}

/**
 * @param {object} job
 * @param {string[]} job.tokens
 * @param {string} job.userId
 * @param {string} [job.notificationId]
 * @param {object} job.payload
 */
function enqueue(job) {
  if (mode === 'bullmq' && bullQueue) {
    bullQueue
      .add('fcm', job, {
        jobId: job.notificationId
          ? `n:${job.notificationId}:${Date.now()}`
          : undefined,
      })
      .catch((err) => {
        console.error('[PushQueue] enqueue failed, memory fallback:', err.message);
        memoryEnqueue(job);
      });
    return true;
  }
  return memoryEnqueue(job);
}

function memoryEnqueue(job) {
  if (memoryQueue.length >= MAX_QUEUE_SIZE) {
    console.error('[PushQueue] Queue full — dropping job for user', job.userId);
    return false;
  }
  memoryQueue.push({ ...job, attempts: 0 });
  process.nextTick(pump);
  return true;
}

function pump() {
  while (activeWorkers < CONCURRENCY && memoryQueue.length > 0) {
    const job = memoryQueue.shift();
    activeWorkers += 1;
    runJob(job)
      .catch((err) => console.error('[PushQueue] Job crashed:', err.message))
      .finally(() => {
        activeWorkers -= 1;
        if (memoryQueue.length > 0) process.nextTick(pump);
      });
  }
}

async function runJob(job, { rethrow = false } = {}) {
  const { tokens, userId, notificationId, payload } = job;
  const attempts = Number(job.attempts || 0) + 1;
  job.attempts = attempts;

  const log = await NotificationLog.create({
    notificationId: notificationId || null,
    userId,
    type: payload?.data?.type || 'system',
    channel: 'fcm',
    status: 'queued',
    attempts,
  }).catch(() => null);

  if (!tokens?.length) {
    await finishLog(log, {
      status: 'skipped',
      error: 'No active device tokens',
    });
    await setPushStatus(notificationId, 'skipped');
    return;
  }

  let successCount = 0;
  let failureCount = 0;
  let invalidated = 0;
  const allResults = [];
  const retryable = new Set();
  let lastError = null;

  for (const batch of chunk(tokens, FCM_BATCH_SIZE)) {
    try {
      const res = await fcm.sendToTokens(batch, payload);
      successCount += res.successCount;
      failureCount += res.failureCount;
      allResults.push(...res.results.slice(0, 50));

      if (res.invalidTokens.length) {
        invalidated += await deviceTokens.invalidateTokens(
          res.invalidTokens,
          'fcm_unregistered',
        );
      }
      if (res.retryableTokens.length) {
        res.retryableTokens.forEach((t) => retryable.add(t));
        await deviceTokens.recordFailures(res.retryableTokens);
      }
      const ok = res.results.filter((r) => r.success).map((r) => r.token);
      if (ok.length) await deviceTokens.recordSuccess(ok);

      if (res.error) lastError = res.error;
    } catch (err) {
      lastError = err.message;
      failureCount += batch.length;
      batch.forEach((t) => retryable.add(t));
    }
  }

  const retryTokens = [...retryable];
  const canRetry =
    mode === 'memory' &&
    retryTokens.length > 0 &&
    attempts < MAX_ATTEMPTS;

  const status =
    successCount > 0 && failureCount === 0
      ? 'sent'
      : successCount > 0
        ? 'partial'
        : 'failed';

  await finishLog(log, {
    status,
    successCount,
    failureCount,
    invalidatedTokens: invalidated,
    error: lastError,
    results: allResults,
  });

  await setPushStatus(notificationId, status);

  // BullMQ retries via job failure; memory mode retries locally
  if (mode === 'bullmq' && rethrow && retryTokens.length && successCount === 0) {
    const err = new Error(lastError || 'FCM delivery failed');
    throw err;
  }

  if (canRetry) {
    const delay = BASE_BACKOFF_MS * 2 ** (attempts - 1);
    console.warn(
      `[PushQueue] Retrying ${retryTokens.length} token(s) in ${delay}ms (attempt ${attempts + 1}/${MAX_ATTEMPTS})`,
    );
    await sleep(delay);
    memoryQueue.push({ ...job, tokens: retryTokens, attempts });
    process.nextTick(pump);
  }
}

async function finishLog(log, fields) {
  if (!log) return;
  try {
    Object.assign(log, fields, { completedAt: new Date() });
    await log.save();
  } catch {
    /* logging must never break delivery */
  }
}

async function setPushStatus(notificationId, status) {
  if (!notificationId) return;
  try {
    await Notification.updateOne(
      { _id: notificationId },
      { $set: { pushStatus: status } },
    );
  } catch {
    /* ignore */
  }
}

async function drain(timeoutMs = 10000) {
  if (draining) return;
  draining = true;
  const started = Date.now();

  if (mode === 'bullmq' && bullWorker) {
    await bullWorker.close();
  }

  while (
    (memoryQueue.length > 0 || activeWorkers > 0) &&
    Date.now() - started < timeoutMs
  ) {
    await sleep(100);
  }
  draining = false;
}

async function stats() {
  if (mode === 'bullmq' && bullQueue) {
    try {
      const counts = await bullQueue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      );
      return { mode, ...counts };
    } catch {
      return { mode, error: true };
    }
  }
  return { mode, pending: memoryQueue.length, active: activeWorkers };
}

let shutdownHooked = false;
function hookShutdown() {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const handler = async () => {
    console.log('[PushQueue] Draining before shutdown…');
    await drain(8000);
    try {
      const { closeRedis } = require('../utils/redis');
      await closeRedis();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

module.exports = {
  init,
  enqueue,
  drain,
  stats,
  hookShutdown,
  MAX_ATTEMPTS,
};
