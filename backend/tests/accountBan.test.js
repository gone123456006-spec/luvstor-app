/**
 * Permanent ban: sign-in is refused on every path and live sessions (HTTP +
 * sockets) are revoked immediately. Uses its own scratch database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

try {
  require('dotenv').config();
} catch {
  /* dotenv is optional here */
}

const TEST_DB_NAME = 'luvstor_account_ban_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error(`Refusing to run: cannot rewrite "${uri}" to ${TEST_DB_NAME}.`);
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);
const JWT_SECRET = 'account-ban-test-secret';
const ADMIN_KEY = 'account-ban-test-admin-key';
const DEVICE = 'device-ban-test-0001';

let available = false;
let server;
let io;
let base;
let User;
let OTP;
let Report;

async function call(method, path, { body, token, admin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (admin) headers['x-admin-key'] = ADMIN_KEY;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function tokenFor(user, deviceId = DEVICE) {
  return jwt.sign({ userId: String(user._id), deviceId }, JWT_SECRET, { expiresIn: '1h' });
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(base, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    const timer = setTimeout(() => reject(new Error('socket connect timed out')), 8000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

let seq = 0;
async function makeUser() {
  seq += 1;
  return User.create({
    email: `ban-${seq}-${Date.now()}@test.local`,
    name: `Ban ${seq}`,
    isVerified: true,
    activeDeviceId: DEVICE,
    publicId: `BANT${String(1000 + seq)}`,
  });
}

async function issueOtp(email) {
  const otp = String(100000 + Math.floor(Math.random() * 899999));
  await OTP.create({ email, otp, expiresAt: new Date(Date.now() + 5 * 60_000) });
  return otp;
}

test.before(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (err) {
    console.warn(`[account ban] skipped — no MongoDB at ${TEST_URI}: ${err.message}`);
    return;
  }
  User = require('../models/User');
  OTP = require('../models/OTP');
  Report = require('../models/Report');
  await Promise.all([User.deleteMany({}), OTP.deleteMany({}), Report.deleteMany({})]);

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/admin', require('../routes/adminModeration'));
  const auth = require('../middleware/auth');
  app.get('/api/ping', auth, (_req, res) => res.json({ ok: true }));

  server = http.createServer(app);
  io = new Server(server, { cors: { origin: true } });
  app.set('io', io);
  require('../socket/index')(io);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (io) io.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (available) {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});

test('ban revokes the live HTTP session and socket immediately', async (t) => {
  if (!available) return t.skip('no database');
  const user = await makeUser();
  const token = tokenFor(user);

  assert.equal((await call('GET', '/api/ping', { token })).status, 200);
  const socket = await connectSocket(token);
  const kicked = new Promise((resolve) => socket.on('disconnect', resolve));

  const res = await call('POST', `/api/admin/users/${user._id}/ban`, { admin: true, body: { reason: 'abuse' } });
  assert.equal(res.status, 200);

  const after = await call('GET', '/api/ping', { token });
  assert.equal(after.status, 401);
  assert.equal(after.body.code, 'DEVICE_MISMATCH', 'the installed app signs out on this code');
  await kicked;
  await assert.rejects(() => connectSocket(token), /Authentication/);

  const doc = await User.findById(user._id).lean();
  assert.equal(doc.isBanned, true);
  assert.equal(doc.isDeactivated, true);
  assert.equal(doc.activeDeviceId, null);
  assert.equal(doc.banReason, 'abuse');
});

test('banned user cannot sign in by email code or device transfer', async (t) => {
  if (!available) return t.skip('no database');
  const user = await makeUser();
  await call('POST', `/api/admin/users/${user._id}/ban`, { admin: true, body: {} });

  const send = await call('POST', '/api/auth/send-otp', { body: { email: user.email } });
  assert.equal(send.status, 403);
  assert.equal(send.body.code, 'ACCOUNT_BANNED');
  assert.match(send.body.error, /permanently blocked/);

  const verify = await call('POST', '/api/auth/verify-otp', {
    body: { email: user.email, otp: await issueOtp(user.email), deviceId: DEVICE, forceTransfer: true },
  });
  assert.equal(verify.status, 403);
  assert.equal(verify.body.code, 'ACCOUNT_BANNED');
  assert.equal(verify.body.token, undefined);

  const transfer = await call('POST', '/api/auth/transfer-device', {
    body: { email: user.email, otp: await issueOtp(user.email), deviceId: 'another-device-0002' },
  });
  assert.equal(transfer.status, 403);
  assert.equal(transfer.body.code, 'ACCOUNT_BANNED');

  const doc = await User.findById(user._id).lean();
  assert.equal(doc.activeDeviceId, null, 'no device was bound');
});

test('unban restores sign-in', async (t) => {
  if (!available) return t.skip('no database');
  const user = await makeUser();
  await call('POST', `/api/admin/users/${user._id}/ban`, { admin: true, body: {} });
  const res = await call('POST', `/api/admin/users/${user._id}/unban`, { admin: true });
  assert.equal(res.status, 200);

  const verify = await call('POST', '/api/auth/verify-otp', {
    body: { email: user.email, otp: await issueOtp(user.email), deviceId: DEVICE, forceTransfer: true },
  });
  assert.equal(verify.status, 200);
  assert.ok(verify.body.token);
  const doc = await User.findById(user._id).lean();
  assert.equal(doc.isBanned, false);
  assert.equal(doc.isDeactivated, false);
});

test('resolving a report with "banned" applies the permanent ban', async (t) => {
  if (!available) return t.skip('no database');
  const reporter = await makeUser();
  const target = await makeUser();
  const report = await Report.create({ reporterId: reporter._id, reportedUserId: target._id, reason: 'harassment' });

  const res = await call('PATCH', `/api/admin/reports/${report._id}`, {
    admin: true,
    body: { status: 'actioned', actionTaken: 'banned', moderatorNote: 'repeated abuse' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.userAction.banned, true);

  const doc = await User.findById(target._id).lean();
  assert.equal(doc.isBanned, true);
  assert.equal((await call('GET', '/api/ping', { token: tokenFor(target) })).status, 401);
});

test('admin ban endpoints require the admin key and a valid id', async (t) => {
  if (!available) return t.skip('no database');
  const user = await makeUser();
  assert.equal((await call('POST', `/api/admin/users/${user._id}/ban`, { body: {} })).status, 403);
  assert.equal((await call('POST', '/api/admin/users/nope/ban', { admin: true, body: {} })).status, 400);
  const doc = await User.findById(user._id).lean();
  assert.notEqual(doc.isBanned, true);
});
