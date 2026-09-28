/**
 * Discover preferences (Show me / Distance / Last active) are hard filters on
 * the Nearby feed, checked against a real MongoDB scratch database.
 *
 * Connection string: MONGO_TEST_URI, else MONGODB_URI from .env, else localhost.
 * Skipped when no MongoDB is reachable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

try {
  require('dotenv').config();
} catch {
  /* dotenv is optional here */
}

const TEST_DB_NAME = 'luvstor_discovery_prefs_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) {
    throw new Error(`Refusing to run: could not rewrite "${uri}" to the ${TEST_DB_NAME} database.`);
  }
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);

const BASE_LNG = 77.5946;
const BASE_LAT = 12.9716;
/** ~111 km per degree of latitude */
const KM = 1 / 111;
const MIN = 60_000;

let available = false;
let User;
let DiscoveryImpression;
let discovery;

test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (err) {
    console.warn(`[discovery prefs] skipped — no MongoDB at ${TEST_URI}: ${err.message}`);
    return;
  }
  User = require('../models/User');
  DiscoveryImpression = require('../models/DiscoveryImpression');
  discovery = require('../services/discovery');
  if (mongoose.connection.name !== TEST_DB_NAME) {
    throw new Error(`Refusing to drop database "${mongoose.connection.name}"`);
  }
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), DiscoveryImpression.init()]);
});

test.after(async () => {
  if (!available) return;
  if (mongoose.connection.name === TEST_DB_NAME) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
async function person(name, { km = 0, gender = 'Woman', lastSeenAgoMin = 1, ...rest } = {}) {
  seq += 1;
  return User.create({
    email: `prefs-${Date.now()}-${seq}@test.local`,
    name,
    age: 25,
    gender,
    photo: 'photo.jpg',
    isVerified: true,
    lastSeen: new Date(Date.now() - lastSeenAgoMin * MIN),
    location: { type: 'Point', coordinates: [BASE_LNG, BASE_LAT + km * KM] },
    ...rest,
  });
}

async function seed() {
  await Promise.all([User.deleteMany({}), DiscoveryImpression.deleteMany({})]);
  const viewer = await person('Viewer', { gender: 'Man' });
  await person('W near', { km: 0.4 });
  await person('W 3km idle 2d', { km: 3, lastSeenAgoMin: 2 * 24 * 60 });
  await person('W 30km', { km: 30 });
  await person('W 300km', { km: 300 });
  await person('M near', { km: 0.4, gender: 'Man' });
  return User.findById(viewer._id).lean();
}

async function feed(viewer, { radiusKm = 500, genderFilter = 'all', activeWithinMinutes = 0 } = {}) {
  const { users } = await discovery.buildNearbyFeed({
    viewer,
    radiusMetres: radiusKm * 1000,
    genderFilter,
    activeWithinMinutes,
    excludeIds: [],
    trackImpressions: false,
  });
  return users.map((u) => u.name).sort();
}

test('distance below 100 km only returns people inside it', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const viewer = await seed();
  assert.deepEqual(await feed(viewer, { radiusKm: 1 }), ['M near', 'W near']);
  assert.deepEqual(await feed(viewer, { radiusKm: 5 }), ['M near', 'W 3km idle 2d', 'W near']);
  assert.deepEqual(await feed(viewer, { radiusKm: 50 }), ['M near', 'W 30km', 'W 3km idle 2d', 'W near']);
});

test('distance "All" still includes people further away', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const viewer = await seed();
  assert.ok((await feed(viewer, { radiusKm: 500 })).includes('W 300km'));
});

test('show me is never relaxed to fill the feed', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const viewer = await seed();
  const women = await feed(viewer, { genderFilter: 'woman' });
  assert.deepEqual(women, ['W 300km', 'W 30km', 'W 3km idle 2d', 'W near']);
  assert.deepEqual(await feed(viewer, { genderFilter: 'man' }), ['M near']);
});

test('last active uses the chosen window, not online-only', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const viewer = await seed();
  const hour = await feed(viewer, { activeWithinMinutes: 60 });
  assert.ok(!hour.includes('W 3km idle 2d'));
  assert.ok(hour.includes('W near'));
  const threeDays = await feed(viewer, { activeWithinMinutes: 3 * 24 * 60 });
  assert.ok(threeDays.includes('W 3km idle 2d'));
});

test('filters combine', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const viewer = await seed();
  assert.deepEqual(
    await feed(viewer, { radiusKm: 5, genderFilter: 'woman', activeWithinMinutes: 60 }),
    ['W near'],
  );
});
