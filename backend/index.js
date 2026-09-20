require('dotenv').config({ override: true });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chat');
const uploadRoutes = require('./routes/upload');
const tokenRoutes = require('./routes/tokens');
const friendsRoutes = require('./routes/friends');
const paymentRoutes = require('./routes/payment');
const notificationRoutes = require('./routes/notifications');
const deviceRoutes = require('./routes/devices');
const initSocket = require('./socket/index');
const { verifySmtpConnection } = require('./utils/email');
const {
  sendDeletionReminders,
  permanentlyDeleteAccounts,
} = require('./jobs/accountDeletion');
const { pruneStaleTokens } = require('./jobs/deviceTokenCleanup');
const { runDailySuggestionsIfDue } = require('./jobs/dailySuggestions');
const { runEngagingNotifications } = require('./jobs/engagingNotificationScheduler');
const {
  expireDueSubscriptions,
} = require('./services/subscriptions');
const {
  approveDuePhotoVerifications,
} = require('./routes/verification');
const fcm = require('./services/fcm');
const pushQueue = require('./services/pushQueue');
const {
  isConfigured: redisConfigured,
  getRedis,
  getRedisSubscriber,
  isReady: redisReady,
} = require('./utils/redis');
const presence = require('./utils/presence');
const { validateProductionEnv, isProduction } = require('./utils/production');
const { withCronLeader } = require('./utils/cronLeader');
const { closeRedis } = require('./utils/redis');
const { mountHeartbeatRoutes, isProbePath } = require('./utils/heartbeat');

const app = express();
const server = http.createServer(app);

// Tune Node HTTP for high concurrent sockets
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// Probes first — no DB, no JSON body (Render /health + cron /ping)
app.set('trust proxy', 1);
mountHeartbeatRoutes(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
  // Slightly larger buffer for media signaling; still keep payloads lean
  maxHttpBufferSize: 1e6,
  pingInterval: 25_000,
  pingTimeout: 20_000,
});
app.set('io', io);

async function attachRedisAdapter() {
  if (!redisConfigured()) {
    console.log('ℹ️  REDIS_URL not set — single-node Socket.IO / memory push queue');
    return false;
  }
  try {
    const pubClient = await getRedis();
    const subClient = await getRedisSubscriber();
    if (!pubClient || !subClient) return false;

    const { createAdapter } = require('@socket.io/redis-adapter');
    io.adapter(createAdapter(pubClient, subClient));
    console.log('🟥 Socket.IO Redis adapter attached (horizontal scale ready)');
    return true;
  } catch (err) {
    console.warn('[Socket.IO] Redis adapter failed:', err.message);
    return false;
  }
}

initSocket(io);

// ── Express middleware ─────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
// Gzip JSON/list responses (chat, friends, nearby) for faster mobile transfer
try {
  app.use(require('compression')({ threshold: 1024 }));
} catch {
  /* optional dependency */
}
// Raw photo upload must be parsed before the JSON body parser
app.use(
  '/api/upload/image-bin',
  express.raw({ type: '*/*', limit: process.env.JSON_BODY_LIMIT || '12mb' })
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '10mb' }));

// Fail fast while Mongo is reconnecting instead of hanging until a crash.
app.use((req, res, next) => {
  if (isProbePath(req.path) || req.path.startsWith('/uploads')) {
    return next();
  }
  if (mongoose.connection.readyState === 1) return next();
  return res.status(503).json({
    error: 'Database reconnecting. Try again in a moment.',
    code: 'DB_UNAVAILABLE',
  });
});

const { ensureUploadsDir } = require('./utils/uploadsPath');
const UPLOADS_DIR = ensureUploadsDir();
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    // Allow RN / Expo Image to fetch cross-origin without opaque failures
    setHeaders(res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);
console.log(`📁 Serving uploads from ${UPLOADS_DIR}`);

// ── Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/notifications', notificationRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/calls', require('./routes/calls'));
app.use('/api/support', require('./routes/support'));
app.use('/api/admin', require('./routes/adminModeration'));
app.use('/api/verification', require('./routes/verification'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/retention', require('./routes/retention'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/share', require('./routes/share'));
app.use('/api/engagement', require('./routes/engagement'));
app.use('/u', require('./routes/profileLink'));
app.use('/r', require('./routes/referralLink'));
app.use('/go', require('./routes/shortLink'));

// OneLink-style path: /luvstor/:slug (template from ONELINK_TEMPLATE_PATH)
{
  const { getOnelinkTemplatePath } = require('./services/shareLinks');
  const { resolveSlug } = require('./routes/shortLink');
  const tpl = getOnelinkTemplatePath();
  app.get(`/${tpl}/:slug`, (req, res, next) => {
    resolveSlug(req, res).catch(next);
  });
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Luvstor Backend',
    version: '3.0.0',
    scale: {
      redis: redisReady(),
      fcm: fcm.isEnabled(),
    },
    features: [
      'OTP Auth via SMTP',
      'Single Device Login',
      'Real-time Chat (WebSocket)',
      'Nearby People (Geospatial)',
      'FCM Push (BullMQ when Redis set)',
      'WebRTC Voice & Video Calls',
      'For You recommendations',
      'Photo verification',
      'Support tickets',
      'Report moderation',
    ],
  });
});

/** Readiness — mongo (+ redis when configured) before taking traffic. */
app.get('/ready', async (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  let redisOk = false;
  let online = null;
  try {
    if (redisConfigured()) {
      const r = await getRedis();
      if (r) {
        await r.ping();
        redisOk = true;
        online = await presence.onlineCount();
      }
    }
  } catch {
    redisOk = false;
  }

  const queue = await pushQueue.stats();
  const ok = mongoOk && (redisConfigured() ? redisOk : true);
  res.status(ok ? 200 : 503).json({
    ok,
    mongo: mongoOk,
    redis: redisConfigured() ? redisOk : 'optional-unset',
    fcm: fcm.isEnabled(),
    onlineUsers: online,
    pushQueue: queue,
    uptimeSec: Math.floor(process.uptime()),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('Unhandled error:', err);
  } else {
    console.warn(`${req.method} ${req.path} → ${status}: ${err.message}`);
  }
  res.status(status).json({
    error:
      status === 400 && err.type === 'entity.parse.failed'
        ? 'Malformed JSON body'
        : status < 500
          ? err.message
          : 'Internal server error',
  });
});

// ── MongoDB connection + server start ──────────────────────────────────
const PORT = process.env.PORT || 5000;
const MONGO_POOL = Math.max(10, Number(process.env.MONGO_POOL_SIZE || 100));

function mongoUri() {
  const raw = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/luvstor';
  // Windows often refuses IPv6 ::1 for "localhost" even when mongod is up on IPv4.
  return raw.replace('mongodb://localhost', 'mongodb://127.0.0.1');
}

function mongoUriForLog() {
  return mongoUri().replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

function mongoOptions() {
  const isAtlas = mongoUri().includes('mongodb+srv://');
  return {
    maxPoolSize: MONGO_POOL,
    minPoolSize: Math.min(10, MONGO_POOL),
    maxIdleTimeMS: 30_000,
    waitQueueTimeoutMS: 10_000,
    serverSelectionTimeoutMS: isAtlas ? 30_000 : 8_000,
    connectTimeoutMS: isAtlas ? 30_000 : 10_000,
    socketTimeoutMS: 45_000,
    heartbeatFrequencyMS: 10_000,
    retryWrites: true,
    retryReads: true,
    autoIndex: process.env.NODE_ENV !== 'production',
  };
}

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connected:', mongoUriForLog());
  console.log(`   pool max=${MONGO_POOL}`);
  const repairMod = require('./utils/repairGoogleUidIndex');
  if (typeof repairMod.repairGoogleUidIndex === 'function') {
    repairMod.repairGoogleUidIndex().catch((err) =>
      console.warn('googleUid index repair failed:', err.message),
    );
  }
  if (typeof repairMod.repairReferralCodeIndex === 'function') {
    repairMod.repairReferralCodeIndex().catch((err) =>
      console.warn('referralCode index repair failed:', err.message),
    );
  }
  // Clear stuck "Active now" flags from missed disconnects / crashes
  const { STALE_MS } = require('./utils/onlineStatus');
  const User = require('./models/User');
  const cutoff = new Date(Date.now() - STALE_MS);
  User.updateMany(
    { isOnline: true, $or: [{ lastSeen: { $lt: cutoff } }, { lastSeen: null }] },
    { $set: { isOnline: false } },
  )
    .then((r) => {
      if (r.modifiedCount) {
        console.log(`🧹 Cleared stale isOnline on ${r.modifiedCount} user(s)`);
      }
    })
    .catch((err) => console.warn('stale isOnline cleanup failed:', err.message));
});
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected — retrying, API stays up');
});
mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB error:', err.message);
});

