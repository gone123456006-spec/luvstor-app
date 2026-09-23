/**
 * ICE / TURN config — calls must work at any geographic range.
 * Distance is not a call rule; missing TURN is what fails 1000 km / cellular.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getIceServers,
  iceListHasTurn,
} = require('../services/calls');

function withEnv(updates, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(updates)) {
    prev[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function urlsOf(list) {
  return list.flatMap((s) => [].concat(s.urls || []));
}

test('iceListHasTurn detects turn and turns URIs', () => {
  assert.equal(iceListHasTurn([{ urls: 'stun:stun.l.google.com:19302' }]), false);
  assert.equal(iceListHasTurn([{ urls: 'turn:host:3478' }]), true);
  assert.equal(iceListHasTurn([{ urls: ['stun:x', 'turns:host:443'] }]), true);
});

test('without TURN_URLS, ICE still includes a relay so any-range calls can connect', () => {
  const list = withEnv({ TURN_URLS: null, TURN_USERNAME: null, TURN_CREDENTIAL: null }, () =>
    getIceServers(),
  );
  assert.ok(iceListHasTurn(list), 'fallback must include TURN, not STUN-only');
  const urls = urlsOf(list);
  assert.ok(urls.some((u) => /^stun:/i.test(u)), 'STUN still present');
  assert.ok(
    urls.some((u) => /\?transport=tcp/i.test(u) || /^turns:/i.test(u)),
    'TCP or TLS TURN present for restrictive carriers',
  );
});

test('configured TURN keeps UDP and fills missing TCP/TLS transports', () => {
  const list = withEnv(
    {
      TURN_URLS: 'turn:relay.example.com:3478',
      TURN_USERNAME: 'user',
      TURN_CREDENTIAL: 'pass',
    },
    () => getIceServers(),
  );
  const urls = urlsOf(list);
  assert.ok(urls.includes('turn:relay.example.com:3478'));
  assert.ok(urls.some((u) => /relay\.example\.com:3478\?transport=tcp/i.test(u)));
  assert.ok(urls.some((u) => /^turns:relay\.example\.com:443/i.test(u)));
  const turnEntries = list.filter((s) =>
    [].concat(s.urls || []).some((u) => /^turns?:/i.test(String(u))),
  );
  assert.ok(turnEntries.every((s) => s.username === 'user' && s.credential === 'pass'));
});

test('Nearby 100 km / location env does not change ICE (calls are any-range)', () => {
  const withNearby = withEnv(
    {
      DISCOVERY_MAX_RADIUS_METRES: '100000',
      NEARBY_HARD_RADIUS_M: '100000',
      TURN_URLS: null,
    },
    () => getIceServers(),
  );
  const without = withEnv(
    {
      DISCOVERY_MAX_RADIUS_METRES: null,
      NEARBY_HARD_RADIUS_M: null,
      TURN_URLS: null,
    },
    () => getIceServers(),
  );
  assert.deepEqual(urlsOf(withNearby), urlsOf(without));
  assert.ok(iceListHasTurn(withNearby));
});

test('invalid TURN_URLS (API key pasted) still falls back to a public relay', () => {
  const list = withEnv(
    {
      TURN_URLS: 'abcdef0123456789abcdef0123456789',
      TURN_USERNAME: 'x',
      TURN_CREDENTIAL: 'y',
    },
    () => getIceServers(),
  );
  assert.ok(iceListHasTurn(list), 'must not ship STUN-only after a bad key paste');
});
