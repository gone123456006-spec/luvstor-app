const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isQuietHours,
  MAX_PER_WEEK,
  MIN_GAP_HOURS,
} = require('../services/autoNotificationPolicy');

test('auto notifications are capped at a few per week, well spaced', () => {
  assert.ok(MAX_PER_WEEK <= 3, `cap is ${MAX_PER_WEEK}/week`);
  assert.ok(MIN_GAP_HOURS >= 24, `gap is only ${MIN_GAP_HOURS}h`);
});

test('quiet hours block 11 hours a day (22:00–09:00 local)', () => {
  const start = new Date(Date.UTC(2025, 2, 3, 0, 0, 0));
  let quiet = 0;
  for (let h = 0; h < 24; h += 1) {
    if (isQuietHours(new Date(start.getTime() + h * 60 * 60 * 1000))) quiet += 1;
  }
  assert.equal(quiet, 11);
});
