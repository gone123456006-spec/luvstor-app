/**
 * HTTP-level checks for GET /api/users/nearby.
 *
 * Boots the real Express router with the real auth middleware against a
 * throwaway database, so this covers the parts the service-level tests skip:
 * token handling, query-param parsing, the JSON response shape the app reads,
 * and the legacy parameter names older builds still send.
 *
 * Uses its own scratch database so it can run in parallel with the other suites.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

try {
  require('dotenv').config();
} catch {
  /* dotenv is optional here */
}

const TEST_DB_NAME = 'luvstor_discovery_api_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) {
    throw new Error(`Refusing to run: cannot rewrite "${uri}" to ${TEST_DB_NAME}.`);
  }
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);
const JWT_SECRET = process.env.JWT_SECRET || 'discovery-api-test-secret';

const BASE_LNG = 77.5946;
const BASE_LAT = 12.9716;
const DEVICE_ID = 'test-device-0001';

let available = false;
let server;
let baseUrl;
let User;
let DiscoveryImpression;
let viewerToken;
let viewer;
let seq = 0;

function makeUser(overrides = {}) {
  seq += 1;
  const index = overrides.__index ?? seq;
  delete overrides.__index;
  return User.create({
    email: `api-${seq}@test.local`,
    name: `Tester ${seq}`,
    age: 24,
    gender: 'Woman',
    photo: 'photo.jpg',
    isVerified: true,
    location: { type: 'Point', coordinates: [BASE_LNG + index * 0.002, BASE_LAT] },
    ...overrides,
  });
}

