/**
 * End-to-end checks for the Nearby discovery pipeline against a real MongoDB.
 *
 * Uses a throwaway database (…_discovery_test) that is dropped afterwards, so
 * it never touches development or production data. The whole suite is skipped
 * when no MongoDB is reachable.
 *
 * Connection string: MONGO_TEST_URI, else MONGODB_URI from .env, else localhost.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

try {
  require('dotenv').config();
} catch {
  /* dotenv is optional here */
}

const TEST_DB_NAME = 'luvstor_discovery_test';

/**
 * Point any connection string at the throwaway database, keeping host + options.
 *
 * This suite drops whatever database it connects to, so an unrecognised
 * connection string must abort rather than fall through to the original URI.
 */
function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) {
    throw new Error(
      `Refusing to run: could not rewrite "${uri}" to the ${TEST_DB_NAME} database. ` +
        'Set MONGO_TEST_URI to a scratch MongoDB instance.',
    );
  }
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_LNG = 77.5946;
const BASE_LAT = 12.9716;

let available = false;
let User;
let Friendship;
let DiscoveryImpression;
let discovery;

test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (err) {
    console.warn(`[discovery integration] skipped — no MongoDB at ${TEST_URI}: ${err.message}`);
    return;
  }

  User = require('../models/User');
  Friendship = require('../models/Friendship');
  DiscoveryImpression = require('../models/DiscoveryImpression');
  discovery = require('../services/discovery');

  // Belt and braces: never drop anything that is not the scratch database.
  if (mongoose.connection.name !== TEST_DB_NAME) {
    throw new Error(
      `Refusing to drop database "${mongoose.connection.name}" — expected ${TEST_DB_NAME}.`,
    );
  }

  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Friendship.init(), DiscoveryImpression.init()]);
});

test.after(async () => {
  if (!available) return;
  if (mongoose.connection.name === TEST_DB_NAME) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

let seq = 0;
function nextEmail() {
  seq += 1;
  return `disc-${Date.now()}-${seq}@test.local`;
}

async function makeUser(overrides = {}) {
  const index = overrides.__index ?? seq;
  delete overrides.__index;
  return User.create({
    email: nextEmail(),
    name: overrides.name ?? `Tester ${seq}`,
    age: 25,
    gender: 'Woman',
    photo: 'photo.jpg',
    bio: 'hello',
    isVerified: true,
    // ~220 m apart so distance ordering is observable.
    location: { type: 'Point', coordinates: [BASE_LNG + index * 0.002, BASE_LAT] },
    ...overrides,
  });
}

async function makePopulation(count, overrides = {}) {
  const users = [];
  for (let i = 0; i < count; i += 1) {
    users.push(await makeUser({ ...overrides, __index: i + 1 }));
  }
  return users;
}

async function freshViewer() {
  return makeUser({ name: 'Viewer', gender: 'Man', __index: 0 });
}

/** Reset state between cases without paying for a full DB drop. */
async function resetCollections() {
  await Promise.all([
    User.deleteMany({}),
    Friendship.deleteMany({}),
    DiscoveryImpression.deleteMany({}),
  ]);
}

function batchArgs(viewer, extra = {}) {
  return {
    viewer,
    radiusMetres: 50000,
    genderFilter: '',
    activeWithinMinutes: 0,
    excludeIds: [],
    targetCount: 25,
    ...extra,
  };
}

test('integration: 7 consecutive days rotate people and never repeat yesterday', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  await makePopulation(70);

  const days = [];
  for (let day = 0; day < 7; day += 1) {
    const now = new Date(Date.now() + day * DAY_MS);
    const { users } = await discovery.buildNearbyBatch(batchArgs(viewer, { now }));
    days.push(users.map((u) => String(u.id)));
  }

  for (const [i, ids] of days.entries()) {
    assert.equal(ids.length, 25, `day ${i + 1} did not fill the batch`);
    assert.equal(new Set(ids).size, 25, `day ${i + 1} contained a duplicate`);
  }

  for (let day = 1; day < days.length; day += 1) {
    const yesterday = new Set(days[day - 1]);
    const repeated = days[day].filter((id) => yesterday.has(id));
    assert.equal(repeated.length, 0, `day ${day + 1} repeated ${repeated.length} of yesterday's profiles`);
  }

  // Days 1–3 should surface every eligible person at least once.
  const firstThree = new Set([...days[0], ...days[1], ...days[2]]);
  assert.equal(firstThree.size, 70, 'the fresh pool was not exhausted before repeating');
});

test('integration: history is per viewer — one viewer seeing a profile does not hide it', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewerA = await freshViewer();
  const viewerB = await makeUser({ name: 'Viewer B', gender: 'Man', __index: 0 });
  await makePopulation(30);

  const a = await discovery.buildNearbyBatch(batchArgs(viewerA));
  const b = await discovery.buildNearbyBatch(batchArgs(viewerB));

  const seenByA = new Set(a.users.map((u) => String(u.id)));
  const overlap = b.users.filter((u) => seenByA.has(String(u.id)));
  assert.ok(overlap.length > 0, 'viewer B lost access to profiles viewer A had seen');

  const rows = await DiscoveryImpression.find({ viewerId: viewerB._id }).lean();
  assert.equal(rows.length, b.users.length);
});

