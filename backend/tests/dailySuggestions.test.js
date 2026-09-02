/**
 * Daily suggestion digest.
 *
 * The copy/scheduling logic is pure and always runs; the delivery pipeline is
 * exercised against a throwaway MongoDB database that is dropped afterwards and
 * skipped entirely when no MongoDB is reachable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

try {
  require('dotenv').config();
} catch {
  /* dotenv is optional here */
}

const {
  composeDigest,
  suggestionDayKey,
  isSendWindow,
  localHour,
  SEND_HOUR,
} = require('../jobs/dailySuggestions');

// ── Copy: what the user actually reads in the tray ────────────────────────

test('the strongest signal becomes the headline', () => {
  assert.equal(
    composeDigest({ matches: 2, likes: 5, views: 3, nearby: 0 }).title,
    'You have 2 new matches',
  );
  assert.equal(
    composeDigest({ matches: 0, likes: 5, views: 3, nearby: 0 }).title,
    '5 people liked you',
  );
  assert.equal(
    composeDigest({ matches: 0, likes: 0, views: 3, nearby: 0 }).title,
    '3 people viewed your profile',
  );
  assert.equal(
    composeDigest({ matches: 0, likes: 0, views: 0, nearby: 4 }).title,
    '4 new people joined near you',
  );
});

test('singular and plural copy both read naturally', () => {
  assert.equal(
    composeDigest({ matches: 1, likes: 0, views: 0, nearby: 0 }).title,
    'You have a new match',
  );
  assert.equal(
    composeDigest({ matches: 0, likes: 1, views: 0, nearby: 0 }).title,
    '1 person liked you',
  );
  assert.equal(
    composeDigest({ matches: 0, likes: 0, views: 1, nearby: 0 }).title,
    '1 person viewed your profile',
  );
  assert.equal(
    composeDigest({ matches: 0, likes: 0, views: 0, nearby: 1 }).title,
    '1 new person joined near you',
  );
});

test('secondary signals are folded into the body, never repeated', () => {
  const digest = composeDigest({ matches: 1, likes: 3, views: 2, nearby: 0 });
  assert.match(digest.body, /3 new likes/);
  assert.match(digest.body, /2 profile visits/);

  const viewsOnly = composeDigest({ matches: 0, likes: 0, views: 4, nearby: 0 });
  assert.doesNotMatch(viewsOnly.body, /profile visit/, 'the headline was repeated in the body');
});

test('a user with nothing waiting is never interrupted', () => {
  assert.equal(composeDigest({ matches: 0, likes: 0, views: 0, nearby: 0 }), null);
});

test('the digest deep-links to wherever the news is', () => {
  assert.equal(composeDigest({ matches: 1, likes: 0, views: 0, nearby: 0 }).deepLink, '/(tabs)/chat');
  assert.equal(composeDigest({ matches: 0, likes: 2, views: 0, nearby: 0 }).deepLink, '/(tabs)/chat');
  assert.equal(composeDigest({ matches: 0, likes: 0, views: 0, nearby: 3 }).deepLink, '/(tabs)');
});

// ── Scheduling ────────────────────────────────────────────────────────────

test('the day key is stable across a whole local day and flips at midnight', () => {
  const base = new Date('2025-03-03T06:00:00.000Z');
  const later = new Date('2025-03-03T17:00:00.000Z');
  assert.equal(suggestionDayKey(base), suggestionDayKey(later));
  assert.notEqual(suggestionDayKey(base), suggestionDayKey(new Date('2025-03-04T06:00:00.000Z')));
});

test('the send window is exactly one hour a day', () => {
  const open = new Date(Date.UTC(2025, 2, 3, 0, 0, 0));
  let matches = 0;
  for (let h = 0; h < 24; h += 1) {
    const at = new Date(open.getTime() + h * 60 * 60 * 1000);
    if (isSendWindow(at)) {
      matches += 1;
      assert.equal(localHour(at), SEND_HOUR);
    }
  }
  assert.equal(matches, 1, 'the digest would fire more than once a day');
});

// ── Delivery pipeline (requires MongoDB) ──────────────────────────────────

const TEST_DB_NAME = 'luvstor_suggestions_test';

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

let available = false;
let User;
let Friendship;
let Notification;
let ProfileView;
let sendDailySuggestions;
let recordProfileView;

test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (err) {
    console.warn(`[dailySuggestions] skipped — no MongoDB at ${TEST_URI}: ${err.message}`);
    return;
  }

  User = require('../models/User');
  Friendship = require('../models/Friendship');
  Notification = require('../models/Notification');
  ProfileView = require('../models/ProfileView');
  ({ sendDailySuggestions } = require('../jobs/dailySuggestions'));
  ({ recordProfileView } = require('../services/profileViews'));

  if (mongoose.connection.name !== TEST_DB_NAME) {
    throw new Error(
      `Refusing to drop database "${mongoose.connection.name}" — expected ${TEST_DB_NAME}.`,
    );
  }
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Friendship.init(), Notification.init(), ProfileView.init()]);
});

