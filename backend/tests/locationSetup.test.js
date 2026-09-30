/**
 * locationSetupCompleted on GET /api/users/me drives the one-time Enable
 * Location screen. Uses its own scratch database.
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

const TEST_DB_NAME = 'luvstor_location_setup_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error(`Refusing to run: cannot rewrite "${uri}" to ${TEST_DB_NAME}.`);
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);
const JWT_SECRET = 'location-setup-test-secret';
const DEVICE = 'device-location-setup-01';

let available = false;
let server;
let base;
let User;

let seq = 0;
async function makeUser(extra = {}) {
  seq += 1;
  return User.create({
    email: `loc-${seq}-${Date.now()}@test.local`,
    name: `Loc ${seq}`,
    isVerified: true,
    activeDeviceId: DEVICE,
    publicId: `LOCS${String(1000 + seq)}`,
    ...extra,
  });
}

function call(user, path, init = {}) {
  const token = jwt.sign({ userId: String(user._id), deviceId: DEVICE }, JWT_SECRET, { expiresIn: '1h' });
  return fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
}

async function me(user) {
  const res = await call(user, '/api/users/me');
  assert.equal(res.status, 200);
  return res.json();
}

async function putLocation(user, latitude, longitude) {
  return call(user, '/api/users/location', {
    method: 'PUT',
    body: JSON.stringify({ latitude, longitude }),
  });
}

test.before(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (err) {
    console.warn(`[location setup] skipped — no MongoDB at ${TEST_URI}: ${err.message}`);
    return;
  }
  if (mongoose.connection.name !== TEST_DB_NAME) throw new Error('Refusing to use a non-scratch database');
  User = require('../models/User');
  await mongoose.connection.dropDatabase();
  await User.init();

  const app = express();
  app.use(express.json());
  app.use('/api/users', require('../routes/users'));
  app.set('io', null);
  server = http.createServer(app);
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

test('new user without GPS is not set up; saving a real fix completes setup', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const user = await makeUser();
  assert.equal((await me(user)).locationSetupCompleted, false);

  const res = await putLocation(user, 12.9716, 77.5946);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).locationSetupCompleted, true);
  assert.equal((await me(user)).locationSetupCompleted, true);

  const stored = await User.findById(user._id).select('locationSetupCompletedAt').lean();
  assert.ok(stored.locationSetupCompletedAt instanceof Date);
});

test('an invalid fix does not complete setup', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const user = await makeUser();
  assert.equal((await putLocation(user, 0, 0)).status, 400);
  assert.equal((await me(user)).locationSetupCompleted, false);
});

test('existing user with a saved location counts as set up (no migration)', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const user = await makeUser({ location: { type: 'Point', coordinates: [77.5946, 12.9716] } });
  assert.equal((await me(user)).locationSetupCompleted, true);

  // Same spot again takes the "unchanged" path and still records the flag
  const res = await putLocation(user, 12.9716, 77.5946);
  assert.equal((await res.json()).unchanged, true);
  const stored = await User.findById(user._id).select('locationSetupCompletedAt').lean();
  assert.ok(stored.locationSetupCompletedAt instanceof Date);
});

test('setup date is kept when location moves later', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const user = await makeUser();
  await putLocation(user, 12.9716, 77.5946);
  const first = (await User.findById(user._id).lean()).locationSetupCompletedAt;
  await putLocation(user, 13.0827, 80.2707);
  const after = await User.findById(user._id).lean();
  assert.equal(after.locationSetupCompletedAt.getTime(), first.getTime());
  assert.deepEqual(after.location.coordinates, [80.2707, 13.0827]);
});
