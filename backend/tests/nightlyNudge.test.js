/**
 * Nightly 10 PM chat nudge.
 *
 * Copy and scheduling are pure; delivery runs against a throwaway MongoDB
 * database and is skipped when none is reachable.
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
  composeNudge,
  dayMessage,
  nudgeDayKey,
  isSendWindow,
  DAY_MESSAGES,
  SEND_HOUR,
} = require('../jobs/nightlyNudge');

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Copy ──────────────────────────────────────────────────────────────────

test('every weekday has its own set of messages', () => {
  assert.equal(DAY_MESSAGES.length, 7);
  const titles = DAY_MESSAGES.flat().map((m) => m.title);
  assert.equal(new Set(titles).size, titles.length, 'two days share a message');
  for (const day of DAY_MESSAGES) {
    assert.ok(day.length >= 2);
    for (const m of day) {
      assert.ok(m.title && m.body);
      assert.ok(m.title.length <= 60, `title too long for the tray: ${m.title}`);
    }
  }
});

test('consecutive days get different messages', () => {
  const start = new Date('2026-10-12T16:30:00Z');
  const seen = new Set();
  for (let d = 0; d < 7; d += 1) {
    seen.add(dayMessage(new Date(start.getTime() + d * DAY_MS)).title);
  }
  assert.equal(seen.size, 7);
});

test('the same weekday rotates to a new line the next week', () => {
  const thisWeek = new Date('2026-10-16T16:30:00Z');
  const nextWeek = new Date(thisWeek.getTime() + 7 * DAY_MS);
  assert.notEqual(dayMessage(thisWeek).title, dayMessage(nextWeek).title);
});

test('one unread chat names the person waiting, WhatsApp-style', () => {
  const msg = composeNudge({ chats: 1, messages: 3, senderName: 'Priya' });
  assert.equal(msg.title, 'Priya is waiting for your reply 💬');
  assert.match(msg.body, /3 unread messages/);
  assert.equal(msg.deepLink, '/(tabs)/chat');
});

test('several unread chats are summarised', () => {
  const msg = composeNudge({ chats: 2, messages: 5 });
  assert.equal(msg.title, '2 people are waiting for your reply 💬');
  assert.match(msg.body, /5 unread messages/);
});

test('no unread chats falls back to the day message', () => {
  const now = new Date('2026-10-16T16:30:00Z');
  const msg = composeNudge(null, now);
  assert.equal(msg.title, dayMessage(now).title);
  assert.equal(msg.deepLink, '/(tabs)');
});

// ── Scheduling ────────────────────────────────────────────────────────────

test('only the configured hour is a send window', () => {
  let hits = 0;
  const midnight = new Date('2026-10-14T00:00:00Z');
  for (let h = 0; h < 24; h += 1) {
    if (isSendWindow(new Date(midnight.getTime() + h * 3600 * 1000))) hits += 1;
  }
  assert.equal(hits, 1);
  assert.equal(SEND_HOUR, Number(process.env.NIGHTLY_NUDGE_HOUR || 22));
});

test('the day key is stable across the send hour', () => {
  const a = new Date('2026-10-14T16:31:00Z');
  const b = new Date('2026-10-14T16:55:00Z');
  assert.equal(nudgeDayKey(a), nudgeDayKey(b));
});

// ── Delivery (requires MongoDB) ───────────────────────────────────────────

const TEST_DB_NAME = 'luvstor_nightly_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) {
    throw new Error(`Refusing to run: could not rewrite "${uri}" to ${TEST_DB_NAME}.`);
  }
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);

let available = false;
let User;
let Message;
let Notification;
let sendNightlyNudges;

test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (err) {
    console.warn(`[nightlyNudge] skipped — no MongoDB at ${TEST_URI}: ${err.message}`);
    return;
  }
  User = require('../models/User');
  Message = require('../models/Message');
  Notification = require('../models/Notification');
  ({ sendNightlyNudges } = require('../jobs/nightlyNudge'));

  if (mongoose.connection.name !== TEST_DB_NAME) {
    throw new Error(`Refusing to drop database "${mongoose.connection.name}".`);
  }
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Message.init(), Notification.init()]);
});

test.after(async () => {
  if (!available) return;
  if (mongoose.connection.name === TEST_DB_NAME) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
async function makeUser(overrides = {}) {
  seq += 1;
  return User.create({
    email: `nightly-${Date.now()}-${seq}@test.local`,
    name: `Nightly ${seq}`,
    age: 25,
    gender: 'Woman',
    isVerified: true,
    lastSeen: new Date(Date.now() - 2 * 3600 * 1000),
    ...overrides,
  });
}

async function reset() {
  await Promise.all([User.deleteMany({}), Message.deleteMany({}), Notification.deleteMany({})]);
}

function sendMessage(from, to, extra = {}) {
  const roomId = [String(from._id), String(to._id)].sort().join('_');
  return Message.create({ roomId, senderId: from._id, receiverId: to._id, text: 'hey', ...extra });
}

test('each user gets exactly one nudge a night, even if the job runs twice', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();
  const me = await makeUser();

  const now = new Date();
  await sendNightlyNudges(null, { now, force: true });
  const second = await sendNightlyNudges(null, { now, force: true });

  const count = await Notification.countDocuments({ userId: me._id, 'data.code': 'NIGHTLY_NUDGE' });
  assert.equal(count, 1);
  assert.equal(second.created, 0, 'the nightly dedupe key did not hold');
});

test('a user with an unread chat is told who is waiting', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();
  const me = await makeUser();
  const priya = await makeUser({ name: 'Priya Sharma' });
  await sendMessage(priya, me);
  await sendMessage(priya, me);
  await sendMessage(priya, me, { read: true });

  await sendNightlyNudges(null, { force: true });

  const mine = await Notification.findOne({ userId: me._id, 'data.code': 'NIGHTLY_NUDGE' }).lean();
  assert.equal(mine.title, 'Priya is waiting for your reply 💬');
  assert.match(mine.body, /2 unread messages/);
});

test('messages deleted for the user do not count as waiting', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();
  const me = await makeUser();
  const other = await makeUser();
  await sendMessage(other, me, { deletedFor: [me._id] });
  await sendMessage(other, me, { isDeleted: true });

  await sendNightlyNudges(null, { force: true });

  const mine = await Notification.findOne({ userId: me._id, 'data.code': 'NIGHTLY_NUDGE' }).lean();
  assert.equal(mine.data.unread, '0');
  assert.doesNotMatch(mine.title, /waiting for your reply/);
});

test('muted, online, dormant and deactivated users are skipped', async (t) => {
  if (!available) return t.skip('MongoDB not available');
  await reset();
  const muted = await makeUser({ notificationPrefs: { promotions: false } });
  const online = await makeUser({ lastSeen: new Date() });
  const dormant = await makeUser({ lastSeen: new Date(Date.now() - 90 * DAY_MS) });
  const deactivated = await makeUser({ isDeactivated: true });

  await sendNightlyNudges(null, { force: true });

  for (const [label, user] of [
    ['muted', muted],
    ['online', online],
    ['dormant', dormant],
    ['deactivated', deactivated],
  ]) {
    const count = await Notification.countDocuments({ userId: user._id, 'data.code': 'NIGHTLY_NUDGE' });
    assert.equal(count, 0, `${label} user was nudged`);
  }
});
