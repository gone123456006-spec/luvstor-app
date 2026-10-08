const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');
const { recordAppVersion, readAppVersionHeaders, _seen } = require('../utils/appVersionTracker');

function req(headers) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[name.toLowerCase()] };
}

test('only well-formed version headers are accepted', () => {
  assert.deepEqual(readAppVersionHeaders(req({ 'X-App-Version': '1.0.5', 'X-App-Build': '7', 'X-App-Platform': 'Android' })), {
    appVersion: '1.0.5',
    appBuild: '7',
    appPlatform: 'android',
  });
  assert.equal(readAppVersionHeaders(req({})), null);
  assert.equal(readAppVersionHeaders(req({ 'X-App-Version': '{"$gt":""}' })), null);
  assert.deepEqual(readAppVersionHeaders(req({ 'X-App-Version': '2.1', 'X-App-Platform': 'windows', 'X-App-Build': 'a b' })), {
    appVersion: '2.1',
    appBuild: null,
    appPlatform: null,
  });
});

test('writes once per version change, not on every request', async (t) => {
  const calls = [];
  t.mock.method(User, 'updateOne', (filter, update) => {
    calls.push({ filter, update });
    return Promise.resolve({});
  });
  _seen.clear();
  const userId = '507f1f77bcf86cd799439011';
  recordAppVersion(userId, req({ 'X-App-Version': '1.0.5', 'X-App-Platform': 'ios' }));
  recordAppVersion(userId, req({ 'X-App-Version': '1.0.5', 'X-App-Platform': 'ios' }));
  recordAppVersion(userId, req({ 'X-App-Version': '1.0.5', 'X-App-Platform': 'ios' }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].update.$set.appVersion, '1.0.5');
  recordAppVersion(userId, req({ 'X-App-Version': '1.0.6', 'X-App-Platform': 'ios' }));
  assert.equal(calls.length, 2);
  recordAppVersion(userId, req({}));
  assert.equal(calls.length, 2);
});