test('integration: blocked users never appear in either direction', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  const people = await makePopulation(10);
  const iBlocked = people[0];
  const theyBlocked = people[1];

  for (const [other, blockedBy] of [
    [iBlocked, viewer._id],
    [theyBlocked, theyBlocked._id],
  ]) {
    const { userA, userB } = Friendship.getSortedPair(viewer._id, other._id);
    await Friendship.create({
      userA,
      userB,
      status: 'blocked',
      initiatedBy: blockedBy,
      blockedBy,
      blockedAt: new Date(),
    });
  }

  const { users } = await discovery.buildNearbyBatch(batchArgs(viewer));
  const ids = users.map((u) => String(u.id));
  assert.equal(ids.length, 8);
  assert.ok(!ids.includes(String(iBlocked._id)), 'a user I blocked was shown');
  assert.ok(!ids.includes(String(theyBlocked._id)), 'a user who blocked me was shown');
});

test('integration: ineligible accounts are filtered out in the database', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  const eligible = await makePopulation(5);
  const unverified = await makeUser({ isVerified: false, __index: 20 });
  const deactivated = await makeUser({ isDeactivated: true, __index: 21 });
  const deleting = await makeUser({ deletionScheduledAt: new Date(), __index: 22 });
  const nameless = await makeUser({ name: '', __index: 23 });
  // Schema default [0, 0] — never shared their location.
  const noLocation = await makeUser({ location: undefined, __index: 24 });

  const { users } = await discovery.buildNearbyBatch(batchArgs(viewer));
  const ids = new Set(users.map((u) => String(u.id)));

  assert.equal(ids.size, eligible.length);
  for (const excluded of [unverified, deactivated, deleting, nameless, noLocation]) {
    assert.ok(!ids.has(String(excluded._id)));
  }
  assert.ok(!ids.has(String(viewer._id)), 'the viewer saw themselves');
});

test('integration: a user who never shared location is neither served nor discoverable', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  await makePopulation(5);
  const stranded = await makeUser({ name: 'Stranded', location: undefined, __index: 30 });
  assert.deepEqual(stranded.location.coordinates, [0, 0], 'fixture should use the schema default');
  assert.equal(discovery.hasRealLocation(stranded.location.coordinates), false);

  const viewer = await freshViewer();
  const { users } = await discovery.buildNearbyBatch(batchArgs(viewer));
  assert.ok(!users.some((u) => String(u.id) === String(stranded._id)));
});

test('integration: gender filter still applies', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  await makePopulation(6, { gender: 'Woman' });
  await makePopulation(6, { gender: 'Man' });

  const { users } = await discovery.buildNearbyBatch(
    batchArgs(viewer, { genderFilter: 'woman' }),
  );
  assert.ok(users.length > 0);
  for (const u of users) assert.equal(u.gender, 'Woman');
});

test('integration: pagination with exclude ids never repeats a profile', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  await makePopulation(80);

  const seen = [];
  for (let page = 0; page < 3; page += 1) {
    const { users } = await discovery.buildNearbyBatch(
      batchArgs(viewer, { excludeIds: [...seen] }),
    );
    assert.equal(users.length, 25, `page ${page + 1} was short`);
    seen.push(...users.map((u) => String(u.id)));
  }

  assert.equal(seen.length, 75);
  assert.equal(new Set(seen).size, 75, 'load-more returned an already loaded profile');
});

test('integration: track=false serves the feed without consuming freshness', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  await makePopulation(30);

  await discovery.buildNearbyBatch(batchArgs(viewer, { trackImpressions: false }));
  assert.equal(await DiscoveryImpression.countDocuments({ viewerId: viewer._id }), 0);

  const { users } = await discovery.buildNearbyBatch(batchArgs(viewer));
  assert.equal(await DiscoveryImpression.countDocuments({ viewerId: viewer._id }), users.length);
});

test('integration: only served profiles are recorded, not the whole candidate pool', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  await makePopulation(120);

  const { users } = await discovery.buildNearbyBatch(batchArgs(viewer));
  const recorded = await DiscoveryImpression.countDocuments({ viewerId: viewer._id });
  assert.equal(users.length, 25);
  assert.equal(recorded, 25, 'candidates that were only ranked got marked as seen');
});

