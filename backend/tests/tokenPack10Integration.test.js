/**
 * Integration: pack-10 purchase count advances price ₹4 → ₹7 → ₹9.
 * Throwaway DB only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

try {
  require('dotenv').config();
} catch {
  /* optional */
}

const TEST_DB_NAME = 'luvstor_pack10_price_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error(`Bad URI: ${uri}`);
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);

let available = false;
let User;
let getPackPriceInr;
let serializePacksForUser;
let PACK_10_ID;

test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 8000 });
    available = true;
  } catch (err) {
    console.warn(`[pack10] skipped — ${err.message}`);
    return;
  }
  if (mongoose.connection.name !== TEST_DB_NAME) {
    throw new Error(`Refusing DB ${mongoose.connection.name}`);
  }
  User = require('../models/User');
  ({
    getPackPriceInr,
    serializePacksForUser,
    PACK_10_ID,
  } = require('../services/tokenPacks'));
  await mongoose.connection.dropDatabase();
  await User.init();
});

test.after(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('new user sees ₹4 for 10 tokens', async (t) => {
  if (!available) return t.skip('no MongoDB');
  const user = await User.create({
    email: 'pack10-a@test.local',
    name: 'A',
    tokenBalance: 0,
    tokenPack10PurchaseCount: 0,
  });
  assert.equal(getPackPriceInr(PACK_10_ID, user), 4);
  const packs = serializePacksForUser(user);
  const p10 = packs.find((p) => p.id === '10');
  assert.equal(p10.priceInr, 4);
  assert.equal(p10.listPriceInr, 10);
  assert.equal(p10.isOffer, true);
});

test('after 1 purchase price becomes ₹7; after 2 stays ₹9', async (t) => {
  if (!available) return t.skip('no MongoDB');

  const user = await User.create({
    email: 'pack10-b@test.local',
    name: 'B',
    tokenBalance: 0,
    tokenPack10PurchaseCount: 0,
  });

  // Simulate verify crediting pack 10 (first buy)
  let updated = await User.findByIdAndUpdate(
    user._id,
    { $inc: { tokenBalance: 10, tokenPack10PurchaseCount: 1 } },
    { returnDocument: 'after' },
  );
  assert.equal(updated.tokenPack10PurchaseCount, 1);
  assert.equal(getPackPriceInr('10', updated), 7);

  // Second buy
  updated = await User.findByIdAndUpdate(
    user._id,
    { $inc: { tokenBalance: 10, tokenPack10PurchaseCount: 1 } },
    { returnDocument: 'after' },
  );
  assert.equal(updated.tokenPack10PurchaseCount, 2);
  assert.equal(getPackPriceInr('10', updated), 9);

  // Third buy — still ₹9
  updated = await User.findByIdAndUpdate(
    user._id,
    { $inc: { tokenBalance: 10, tokenPack10PurchaseCount: 1 } },
    { returnDocument: 'after' },
  );
  assert.equal(updated.tokenPack10PurchaseCount, 3);
  assert.equal(getPackPriceInr('10', updated), 9);
  assert.equal(updated.tokenBalance, 30);
});

test('other packs never use ladder', async (t) => {
  if (!available) return t.skip('no MongoDB');
  const user = { tokenPack10PurchaseCount: 0 };
  assert.equal(getPackPriceInr('100', user), 80);
  assert.equal(getPackPriceInr('1000', user), 600);
});
