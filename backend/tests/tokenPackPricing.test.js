/**
 * Unit tests for pack-10 progressive pricing: ₹4 → ₹7 → ₹9.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPack10PriceInr,
  getPackPriceInr,
  serializePacksForUser,
} = require('../services/tokenPacks');

test('pack 10 ladder: 4 then 7 then 9 forever', () => {
  assert.equal(getPack10PriceInr(0), 4);
  assert.equal(getPack10PriceInr(1), 7);
  assert.equal(getPack10PriceInr(2), 9);
  assert.equal(getPack10PriceInr(99), 9);
});

test('only pack 10 uses ladder; others keep list price', () => {
  const user0 = { tokenPack10PurchaseCount: 0 };
  assert.equal(getPackPriceInr('10', user0), 4);
  assert.equal(getPackPriceInr('100', user0), 80);
  assert.equal(getPackPriceInr('1000', user0), 600);

  const user1 = { tokenPack10PurchaseCount: 1 };
  assert.equal(getPackPriceInr('10', user1), 7);

  const user2 = { tokenPack10PurchaseCount: 2 };
  assert.equal(getPackPriceInr('10', user2), 9);
});

test('serialize packs marks offer for new user', () => {
  const packs = serializePacksForUser({ tokenPack10PurchaseCount: 0 });
  const p10 = packs.find((p) => p.id === '10');
  assert.ok(p10);
  assert.equal(p10.priceInr, 4);
  assert.equal(p10.listPriceInr, 10);
  assert.equal(p10.isOffer, true);
});
