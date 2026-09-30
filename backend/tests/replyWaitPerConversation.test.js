/**
 * The 10-message "wait for a reply" limit is per conversation: hitting it with
 * one person must not stop you from chatting with anyone else.
 * Uses its own scratch database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

try {
  require('dotenv').config();
} catch {
  /* dotenv is optional here */
}

const TEST_DB_NAME = 'luvstor_reply_wait_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error(`Refusing to run: cannot rewrite "${uri}" to ${TEST_DB_NAME}.`);
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);

let available = false;
let User;
let chat;

let seq = 0;
async function makeUser() {
  seq += 1;
  return User.create({
    email: `wait-${seq}-${Date.now()}@test.local`,
    name: `Wait ${seq}`,
    isVerified: true,
    publicId: `WAIT${String(1000 + seq)}`,
  });
}

async function sendMany(from, to, n) {
  for (let i = 0; i < n; i += 1) {
    await chat.incrementMessageCount(String(from._id), String(to._id));
  }
}

test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db.dropDatabase();
    available = true;
  } catch {
    available = false;
    return;
  }
  User = require('../models/User');
  chat = require('../services/chatTokens');
});

test.after(async () => {
  if (available) {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});

test('waiting on one chat only blocks that chat', async (t) => {
  if (!available) return t.skip('MongoDB not reachable');
  const me = await makeUser();
  const a = await makeUser();
  const b = await makeUser();

  await sendMany(me, a, chat.MAX_CONSECUTIVE_MESSAGES);

  const toA = await chat.canSendMessage(String(me._id), String(a._id), 'text');
  assert.equal(toA.ok, false);
  assert.equal(toA.code, 'WAITING_FOR_REPLY');

  const toB = await chat.canSendMessage(String(me._id), String(b._id), 'text');
  assert.equal(toB.ok, true, 'a brand-new chat with someone else must stay open');

  const restrictions = await chat.getConversationRestrictions(String(me._id));
  assert.equal(restrictions.canStartNewConversations, true);
});

test('their reply reopens the chat', async (t) => {
  if (!available) return t.skip('MongoDB not reachable');
  const me = await makeUser();
  const a = await makeUser();

  await sendMany(me, a, chat.MAX_CONSECUTIVE_MESSAGES);
  assert.equal((await chat.canSendMessage(String(me._id), String(a._id))).ok, false);

  await chat.resetMessageCount(String(a._id), String(me._id));
  assert.equal((await chat.canSendMessage(String(me._id), String(a._id))).ok, true);
});
