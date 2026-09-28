const express = require('express');
const mongoose = require('mongoose');
const { Call, User, Message, DeviceToken } = require('../models/app');
const { asyncHandler, daysAgo } = require('../lib/http');
const { pingDb } = require('../db');
const { probe } = require('../lib/mainApi');
const razorpay = require('../lib/razorpay');
const { config } = require('../config');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requirePermission('system.view'));

const startedAt = new Date();

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [dbMs, health, ready, google, smtp, push, liveCalls, stuckCalls, counts, activeTokens] = await Promise.all([
      pingDb().catch(() => null),
      probe('/health', { timeoutMs: 60_000 }),
      probe('/ready'),
      probe('/api/auth/google-status'),
      probe('/api/auth/smtp-status'),
      probe('/api/notifications/admin/health', { auth: true }),
      Call.countDocuments({ status: { $in: ['ringing', 'connecting', 'connected'] }, startedAt: { $gte: daysAgo(1 / 8) } }),
      // Rows left "live" for hours usually mean a crashed call session
      Call.countDocuments({ status: { $in: ['ringing', 'connecting', 'connected'] }, startedAt: { $lt: daysAgo(1 / 8), $gte: daysAgo(2) } }),
      Promise.all([
        User.estimatedDocumentCount(),
        Message.estimatedDocumentCount(),
        Call.estimatedDocumentCount(),
      ]),
      DeviceToken.countDocuments({ active: true }),
    ]);

    const mem = process.memoryUsage();
    res.json({
      checkedAt: new Date().toISOString(),
      admin: {
        uptimeSec: Math.round((Date.now() - startedAt.getTime()) / 1000),
        node: process.version,
        rssMb: Math.round(mem.rss / 1048576),
        heapMb: Math.round(mem.heapUsed / 1048576),
        dbState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        dbPingMs: dbMs,
      },
      mainApi: {
        url: config.mainApiUrl,
        health,
        ready,
      },
      integrations: {
        google: google.data?.google || null,
        firebaseAdmin: google.data?.firebaseAdmin ?? null,
        smtp: smtp.data?.smtp
          ? {
              configured: smtp.data.smtp.configured,
              verified: smtp.data.smtp.verified,
              mode: smtp.data.smtp.mode,
              devMode: smtp.data.smtp.devMode,
            }
          : null,
        push: push.ok ? push.data : { error: push.error || `HTTP ${push.status}` },
        razorpayConfigured: razorpay.isConfigured(),
      },
      realtime: { liveCalls, stuckCalls, activePushTokens: activeTokens },
      collections: { users: counts[0], messages: counts[1], calls: counts[2] },
    });
  }),
);

module.exports = router;
