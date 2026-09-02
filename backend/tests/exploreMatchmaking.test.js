const test = require('node:test');
const assert = require('node:assert/strict');

const exploreMatchmaking = require('../services/exploreMatchmaking');

const USER_A = '6a3cba48c1a112e027dac39d';
const USER_B = '6a3cbde8c1a112e027dac3a0';

test('joinQueue keeps video and voice queues separate', () => {
  exploreMatchmaking.leaveQueue(USER_A);
  exploreMatchmaking.leaveQueue(USER_B);

  exploreMatchmaking.joinQueue(USER_A, 'video');
  exploreMatchmaking.joinQueue(USER_B, 'voice');

  assert.equal(exploreMatchmaking.isInQueue(USER_A), true);
  assert.equal(exploreMatchmaking.isInQueue(USER_B), true);

  exploreMatchmaking.leaveQueue(USER_A);
  exploreMatchmaking.leaveQueue(USER_B);
  assert.equal(exploreMatchmaking.isInQueue(USER_A), false);
  assert.equal(exploreMatchmaking.isInQueue(USER_B), false);
});

test('joinQueue replaces prior entry when mode changes', () => {
  exploreMatchmaking.leaveQueue(USER_A);
  exploreMatchmaking.joinQueue(USER_A, 'voice');
  exploreMatchmaking.joinQueue(USER_A, 'video');
  assert.equal(exploreMatchmaking.isInQueue(USER_A), true);
  exploreMatchmaking.leaveQueue(USER_A);
});
