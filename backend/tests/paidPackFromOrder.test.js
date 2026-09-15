const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePaidPackFromOrder } = require('../utils/paidPackFromOrder');

const TOKEN_PACKS = {
  '10': { tokens: 10, price: 10 },
  '100000': { tokens: 100000, price: 15000 },
};

const getPackPriceInr = (packId) => TOKEN_PACKS[packId]?.price ?? null;

test('rejects larger client packId than paid order notes', () => {
  const order = {
    amount: 1000,
    notes: {
      userId: 'u1',
      packId: '10',
      tokens: '10',
      priceInr: '10',
    },
  };

  const resolved = resolvePaidPackFromOrder({
    order,
    clientPackId: '100000',
    TOKEN_PACKS,
    getPackPriceInr,
    user: {},
  });

  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, 'PACK_MISMATCH');
});

test('credits tokens from order notes packId when client omitted', () => {
  const order = {
    amount: 1000,
    notes: {
      userId: 'u1',
      packId: '10',
      tokens: '10',
      priceInr: '10',
    },
  };

  const resolved = resolvePaidPackFromOrder({
    order,
    clientPackId: undefined,
    TOKEN_PACKS,
    getPackPriceInr,
    user: {},
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.packId, '10');
  assert.equal(resolved.credited, 10);
});

test('rejects amount that does not match noted price', () => {
  const order = {
    amount: 1000,
    notes: {
      packId: '100000',
      tokens: '100000',
      priceInr: '15000',
    },
  };

  const resolved = resolvePaidPackFromOrder({
    order,
    clientPackId: '100000',
    TOKEN_PACKS,
    getPackPriceInr,
    user: {},
  });

  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, 'AMOUNT_MISMATCH');
});
