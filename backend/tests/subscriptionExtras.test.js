/**
 * Subscription extras that must apply only while a paid plan is live.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyTokenBonus,
  getTokenBonusPercent,
  getPlanEntitlements,
} = require('../services/subscriptions');

const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const past = new Date(Date.now() - 60 * 1000);

function user(plan, expiresAt) {
  return {
    subscriptionPlan: plan,
    subscriptionExpiresAt: expiresAt,
    subscriptionSpinsUsedToday: 0,
    subscriptionSpinsDate: null,
    spinWindowStartedAt: null,
    spinTokensWonToday: 0,
  };
}

test('token pack bonus: Gold +10% only while active', () => {
  assert.deepEqual(applyTokenBonus(100, user('gold', future)), {
    baseTokens: 100,
    bonusTokens: 10,
    totalTokens: 110,
  });
  assert.equal(getTokenBonusPercent(user('gold', past)), 0);
  assert.deepEqual(applyTokenBonus(100, user('gold', past)), {
    baseTokens: 100,
    bonusTokens: 0,
    totalTokens: 100,
  });
});

test('token pack bonus: Platinum +25% and Black +40% while active', () => {
  assert.deepEqual(applyTokenBonus(100, user('platinum', future)), {
    baseTokens: 100,
    bonusTokens: 25,
    totalTokens: 125,
  });
  assert.deepEqual(applyTokenBonus(100, user('black', future)), {
    baseTokens: 100,
    bonusTokens: 40,
    totalTokens: 140,
  });
});

test('token pack bonus: Free and Explore Plus never get a pack bonus', () => {
  assert.deepEqual(applyTokenBonus(100, user('free', future)), {
    baseTokens: 100,
    bonusTokens: 0,
    totalTokens: 100,
  });
  assert.deepEqual(applyTokenBonus(100, user('explore', future)), {
    baseTokens: 100,
    bonusTokens: 0,
    totalTokens: 100,
  });
  assert.deepEqual(applyTokenBonus(100, user('black', null)), {
    baseTokens: 100,
    bonusTokens: 0,
    totalTokens: 100,
  });
});

test('discoverBoost and profile views stay off after expiry', () => {
  const livePlat = getPlanEntitlements(user('platinum', future));
  assert.equal(livePlat.discoverBoost, true);
  assert.equal(livePlat.profileViews, true);
  assert.equal(livePlat.tokenBonusPercent, 25);

  const expired = getPlanEntitlements(user('platinum', past));
  assert.equal(expired.plan, 'free');
  assert.equal(expired.discoverBoost, false);
  assert.equal(expired.profileViews, false);
  assert.equal(expired.tokenBonusPercent, 0);

  const gold = getPlanEntitlements(user('gold', future));
  assert.equal(gold.discoverBoost, false);
  assert.equal(gold.tokenBonusPercent, 10);
});
