const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/unused';
process.env.ADMIN_JWT_SECRET ||= 'x'.repeat(48);
process.env.MAIN_API_URL ||= 'http://127.0.0.1:1';
process.env.MAIN_ADMIN_API_KEY ||= 'test-key';

const { createApp } = require('../app');

let server;
let base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('API requires a session', async () => {
  for (const path of ['/api/overview', '/api/users', '/api/admins', '/api/auth/me']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 401, path);
  }
});

test('mutations without the CSRF header are rejected before auth', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.c', password: 'x' }),
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'CSRF');
});

test('forged or foreign-secret session cookies are rejected', async () => {
  const forged = jwt.sign({ sub: '507f1f77bcf86cd799439011', v: 0 }, 'wrong-secret', { issuer: 'luvstor-admin' });
  const res = await fetch(`${base}/api/overview`, { headers: { Cookie: `lv_admin=${forged}` } });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'SESSION_EXPIRED');
});

test('security headers are set and API responses are not cached', async () => {
  const res = await fetch(`${base}/api/overview`);
  assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('health probe works without auth', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
});
