const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePaidPackFromOrder } = require('../utils/paidPackFromOrder');

const TOKEN_PACKS = {
  '10': { tokens: 10 },
  '100000': { tokens: 100000 },
};

const getPackPriceInr = (packId) => (packId === '10' ? 4 : 999);

test('credits pack from order notes, ignores larger client packId', () => {
  const order = {
    amount: 400,
    notes: {
      userId: 'u1',
      packId: '10',
      tokens: '10',
      priceInr: '4',
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
    amount: 400,
    notes: {
      userId: 'u1',
      packId: '10',
      tokens: '10',
      priceInr: '4',
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
    amount: 400,
    notes: {
      packId: '100000',
      tokens: '100000',
      priceInr: '999',
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
