const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/unused';
process.env.ADMIN_JWT_SECRET ||= 'x'.repeat(48);
process.env.MAIN_API_URL ||= 'http://127.0.0.1:1';
process.env.MAIN_ADMIN_API_KEY ||= 'test-key';

const { can, permissionsFor, PERMISSIONS } = require('../lib/permissions');
const { segmentFilter, audienceQuery, segmentList } = require('../lib/segments');
const { passwordProblem } = require('../lib/passwords');
const { fillDaySeries, escapeRegex, pageParams } = require('../lib/http');
const { accountStatus, activePlan } = require('../lib/users');
const { buildSearchFilter } = require('../routes/users');

test('only owners manage admins; analysts cannot act on users', () => {
  assert.equal(can('owner', 'admins.manage'), true);
  assert.equal(can('admin', 'admins.manage'), false);
  assert.equal(can('analyst', 'users.view'), false);
  assert.equal(can('analyst', 'money.view'), true);
  assert.equal(can('support', 'users.ban'), false);
  assert.equal(can('support', 'users.logout'), true);
  assert.equal(can('moderator', 'users.tokens'), false);
  assert.equal(can('nobody', 'overview.view'), false);
  assert.deepEqual(permissionsFor('owner').sort(), Object.keys(PERMISSIONS).sort());
});

test('segments build relative filters and count queries exclude deactivated users', () => {
  const now = Date.UTC(2026, 0, 31);
  const f = segmentFilter('inactive7d', now);
  assert.equal(typeof f.lastSeen.$lt, 'string');
  const q = audienceQuery('inactive7d', now);
  assert.deepEqual(q.isDeactivated, { $ne: true });
  assert.ok(q.lastSeen.$lt instanceof Date);
  assert.equal(segmentFilter('nope'), null);
  assert.equal(audienceQuery('nope'), null);
  assert.ok(segmentList().some((s) => s.key === 'all'));
  assert.ok(audienceQuery('free', now).$or[2].subscriptionExpiresAt.$lte instanceof Date);
});

test('password policy', () => {
  assert.ok(passwordProblem('short'));
  assert.ok(passwordProblem('alllowercaseletters'));
  assert.equal(passwordProblem('Correct-Horse-9'), null);
});

test('day series fills gaps with zeros', () => {
  const today = new Date().toISOString().slice(0, 10);
  const series = fillDaySeries([{ _id: today, count: 4 }], 3);
  assert.equal(series.length, 3);
  assert.deepEqual(series[2], { date: today, value: 4 });
  assert.equal(series[0].value, 0);
});

test('search input is escaped and routed to the right field', () => {
  assert.deepEqual(buildSearchFilter('abcd1234'), { publicId: 'ABCD1234' });
  assert.ok(buildSearchFilter('507f1f77bcf86cd799439011')._id);
  assert.deepEqual(buildSearchFilter('a.b@x.com'), { email: { $regex: '^a\\.b@x\\.com' } });
  assert.equal(buildSearchFilter('(.*)').$or[0].name.$regex, escapeRegex('(.*)'));
  assert.deepEqual(buildSearchFilter(''), {});
});

test('paging is clamped', () => {
  assert.deepEqual(pageParams({ page: '-3', limit: '9999' }), { page: 1, limit: 100, skip: 0 });
});

test('account status mirrors app semantics', () => {
  assert.equal(accountStatus({ isDeactivated: true, deletionReason: 'moderation:banned' }), 'banned');
  assert.equal(accountStatus({ isDeactivated: true, deletionScheduledAt: new Date() }), 'deleting');
  assert.equal(accountStatus({ isDeactivated: false }), 'active');
  assert.equal(activePlan({ subscriptionPlan: 'gold', subscriptionExpiresAt: new Date(Date.now() - 1000) }), 'free');
  assert.equal(activePlan({ subscriptionPlan: 'gold', subscriptionExpiresAt: new Date(Date.now() + 60_000) }), 'gold');
});

const { shapeOrder } = require('../lib/razorpay');
const { summarizeOrders } = require('../lib/revenue');

test('razorpay orders are classified from their notes', () => {
  const sub = shapeOrder({ id: 'order_1', amount_paid: 34900, created_at: 1790000000, notes: { userId: 'u1', planId: 'gold', periodId: '1m', type: 'subscription' } });
  assert.equal(sub.kind, 'subscription');
  assert.equal(sub.amount, 349);
  assert.equal(sub.planId, 'gold');
  const pack = shapeOrder({ id: 'order_2', amount_paid: 400, created_at: 1790000000, notes: { userId: 'u2', packId: '10', tokens: '10' } });
  assert.equal(pack.kind, 'tokens');
  assert.equal(pack.tokens, 10);
  assert.equal(shapeOrder({ id: 'order_3', amount_paid: 100, created_at: 1790000000, notes: [] }).kind, 'other');
});

test('revenue summary splits subscriptions and tokens and fills the series', () => {
  const today = new Date().toISOString();
  const orders = [
    { kind: 'subscription', planId: 'gold', amount: 349, userId: 'a', createdAt: today },
    { kind: 'subscription', planId: 'black', amount: 1499, userId: 'b', createdAt: today },
    { kind: 'tokens', packId: '10', amount: 4, userId: 'a', createdAt: today },
  ];
  const s = summarizeOrders(orders, 7);
  assert.equal(s.total, 1852);
  assert.equal(s.orders, 3);
  assert.equal(s.payers, 2);
  assert.deepEqual(s.subscriptions, { amount: 1848, count: 2 });
  assert.deepEqual(s.tokens, { amount: 4, count: 1 });
  assert.equal(s.byPlan.black.amount, 1499);
  assert.equal(s.series.unit, 'day');
  assert.equal(s.series.points.length, 7);
  assert.equal(s.series.points[6].value, 1852);
  assert.equal(summarizeOrders(orders, 365).series.unit, 'month');
  assert.equal(summarizeOrders([], null).total, 0);
});

test('permanently blocked accounts report as banned', () => {
  assert.equal(accountStatus({ isBanned: true }), 'banned');
  assert.equal(accountStatus({ isBanned: true, deletionScheduledAt: new Date() }), 'banned');
  assert.equal(accountStatus({ isBanned: false }), 'active');
});
