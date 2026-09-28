/**
 * A user reported by 3 different people gets one automatic warning
 * notification. Uses its own scratch database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

try {
  require('dotenv').config();
} catch {
  /* dotenv is optional here */
}

const TEST_DB_NAME = 'luvstor_report_warning_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error(`Refusing to run: cannot rewrite "${uri}" to ${TEST_DB_NAME}.`);
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);
const JWT_SECRET = 'report-warning-test-secret';
const DEVICE = 'device-report-warning-01';

let available = false;
let server;
let base;
let User;
let Report;
let Notification;

let seq = 0;
async function makeUser() {
  seq += 1;
  return User.create({
    email: `rw-${seq}-${Date.now()}@test.local`,
    name: `Reporter ${seq}`,
    isVerified: true,
    activeDeviceId: DEVICE,
    publicId: `REPW${String(1000 + seq)}`,
  });
}

async function report(reporter, target) {
  const token = jwt.sign({ userId: String(reporter._id), deviceId: DEVICE }, JWT_SECRET, { expiresIn: '1h' });
  const res = await fetch(`${base}/api/friends/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId: String(target._id), reason: 'harassment' }),
  });
  assert.equal(res.status, 200);
}

async function warningsFor(user) {
  // The warning is sent in the background right after the report is saved
  for (let i = 0; i < 20; i += 1) {
    const rows = await Notification.find({ userId: user._id, dedupeKey: /^report-warning/ }).lean();
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

test.before(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (err) {
    console.warn(`[report warning] skipped — no MongoDB at ${TEST_URI}: ${err.message}`);
    return;
  }
  if (mongoose.connection.name !== TEST_DB_NAME) throw new Error('Refusing to use a non-scratch database');
  User = require('../models/User');
  Report = require('../models/Report');
  Notification = require('../models/Notification');
  await mongoose.connection.dropDatabase();
  await Notification.init();

  const app = express();
  app.use(express.json());
  app.use('/api/friends', require('../routes/friends'));
  server = http.createServer(app);
  app.set('io', null);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (available) {
    if (mongoose.connection.name === TEST_DB_NAME) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test('no warning below 3 reporters', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const target = await makeUser();
  await report(await makeUser(), target);
  await report(await makeUser(), target);
  assert.equal((await warningsFor(target)).length, 0);
});

test('3rd reporter triggers exactly one warning, later reports do not repeat it', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const target = await makeUser();
  for (let i = 0; i < 3; i += 1) await report(await makeUser(), target);
  const first = await warningsFor(target);
  assert.equal(first.length, 1);
  assert.equal(first[0].type, 'security');
  assert.match(first[0].body, /reported by 3 people/);
  assert.match(first[0].body, /2 more reports may lead to your account being permanently blocked/);

  await report(await makeUser(), target);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await warningsFor(target)).length, 1);
});

test('dismissed reports are not counted', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const target = await makeUser();
  await report(await makeUser(), target);
  await report(await makeUser(), target);
  await Report.updateMany({ reportedUserId: target._id }, { $set: { status: 'dismissed' } });
  await report(await makeUser(), target);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await warningsFor(target)).length, 0);
});
