const test = require('node:test');
const assert = require('node:assert/strict');

const exploreMatchmaking = require('../services/exploreMatchmaking');

const USER_A = '6a3cba48c1a112e027dac39d';
const USER_B = '6a3cbde8c1a112e027dac3a0';
const USER_C = '6a3cbde8c1a112e027dac3a1';

test('video and voice queues are fully independent', () => {
  exploreMatchmaking.leaveQueue(USER_A);
  exploreMatchmaking.leaveQueue(USER_B);
  exploreMatchmaking.leaveQueue(USER_C);

  exploreMatchmaking.joinQueue(USER_A, 'video');
  exploreMatchmaking.joinQueue(USER_B, 'voice');
  exploreMatchmaking.joinQueue(USER_C, 'video');

  assert.equal(exploreMatchmaking.isInQueue(USER_A, 'video'), true);
  assert.equal(exploreMatchmaking.isInQueue(USER_A, 'voice'), false);
  assert.equal(exploreMatchmaking.isInQueue(USER_B, 'voice'), true);
  assert.equal(exploreMatchmaking.isInQueue(USER_B, 'video'), false);
  assert.equal(exploreMatchmaking.queueSize('video'), 2);
  assert.equal(exploreMatchmaking.queueSize('voice'), 1);

  exploreMatchmaking.leaveQueue(USER_A, 'video');
  assert.equal(exploreMatchmaking.isInQueue(USER_A), false);
  assert.equal(exploreMatchmaking.isInQueue(USER_B, 'voice'), true);
  assert.equal(exploreMatchmaking.queueSize('video'), 1);

  exploreMatchmaking.leaveQueue(USER_B);
  exploreMatchmaking.leaveQueue(USER_C);
});

test('joining video removes prior voice search for same user', () => {
  exploreMatchmaking.leaveQueue(USER_A);
  exploreMatchmaking.joinQueue(USER_A, 'voice');
  assert.equal(exploreMatchmaking.isInQueue(USER_A, 'voice'), true);
  exploreMatchmaking.joinQueue(USER_A, 'video');
  assert.equal(exploreMatchmaking.isInQueue(USER_A, 'video'), true);
  assert.equal(exploreMatchmaking.isInQueue(USER_A, 'voice'), false);
  exploreMatchmaking.leaveQueue(USER_A);
});

test('prefsCompatible respects showMe and verifiedOnly', () => {
  const manAll = {
    gender: 'Man',
    showMe: 'All',
    verifiedOnly: false,
    photoVerified: false,
  };
  const womanWantsMen = {
    gender: 'Woman',
    showMe: 'Man',
    verifiedOnly: false,
    photoVerified: true,
  };
  const womanWantsWomen = {
    gender: 'Woman',
    showMe: 'Woman',
    verifiedOnly: false,
    photoVerified: false,
  };
  const verifiedOnlyUser = {
    gender: 'Man',
    showMe: 'Woman',
    verifiedOnly: true,
    photoVerified: true,
  };
  const unverifiedWoman = {
    gender: 'Woman',
    showMe: 'Man',
    verifiedOnly: false,
    photoVerified: false,
  };

  assert.equal(exploreMatchmaking.prefsCompatible(manAll, womanWantsMen), true);
  assert.equal(
    exploreMatchmaking.prefsCompatible(manAll, womanWantsWomen),
    false,
  );
  assert.equal(
    exploreMatchmaking.prefsCompatible(verifiedOnlyUser, unverifiedWoman),
    false,
  );
  assert.equal(
    exploreMatchmaking.prefsCompatible(verifiedOnlyUser, {
      ...unverifiedWoman,
      photoVerified: true,
    }),
    true,
  );
});