test.before(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (err) {
    console.warn(`[discovery api] skipped — no MongoDB at ${TEST_URI}: ${err.message}`);
    return;
  }
  if (mongoose.connection.name !== TEST_DB_NAME) {
    throw new Error(`Refusing to drop "${mongoose.connection.name}".`);
  }
  await mongoose.connection.dropDatabase();

  User = require('../models/User');
  DiscoveryImpression = require('../models/DiscoveryImpression');
  await Promise.all([User.init(), DiscoveryImpression.init()]);

  const app = express();
  app.use(express.json());
  app.use('/api/users', require('../routes/users'));

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  viewer = await makeUser({
    name: 'Viewer',
    gender: 'Man',
    activeDeviceId: DEVICE_ID,
    __index: 0,
  });
  for (let i = 0; i < 60; i += 1) await makeUser({ __index: i + 1 });

  viewerToken = jwt.sign({ userId: String(viewer._id), deviceId: DEVICE_ID }, JWT_SECRET);
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (!available) return;
  if (mongoose.connection.name === TEST_DB_NAME) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

async function getNearby(query = '', token = viewerToken) {
  const res = await fetch(`${baseUrl}/api/users/nearby${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json() };
}

test('api: rejects an unauthenticated request', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const { status } = await getNearby('', null);
  assert.equal(status, 401);
});

test('api: returns the { users, hasMore } shape the app expects', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const { status, body } = await getNearby('?radius=50000&mode=initial&limit=25');

  assert.equal(status, 200);
  assert.ok(Array.isArray(body.users), 'users must be an array');
  assert.equal(typeof body.hasMore, 'boolean');
  assert.equal(body.users.length, 25, 'a full batch should be served');

  // Every field frontend/utils/nearby.ts maps must be present.
  for (const u of body.users) {
    for (const field of [
      'id',
      'publicId',
      'name',
      'age',
      'bio',
      'photo',
      'photos',
      'gender',
      'interests',
      'relationshipGoal',
      'isOnline',
      'distance',
      'distanceKm',
      'friendshipStatus',
      'areFriends',
      'iLiked',
      'theyLiked',
      'source',
    ]) {
      assert.ok(field in u, `missing field "${field}" in nearby response`);
    }
    assert.ok(['nearby', 'random'].includes(u.source));
  }
  // Internal ranking metadata must never leak to clients.
  assert.equal('_rotation' in body.users[0], false);
});

test('api: a second call serves different people and load-more never repeats', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const first = await getNearby('?radius=50000&mode=initial&limit=25');
  const firstIds = first.body.users.map((u) => String(u.id));

  const second = await getNearby(
    `?radius=50000&mode=more&limit=25&exclude=${firstIds.join(',')}`,
  );
  const secondIds = second.body.users.map((u) => String(u.id));

  assert.equal(secondIds.length, 25);
  assert.equal(new Set([...firstIds, ...secondIds]).size, 50, 'load-more repeated a profile');
});

test('api: legacy nearbyLimit/randomLimit params from older builds still work', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const { status, body } = await getNearby(
    '?radius=50000&mode=initial&nearbyLimit=25&randomLimit=25',
  );
  assert.equal(status, 200);
  assert.equal(body.users.length, 50, 'legacy clients should still get 25+25');
});

test('api: track=0 serves the feed without writing history', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await DiscoveryImpression.deleteMany({ viewerId: viewer._id });

  const { body } = await getNearby('?radius=50000&mode=more&limit=30&activeWithin=5&track=0');
  assert.ok(Array.isArray(body.users));
  assert.equal(await DiscoveryImpression.countDocuments({ viewerId: viewer._id }), 0);
});

test('api: a tracked call records history for exactly the profiles it served', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await DiscoveryImpression.deleteMany({ viewerId: viewer._id });

  const { body } = await getNearby('?radius=50000&mode=more&limit=25');
  const rows = await DiscoveryImpression.find({ viewerId: viewer._id }).lean();

  assert.equal(rows.length, body.users.length);
  const served = new Set(body.users.map((u) => String(u.id)));
  for (const row of rows) {
    assert.ok(served.has(String(row.candidateId)));
    assert.equal(row.impressionCount, 1);
  }
});

test('api: an oversized batch request is capped', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const { body } = await getNearby('?radius=50000&mode=more&limit=5000');
  assert.ok(body.users.length <= 50, `expected <= 50, got ${body.users.length}`);
});

test('api: an oversized exclude list is accepted rather than failing the feed', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const junk = Array.from({ length: 600 }, () => new mongoose.Types.ObjectId().toString());
  const { status, body } = await getNearby(
    `?radius=50000&mode=more&limit=25&exclude=${junk.join(',')}`,
  );
  assert.equal(status, 200);
  assert.ok(body.users.length > 0);
});

test('api: a viewer with no location gets a clear error instead of a crash', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const stranded = await User.create({
    email: `api-noloc-${Date.now()}@test.local`,
    name: 'No Location',
    isVerified: true,
    activeDeviceId: DEVICE_ID,
    location: { type: 'Point', coordinates: [] },
  });
  const token = jwt.sign({ userId: String(stranded._id), deviceId: DEVICE_ID }, JWT_SECRET);

  const { status, body } = await getNearby('?radius=50000', token);
  assert.equal(status, 400);
  assert.match(body.error, /location/i);
});

test('api: with no gender query a woman viewer only sees men', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const woman = await makeUser({
    name: 'Woman Viewer',
    gender: 'Woman',
    showMe: '',
    discoveryPrefs: { gender: '', radiusKm: 50, activeWithinMinutes: 0 },
    activeDeviceId: DEVICE_ID,
    __index: 80,
  });
  await makeUser({ name: 'Nearby Man', gender: 'Man', __index: 81 });
  await makeUser({ name: 'Nearby Woman', gender: 'Woman', __index: 82 });
  const token = jwt.sign({ userId: String(woman._id), deviceId: DEVICE_ID }, JWT_SECRET);

  const { status, body } = await getNearby('?radius=50000&mode=initial&limit=25&track=0', token);
  assert.equal(status, 200);
  assert.ok(body.users.length > 0);
  for (const u of body.users) {
    assert.equal(u.gender, 'Man', `${u.name} should not appear for a woman viewer`);
  }
});

test('api: showMe=All still returns mixed genders', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const open = await makeUser({
    name: 'Open Viewer',
    gender: 'Woman',
    showMe: 'All',
    discoveryPrefs: { gender: 'All', radiusKm: 50, activeWithinMinutes: 0 },
    activeDeviceId: DEVICE_ID,
    __index: 90,
  });
  await makeUser({ name: 'Mix Man', gender: 'Man', __index: 91 });
  await makeUser({ name: 'Mix Woman', gender: 'Woman', __index: 92 });
  const token = jwt.sign({ userId: String(open._id), deviceId: DEVICE_ID }, JWT_SECRET);

  const { status, body } = await getNearby('?radius=50000&mode=initial&limit=25&track=0', token);
  assert.equal(status, 200);
  const genders = new Set(body.users.map((u) => u.gender));
  assert.ok(genders.has('Man') && genders.has('Woman'), 'Everyone should include both genders');
});