test.after(async () => {
  if (!available) return;
  if (mongoose.connection.name === TEST_DB_NAME) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

let seq = 0;
async function makeUser(overrides = {}) {
  seq += 1;
  return User.create({
    email: `digest-${Date.now()}-${seq}@test.local`,
    name: `Digest ${seq}`,
    age: 25,
    gender: 'Woman',
    isVerified: true,
    lastSeen: new Date(),
    location: { type: 'Point', coordinates: [77.5946 + seq * 0.002, 12.9716] },
    ...overrides,
  });
}

async function reset() {
  await Promise.all([
    User.deleteMany({}),
    Friendship.deleteMany({}),
    Notification.deleteMany({}),
    ProfileView.deleteMany({}),
  ]);
}

async function likedBy(target, liker, at = new Date()) {
  const pair = Friendship.getSortedPair(target._id, liker._id);
  return Friendship.create({
    userA: pair.userA,
    userB: pair.userB,
    status: 'pending_like',
    initiatedBy: liker._id,
    likedAt: at,
  });
}

test('a user with new likes gets exactly one digest naming them', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();

  const me = await makeUser();
  const [a, b] = [await makeUser(), await makeUser()];
  await likedBy(me, a);
  await likedBy(me, b);

  const stats = await sendDailySuggestions(null, { force: true });
  assert.ok(stats.created >= 1);

  const mine = await Notification.find({ userId: me._id, type: 'suggestion' }).lean();
  assert.equal(mine.length, 1, 'a user must never get more than one digest a day');
  assert.equal(mine[0].title, '2 people liked you');
  assert.equal(mine[0].data.likes, '2');
  assert.equal(mine[0].deepLink, '/(tabs)/chat');
});

test('running the job twice in one day does not send a second digest', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();

  const me = await makeUser();
  await likedBy(me, await makeUser());

  const now = new Date();
  await sendDailySuggestions(null, { force: true, now });
  const second = await sendDailySuggestions(null, { force: true, now });

  const mine = await Notification.countDocuments({ userId: me._id, type: 'suggestion' });
  assert.equal(mine, 1);
  assert.equal(second.created, 0, 'the dedupe key did not hold');
});

test('profile visits become a digest when there are no likes', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();

  const me = await makeUser();
  const visitorA = await makeUser();
  const visitorB = await makeUser();
  await recordProfileView(visitorA._id, me._id);
  await recordProfileView(visitorB._id, me._id);
  // Repeat visits from the same person must not inflate the count.
  await recordProfileView(visitorA._id, me._id);

  await sendDailySuggestions(null, { force: true });

  const mine = await Notification.findOne({ userId: me._id, type: 'suggestion' }).lean();
  assert.ok(mine, 'no digest was sent for profile visits');
  assert.equal(mine.title, '2 people viewed your profile');
});

test('someone with nothing waiting is left alone', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();

  // A lone user: no likes, no visits, and nobody new nearby.
  const me = await makeUser({ createdAt: new Date(Date.now() - 60 * 24 * 3600 * 1000) });
  await sendDailySuggestions(null, { force: true });

  const count = await Notification.countDocuments({ userId: me._id, type: 'suggestion' });
  assert.equal(count, 0, 'sent an empty "come back" nudge');
});

test('new people nearby are worth a digest on their own', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();

  const me = await makeUser({ discoveryPrefs: { radiusKm: 50, gender: '', activeWithinMinutes: 0 } });
  await makeUser({ gender: 'Man' });
  await makeUser({ gender: 'Man' });

  await sendDailySuggestions(null, { force: true });

  const mine = await Notification.findOne({ userId: me._id, type: 'suggestion' }).lean();
  assert.ok(mine, 'nobody was told about the new joiners');
  assert.match(mine.title, /joined near you$/);
  assert.equal(mine.deepLink, '/(tabs)');
});

test('users who muted the category are skipped entirely', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();

  const muted = await makeUser({ notificationPrefs: { promotions: false } });
  await likedBy(muted, await makeUser());

  await sendDailySuggestions(null, { force: true });

  const count = await Notification.countDocuments({ userId: muted._id, type: 'suggestion' });
  assert.equal(count, 0, 'a muted user was still sent a digest');
});

test('dormant and deactivated accounts are never woken up', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();

  const dormant = await makeUser({
    lastSeen: new Date(Date.now() - 200 * 24 * 3600 * 1000),
  });
  const deactivated = await makeUser({ isDeactivated: true });
  const deleting = await makeUser({ deletionScheduledAt: new Date() });
  const liker = await makeUser();
  await Promise.all([likedBy(dormant, liker), likedBy(deactivated, liker), likedBy(deleting, liker)]);

  await sendDailySuggestions(null, { force: true });

  for (const [label, user] of [
    ['dormant', dormant],
    ['deactivated', deactivated],
    ['deleting', deleting],
  ]) {
    const count = await Notification.countDocuments({ userId: user._id, type: 'suggestion' });
    assert.equal(count, 0, `${label} account was sent a digest`);
  }
});

test('a like the user sent does not come back to them as news', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();

  const me = await makeUser({ createdAt: new Date(Date.now() - 60 * 24 * 3600 * 1000) });
  const them = await makeUser({ createdAt: new Date(Date.now() - 60 * 24 * 3600 * 1000) });
  await likedBy(them, me); // me → them

  await sendDailySuggestions(null, { force: true });

  const mineCount = await Notification.countDocuments({ userId: me._id, type: 'suggestion' });
  const theirs = await Notification.findOne({ userId: them._id, type: 'suggestion' }).lean();
  assert.equal(mineCount, 0, 'the sender was told about their own like');
  assert.equal(theirs?.title, '1 person liked you');
});