test('integration: concurrent requests keep impression history consistent', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  await makePopulation(60);

  const batches = await Promise.all([
    discovery.buildNearbyBatch(batchArgs(viewer)),
    discovery.buildNearbyBatch(batchArgs(viewer)),
    discovery.buildNearbyBatch(batchArgs(viewer)),
  ]);

  const rows = await DiscoveryImpression.find({ viewerId: viewer._id }).lean();
  const keys = rows.map((r) => String(r.candidateId));
  assert.equal(new Set(keys).size, keys.length, 'duplicate history rows were created');

  const servedCounts = new Map();
  for (const batch of batches) {
    for (const u of batch.users) {
      const id = String(u.id);
      servedCounts.set(id, (servedCounts.get(id) || 0) + 1);
    }
  }
  for (const row of rows) {
    const expected = servedCounts.get(String(row.candidateId));
    assert.equal(row.impressionCount, expected, 'impression count drifted under concurrency');
    assert.ok(row.firstShownAt instanceof Date);
    assert.ok(row.lastShownAt instanceof Date);
    assert.ok(row.lastBucket >= 0 && row.lastBucket < 7);
  }
});

test('integration: a small user base returns everyone instead of going empty', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  await makePopulation(18);

  const first = await discovery.buildNearbyBatch(batchArgs(viewer));
  assert.equal(first.users.length, 18);
  assert.equal(first.hasMore, false);

  // Everyone has now been seen; the feed must still fill via controlled repeats.
  const second = await discovery.buildNearbyBatch(
    batchArgs(viewer, { now: new Date(Date.now() + DAY_MS) }),
  );
  assert.equal(second.users.length, 18);
  assert.equal(new Set(second.users.map((u) => String(u.id))).size, 18);
});

test('integration: the radius expands when the primary ring has no fresh people', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  // 5 close by (~1 km), 30 far away (~55–70 km).
  const close = await makePopulation(5);
  for (let i = 0; i < 30; i += 1) {
    await makeUser({ __index: 0, location: { type: 'Point', coordinates: [BASE_LNG + 0.5 + i * 0.01, BASE_LAT] } });
  }

  const radiusMetres = 5000;
  const closeIds = new Set(close.map((u) => String(u._id)));

  const first = await discovery.buildNearbyBatch(batchArgs(viewer, { radiusMetres }));
  assert.equal(first.users.length, 25, 'expansion did not top the batch up');
  for (const u of first.users) {
    assert.equal(
      u.source,
      closeIds.has(String(u.id)) ? 'nearby' : 'random',
      'source must reflect whether the profile is inside the configured radius',
    );
  }
  assert.equal(
    first.users.filter((u) => u.source === 'nearby').length,
    close.length,
    'in-radius people were skipped',
  );

  // Once the primary ring is fully seen, expansion must still fill the batch
  // with unseen people from further out rather than repeating the close ones.
  const second = await discovery.buildNearbyBatch(
    batchArgs(viewer, {
      radiusMetres,
      excludeIds: first.users.map((u) => String(u.id)),
    }),
  );
  assert.equal(second.users.length, 10, 'remaining far-away people were not reached');
  assert.equal(second.users.every((u) => u.source === 'random'), true);
});

test('integration: distance fields are populated for the served batch', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  await makePopulation(10);

  const { users } = await discovery.buildNearbyBatch(batchArgs(viewer));
  for (const u of users) {
    assert.ok(Number.isFinite(u.distance), 'missing distance');
    assert.ok(/^\d+\.\d$/.test(u.distanceKm), `unexpected distanceKm: ${u.distanceKm}`);
    assert.equal(u.friendshipStatus, 'stranger');
    assert.equal(u.areFriends, false);
  }
});

test('integration: friendship state is hydrated in one pass', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  await resetCollections();

  const viewer = await freshViewer();
  const people = await makePopulation(5);
  const friend = people[0];
  const liked = people[1];

  const pairA = Friendship.getSortedPair(viewer._id, friend._id);
  await Friendship.create({
    ...pairA,
    status: 'friends',
    initiatedBy: viewer._id,
    friendsSince: new Date(),
  });
  const pairB = Friendship.getSortedPair(viewer._id, liked._id);
  await Friendship.create({ ...pairB, status: 'pending_like', initiatedBy: viewer._id });

  const { users } = await discovery.buildNearbyBatch(batchArgs(viewer));
  const byId = new Map(users.map((u) => [String(u.id), u]));

  assert.equal(byId.get(String(friend._id)).friendshipStatus, 'friends');
  assert.equal(byId.get(String(friend._id)).areFriends, true);
  assert.equal(byId.get(String(liked._id)).iLiked, true);
  assert.equal(byId.get(String(liked._id)).theyLiked, false);
});
