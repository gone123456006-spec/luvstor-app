const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalShowMe,
  oppositeShowMe,
  resolveShowMe,
  followGenderChange,
  toGenderFilter,
} = require('../utils/showMe');

test('canonicalShowMe normalises aliases', () => {
  assert.equal(canonicalShowMe('female'), 'Woman');
  assert.equal(canonicalShowMe('Men'), 'Man');
  assert.equal(canonicalShowMe('everyone'), 'All');
  assert.equal(canonicalShowMe(''), '');
});

test('oppositeShowMe maps man/woman and falls back to All', () => {
  assert.equal(oppositeShowMe('Woman'), 'Man');
  assert.equal(oppositeShowMe('Man'), 'Woman');
  assert.equal(oppositeShowMe('Other'), 'All');
  assert.equal(oppositeShowMe(''), 'All');
});

test('resolveShowMe defaults to the opposite of the viewer gender', () => {
  assert.equal(resolveShowMe({ gender: 'Woman' }), 'Man');
  assert.equal(resolveShowMe({ gender: 'Man' }), 'Woman');
  assert.equal(resolveShowMe({ gender: 'Woman', showMe: 'All' }), 'All');
  assert.equal(resolveShowMe({ gender: 'Woman', showMe: '' }, 'Man'), 'Man');
});

test('followGenderChange keeps an explicit Everyone choice', () => {
  assert.equal(followGenderChange('Woman', 'All', 'Man'), 'All');
  assert.equal(followGenderChange('Woman', '', 'Man'), 'Woman');
  assert.equal(followGenderChange('Woman', 'Man', 'Man'), 'Woman');
});

test('toGenderFilter omits All so Nearby can show everyone', () => {
  assert.equal(toGenderFilter('All'), 'all');
  assert.equal(toGenderFilter('Woman'), 'woman');
  assert.equal(toGenderFilter(''), 'all');
});
