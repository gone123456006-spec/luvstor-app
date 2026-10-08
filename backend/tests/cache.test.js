/**
 * @file utils/cache (memory fallback) + cacheVersionPlugin filter parsing,
 * plus a live write → version bump check when a test Mongo is reachable.
 */
delete process.env.REDIS_URL;
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const cache = require('../utils/cache');
const { _internals } = require('../utils/cacheVersionPlugin');

try {
  require('dotenv').config();
} catch {
  /* optional */
}

test('getOrSet caches, coalesces concurrent misses, returns JSON copies', async () => {
  cache._resetMemory();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return { n: 1, when: new Date(0), id: new mongoose.Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa') };
  };
  const [a, b] = await Promise.all([cache.getOrSet('k', 30, loader), cache.getOrSet('k', 30, loader)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  assert.equal(a.when, '1970-01-01T00:00:00.000Z');
  assert.equal(a.id, 'aaaaaaaaaaaaaaaaaaaaaaaa');

  a.n = 99;
  const c = await cache.getOrSet('k', 30, loader);
  assert.equal(c.n, 1);
  assert.equal(calls, 1);
});

test('version bump makes old keys unreachable', async () => {
  cache._resetMemory();
  const v0 = await cache.version('msg', 'u1');
  await cache.bump('msg', ['u1', 'u2']);
  assert.equal(await cache.version('msg', 'u1'), v0 + 1);
  assert.equal(await cache.version('msg', 'u2'), 1);
  assert.equal(await cache.version('msg', 'u3'), 0);
});

test('loader errors are not cached', async () => {
  cache._resetMemory();
  await assert.rejects(cache.getOrSet('e', 30, async () => { throw new Error('boom'); }));
  assert.equal(await cache.getOrSet('e', 30, async () => 5), 5);
});

test('plugin extracts users from filters', () => {
  const { usersFromFilter, changedCount } = _internals;
  const a = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const b = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  assert.deepEqual(usersFromFilter({ receiverId: new mongoose.Types.ObjectId(a) }, ['senderId', 'receiverId']), [a]);
  assert.deepEqual(usersFromFilter({ roomId: `${a}_${b}` }, ['senderId'], 'roomId'), [a, b]);
  assert.deepEqual(usersFromFilter({ userId: { $in: [a, b] } }, ['userId']), [a, b]);
  assert.deepEqual(usersFromFilter({ senderId: { $nin: [a] } }, ['senderId']), []);
  assert.deepEqual(usersFromFilter({ $or: [{ userA: a }, { userB: b }] }, ['userA', 'userB']), [a, b]);
  assert.equal(changedCount('updateMany', { modifiedCount: 0 }), 0);
  assert.equal(changedCount('deleteMany', { deletedCount: 2 }), 2);
  assert.equal(changedCount('findOneAndUpdate', null), 1);
  assert.equal(changedCount('findOneAndDelete', null), 0);
});

const TEST_DB = 'luvstor_cache_test';
function testUri() {
  const uri = process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const m = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  return m ? `${m[1]}/${TEST_DB}${m[2] || ''}` : null;
}

test('Message / Notification writes bump user versions', async (t) => {
  const uri = testUri();
  try {
    if (!uri) throw new Error('no uri');
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
  } catch {
    t.skip('Mongo not reachable');
    return;
  }
  try {
    if (mongoose.connection.name !== TEST_DB) throw new Error('refusing: wrong db');
    cache._resetMemory();
    const Message = require('../models/Message');
    const Notification = require('../models/Notification');
    const s = new mongoose.Types.ObjectId();
    const r = new mongoose.Types.ObjectId();
    const room = [String(s), String(r)].sort().join('_');

    const msg = await Message.create({ roomId: room, senderId: s, receiverId: r, text: 'hi' });
    assert.equal(await cache.version('msg', String(r)), 1);
    assert.equal(await cache.version('msg', String(s)), 1);

    await Message.updateMany({ _id: { $in: [msg._id] } }, { $set: { read: true } });
    assert.equal(await cache.version('msg', String(r)), 2);

    await Notification.create({ userId: r, type: 'system', title: 't', body: 'b' });
    assert.equal(await cache.version('notif', String(r)), 1);
    await Notification.updateMany({ userId: r, read: false }, { $set: { read: true } });
    assert.equal(await cache.version('notif', String(r)), 2);

    // Notification list fires this on every open — must not churn the cache
    await Notification.deleteMany({ userId: r, type: { $in: ['chat'] } });
    assert.equal(await cache.version('notif', String(r)), 2, 'no-op delete must not bump');

    const ConversationState = require('../models/ConversationState');
    await ConversationState.findOneAndUpdate(
      { userId: r, otherUserId: s },
      { $set: { archived: true } },
      { upsert: true },
    );
    assert.equal(await cache.version('msg', String(r)), 3, 'archive bumps chat version');
    await ConversationState.updateOne({ userId: r, otherUserId: s }, { $set: { muted: true } });
    assert.equal(await cache.version('msg', String(r)), 3, 'mute does not');
    await ConversationState.deleteMany({ userId: r });

    await Message.deleteMany({ roomId: room });
    await Notification.deleteMany({ userId: r });
  } finally {
    await mongoose.disconnect();
  }
});
