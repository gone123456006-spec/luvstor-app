/**
 * Scale + correctness smoke tests (no Mongo required for pure helpers).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { applyOpenStreak } = require('../services/retention');
const { interestOverlap, scoreCandidate, MAX_POOL, MAX_RANKED } = require('../services/forYou');
const { canonicalShowMe } = require('../utils/showMe');
const { toGenderFilter, resolveShowMe } = require('../utils/showMe');

test('forYou pool/rank caps stay bounded for million-user scale', () => {
  assert.ok(MAX_POOL <= 500);
  assert.ok(MAX_RANKED <= MAX_POOL);
});

test('open streak starts at 1 on first open', () => {
  const user = { openStreakDays: 0, lastOpenDate: null };
  const now = new Date('2026-03-10T12:00:00.000Z');
  const result = applyOpenStreak(user, now);
  assert.equal(result.openStreakDays, 1);
  assert.equal(result.alreadyCountedToday, false);
});

test('open streak is idempotent within the same UTC day', () => {
  const user = { openStreakDays: 3, lastOpenDate: '2026-03-10' };
  const now = new Date('2026-03-10T18:00:00.000Z');
  const result = applyOpenStreak(user, now);
  assert.equal(result.openStreakDays, 3);
  assert.equal(result.alreadyCountedToday, true);
});

test('open streak continues across consecutive days', () => {
  const user = { openStreakDays: 3, lastOpenDate: '2026-03-09' };
  const now = new Date('2026-03-10T12:00:00.000Z');
  const result = applyOpenStreak(user, now);
  assert.equal(result.openStreakDays, 4);
  assert.equal(result.streakContinued, true);
});

test('interest overlap counts shared tags', () => {
  assert.equal(interestOverlap(['music', 'travel'], ['Travel', 'food']), 1);
});

test('scoreCandidate rewards verified + online + mutual showMe', () => {
  const viewer = { interests: ['music', 'gym'], gender: 'Man' };
  const candidate = {
    interests: ['music', 'art'],
    isOnline: true,
    photoVerification: { status: 'approved' },
    photo: '/uploads/x.jpg',
    createdAt: new Date(),
    showMe: 'All',
  };
  const { score, reasons } = scoreCandidate(viewer, candidate, 3000);
  assert.ok(score > 40);
  assert.ok(reasons.length >= 1);

  // Gender filter compare must be case-normalized
  const theirFilter = toGenderFilter(resolveShowMe({ showMe: 'Man', gender: 'Woman' }));
  const myGender = (canonicalShowMe(viewer.gender) || '').toLowerCase();
  assert.equal(theirFilter, 'man');
  assert.equal(myGender, 'man');
});

test('modules load without crashing', () => {
  assert.ok(require('../routes/support'));
  assert.ok(require('../routes/adminModeration'));
  assert.ok(require('../routes/verification'));
  assert.ok(require('../routes/recommendations'));
  assert.ok(require('../routes/retention'));
  assert.ok(require('../utils/scaleHelpers'));
});
