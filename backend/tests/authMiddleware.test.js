const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const User = require('../models/User');
const auth = require('../middleware/auth');
const { invalidateActiveDevice } = require('../utils/deviceSessionCache');

function run(token) {
  return new Promise((resolve) => {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body, next: false });
        return this;
      },
    };
    auth(req, res, () => resolve({ status: 200, req, res, next: true }));
  });
}

function stubFindById(impl) {
  const original = User.findById;
  User.findById = () => ({ select: () => ({ lean: impl }) });
  return () => {
    User.findById = original;
  };
}

const sign = (userId, deviceId = 'a:device1') =>
  jwt.sign({ userId, deviceId }, process.env.JWT_SECRET);

test('DB failure during the user lookup is 503, not a bad session', async () => {
  invalidateActiveDevice('u-db-down');
  const restore = stubFindById(async () => {
    throw new Error('connection reset');
  });
  try {
    const out = await run(sign('u-db-down'));
    assert.strictEqual(out.status, 503);
    assert.strictEqual(out.body.code, 'SERVER_BUSY');
  } finally {
    restore();
  }
});

test('bad or missing tokens are 401 INVALID_TOKEN', async () => {
  const garbage = await run('not-a-jwt');
  assert.strictEqual(garbage.status, 401);
  assert.strictEqual(garbage.body.code, 'INVALID_TOKEN');

  const missing = await run(null);
  assert.strictEqual(missing.status, 401);
  assert.strictEqual(missing.body.code, 'INVALID_TOKEN');
});

test('deleted account is 401 INVALID_TOKEN', async () => {
  invalidateActiveDevice('u-gone');
  const restore = stubFindById(async () => null);
  try {
    const out = await run(sign('u-gone'));
    assert.strictEqual(out.status, 401);
    assert.strictEqual(out.body.code, 'INVALID_TOKEN');
  } finally {
    restore();
  }
});

test('a week-old token gets a renewed one; a fresh token does not', async () => {
  invalidateActiveDevice('u-renew');
  const restore = stubFindById(async () => ({ activeDeviceId: 'a:device1' }));
  try {
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    const old = jwt.sign(
      { userId: 'u-renew', deviceId: 'a:device1', iat: eightDaysAgo },
      process.env.JWT_SECRET,
      { expiresIn: '30d' },
    );
    const out = await run(old);
    assert.strictEqual(out.next, true);
    const renewed = out.res.headers['x-auth-token'];
    assert.ok(renewed, 'expected X-Auth-Token');
    const payload = jwt.verify(renewed, process.env.JWT_SECRET);
    assert.strictEqual(payload.userId, 'u-renew');
    assert.strictEqual(payload.deviceId, 'a:device1');
    assert.ok(payload.exp - payload.iat >= 29 * 24 * 60 * 60);

    const fresh = await run(sign('u-renew'));
    assert.strictEqual(fresh.res.headers['x-auth-token'], undefined);
  } finally {
    restore();
  }
});

test('valid session on the bound device passes; other device is DEVICE_MISMATCH', async () => {
  invalidateActiveDevice('u-ok');
  const restore = stubFindById(async () => ({ activeDeviceId: 'a:device1' }));
  try {
    const ok = await run(sign('u-ok', 'a:device1'));
    assert.strictEqual(ok.next, true);
    assert.strictEqual(ok.req.userId, 'u-ok');

    const other = await run(sign('u-ok', 'a:device2'));
    assert.strictEqual(other.status, 401);
    assert.strictEqual(other.body.code, 'DEVICE_MISMATCH');
  } finally {
    restore();
  }
});