async function connectMongo(attempt = 1) {
  try {
    await mongoose.connect(mongoUri(), mongoOptions());
    return true;
  } catch (err) {
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
    console.error(
      `❌ MongoDB not reachable (${err.message}). Retrying in ${wait / 1000}s…`,
    );
    if (isProduction()) {
      console.error(
        '   On Render: set MONGODB_URI and allow 0.0.0.0/0 in Atlas → Network Access.',
      );
    } else {
      console.error('   Start MongoDB locally, or set MONGODB_URI to Atlas.');
    }
    await new Promise((r) => setTimeout(r, wait));
    return connectMongo(attempt + 1);
  }
}

function registerGracefulShutdown() {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] ${signal} — closing server…`);

    await new Promise((resolve) => {
      server.close(() => {
        console.log('[Shutdown] HTTP server closed');
        resolve();
      });
      setTimeout(resolve, 10_000);
    });

    try {
      await pushQueue.drain(8000);
    } catch {
      /* ignore */
    }

    try {
      await mongoose.connection.close();
    } catch {
      /* ignore */
    }

    try {
      await closeRedis();
    } catch {
      /* ignore */
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function runScheduledJob(lockKey, fn) {
  return withCronLeader(lockKey, fn);
}

function isMongoNetError(err) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  return (
    name === 'MongoServerSelectionError' ||
    name === 'MongoNetworkError' ||
    name === 'MongooseServerSelectionError' ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('Server selection timed out')
  );
}

process.on('unhandledRejection', (err) => {
  if (isMongoNetError(err)) {
    console.error('❌ Mongo briefly unavailable:', err.message);
    return;
  }
  console.error('unhandledRejection:', err);
  if (isProduction()) {
    setTimeout(() => process.exit(1), 500);
  }
});

process.on('uncaughtException', (err) => {
  if (isMongoNetError(err)) {
    console.error('❌ Mongo briefly unavailable:', err.message);
    return;
  }
  console.error('uncaughtException:', err);
  if (isProduction()) {
    process.exit(1);
  }
});

async function startHttp() {
  await attachRedisAdapter();
  fcm.init();
  await pushQueue.init();

  try {
    await verifySmtpConnection();
  } catch (smtpErr) {
    console.error('❌ Email connection failed:', smtpErr.message);
    if (/timeout|ETIMEDOUT|ECONNECTION|ESOCKET/i.test(smtpErr.message || '')) {
      console.warn(
        '   Tip: Render free tier blocks SMTP ports 25/465/587. Set BREVO_API_KEY (HTTPS) instead of SMTP.',
      );
    } else {
      console.warn('   Server starting anyway. Fix BREVO_API_KEY / SMTP in env to send emails.');
    }
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // macOS AirPlay often owns :5000 — auto-retry once on 5001 for local dev
      if (
        process.platform === 'darwin' &&
        String(PORT) === '5000' &&
        !server.__retriedAltPort
      ) {
        const alt = 5001;
        console.warn(
          `⚠️  Port 5000 is in use (often AirPlay Receiver). Retrying on ${alt}…`,
        );
        console.warn('   Tip: set PORT=5001 in backend/.env to skip this.');
        server.__retriedAltPort = true;
        server.listen(alt, '0.0.0.0');
        return;
      }
      console.error(`❌ Port ${PORT} is already in use.`);
      if (process.platform === 'darwin' && String(PORT) === '5000') {
        console.error(
          '   On Mac, AirPlay Receiver (Control Center) usually owns port 5000.',
        );
        console.error(
          '   Fix: set PORT=5001 in backend/.env, or disable AirPlay Receiver:',
        );
        console.error(
          '   System Settings → General → AirDrop & Handoff → AirPlay Receiver.',
        );
      } else if (process.platform === 'win32') {
        console.error(`   netstat -ano | findstr :${PORT}`);
        console.error('   taskkill /PID <pid> /F');
      } else {
        console.error(`   lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
        console.error('   kill <pid>');
      }
      process.exit(1);
    }
    throw err;
  });

  registerGracefulShutdown();

  server.listen(PORT, '0.0.0.0', () => {
    const host = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log(`🚀 Luvstor server running on port ${PORT}`);
    console.log(`🌐 Public URL: ${host}`);
    console.log(`🔌 WebSocket: ${host.replace(/^http/, 'ws')}`);
    console.log(`📧 Auth: POST /api/auth/send-otp  |  POST /api/auth/google`);
    console.log(`🔔 Push: ${fcm.isEnabled() ? 'FCM ready' : 'FCM disabled (no credentials)'}`);
    const { isGoogleAuthConfigured, getGoogleAuthStatus } = require('./services/googleAuth');
    const gStatus = getGoogleAuthStatus();
    console.log(
      `🔐 Google login: ${isGoogleAuthConfigured() ? 'ready' : 'disabled (set GOOGLE_WEB_CLIENT_ID)'} (${gStatus.audienceCount} audience(s))`,
    );
    console.log(`📈 Health: GET /health  |  Ping: GET /ping  |  Ready: GET /ready`);

    setInterval(async () => {
      if (mongoose.connection.readyState !== 1) return;
      await runScheduledJob('deletion-cleanup', async () => {
        try {
          console.log('[Scheduled Job] Running deletion reminders...');
          await sendDeletionReminders();
          console.log('[Scheduled Job] Running permanent deletions...');
          await permanentlyDeleteAccounts();
          await pruneStaleTokens();
        } catch (err) {
          console.error('[Scheduled Job] deletion/cleanup failed:', err?.message || err);
        }
      });
    }, 6 * 60 * 60 * 1000);

    setInterval(() => {
      if (mongoose.connection.readyState !== 1) return;
      runScheduledJob('daily-suggestions', () =>
        runDailySuggestionsIfDue(io),
      ).catch((err) =>
        console.error('[Scheduled Job] daily suggestions failed:', err?.message || err),
      );
    }, 15 * 60 * 1000);

    const runExpireSubscriptions = () => {
      if (mongoose.connection.readyState !== 1) return Promise.resolve();
      return runScheduledJob('expire-subscriptions', () =>
        expireDueSubscriptions().then((n) => {
          if (n) console.log(`[Scheduled Job] Reverted ${n} expired subscription(s)`);
        }),
      ).catch((err) =>
        console.error('[Scheduled Job] expire subscriptions failed:', err?.message || err),
      );
    };

    setInterval(runExpireSubscriptions, 5 * 60 * 1000);

    const runPhotoVerificationAnalysis = () => {
      if (mongoose.connection.readyState !== 1) return Promise.resolve();
      return runScheduledJob('photo-verification-analysis', () =>
        approveDuePhotoVerifications(io).then((n) => {
          if (n) {
            console.log(
              `[Scheduled Job] Finished photo analysis for ${n} user(s)`,
            );
          }
        }),
      ).catch((err) =>
        console.error(
          '[Scheduled Job] photo verification analysis failed:',
          err?.message || err,
        ),
      );
    };

    // Every minute: analyse pending selfies past the 30-minute window
    setInterval(runPhotoVerificationAnalysis, 60 * 1000);

    // Engaging notifications: nearby users, active now, conversation starters, etc.
    // Run every 10 minutes for timely, relevant notifications
    setInterval(() => {
      if (mongoose.connection.readyState !== 1) return;
      runScheduledJob('engaging-notifications', () =>
        runEngagingNotifications(io),
      ).catch((err) =>
        console.error('[Scheduled Job] engaging notifications failed:', err?.message || err),
      );
    }, 10 * 60 * 1000);

    setTimeout(async () => {
      if (mongoose.connection.readyState !== 1) return;
      await runScheduledJob('startup-jobs', async () => {
        try {
          console.log('[Startup] Running deletion jobs...');
          await sendDeletionReminders();
          await permanentlyDeleteAccounts();
          await pruneStaleTokens();
          await runDailySuggestionsIfDue(io);
          await runExpireSubscriptions();
          await runPhotoVerificationAnalysis();
        } catch (err) {
          console.error('[Startup] jobs failed:', err?.message || err);
        }
      });
    }, 5000);
  });
}

(async () => {
  validateProductionEnv();
  console.log('🔌 Connecting to MongoDB before accepting traffic…');
  await connectMongo();
  await startHttp();
})().catch((err) => {
  console.error('Startup error:', err?.message || err);
  process.exit(1);
});
