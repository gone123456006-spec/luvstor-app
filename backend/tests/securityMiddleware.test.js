/**
 * @file Security headers, NoSQL operator stripping, OTP hashing, public error messages.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'security-test-secret';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const { securityHeaders, sanitizeInput, stripOperators } = require('../middleware/security');
const { hashOtp, otpLookupValues } = require('../utils/otpHash');
const { publicErrorMessage } = require('../utils/publicError');

test('stripOperators removes $-keys at any depth, keeps normal data', () => {
  const body = {
    email: { $ne: null },
    otp: '123456',
    nested: [{ $where: 'x', ok: 1 }],
    deep: { a: { $gt: 1, b: 2 } },
  };
  stripOperators(body);
  assert.deepEqual(body, { email: {}, otp: '123456', nested: [{ ok: 1 }], deep: { a: { b: 2 } } });
});

test('OTP hash is keyed per email and lookup also accepts legacy plain rows', () => {
  assert.notEqual(hashOtp('a@b.com', '123456'), '123456');
  assert.notEqual(hashOtp('a@b.com', '123456'), hashOtp('c@d.com', '123456'));
  assert.equal(hashOtp('A@B.com ', '123456'), hashOtp('a@b.com', '123456'));
  assert.deepEqual(otpLookupValues('a@b.com', '123456').$in, [hashOtp('a@b.com', '123456'), '123456']);
});

test('publicErrorMessage hides 5xx details, keeps intentional 4xx', () => {
  const internal = new Error('E11000 duplicate key users.email');
  assert.equal(publicErrorMessage(internal, 'Server error'), 'Server error');
  const user = Object.assign(new Error('Invalid subscription plan'), { status: 400 });
  assert.equal(publicErrorMessage(user, 'Server error'), 'Invalid subscription plan');
});

test('headers + body sanitizer on a live app', async () => {
  const app = express();
  app.use(securityHeaders);
  app.use(express.json());
  app.use(sanitizeInput);
  app.post('/api/echo', (req, res) => res.json(req.body));
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  try {
    const { port } = server.address();
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/api/echo', method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (r) => {
          let body = '';
          r.on('data', (c) => (body += c));
          r.on('end', () => resolve({ headers: r.headers, body: JSON.parse(body) }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ email: { $ne: null }, name: 'ok' }));
    });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.match(res.headers['content-security-policy'], /default-src 'none'/);
    assert.deepEqual(res.body, { email: {}, name: 'ok' });
  } finally {
    server.close();
  }
});
