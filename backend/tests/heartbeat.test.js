/**
 * @file Heartbeat endpoint tests (no live server required for handler logic).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const { mountHeartbeatRoutes } = require('../utils/heartbeat');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(
      { hostname: '127.0.0.1', port, path, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    ).on('error', reject);
  });
}

test('GET /health returns 200 ok json', async () => {
  const app = express();
  mountHeartbeatRoutes(app);
  const { server, port } = await listen(app);
  try {
    const res = await get(port, '/health');
    assert.equal(res.status, 200);
    assert.match(res.body, /"ok":true/);
  } finally {
    server.close();
  }
});

test('GET /ping returns 200 pong without secret in dev', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  delete process.env.HEARTBEAT_SECRET;

  const app = express();
  mountHeartbeatRoutes(app);
  const { server, port } = await listen(app);
  try {
    const res = await get(port, '/ping');
    assert.equal(res.status, 200);
    assert.equal(res.body, 'pong');
  } finally {
    server.close();
    process.env.NODE_ENV = prev;
  }
});

test('GET /ping requires secret in production', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.HEARTBEAT_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.HEARTBEAT_SECRET = 'test-secret-123';

  const app = express();
  mountHeartbeatRoutes(app);
  const { server, port } = await listen(app);
  try {
    const denied = await get(port, '/ping');
    assert.equal(denied.status, 401);

    const ok = await get(port, '/ping', { 'X-Heartbeat-Secret': 'test-secret-123' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body, 'pong');
  } finally {
    server.close();
    process.env.NODE_ENV = prevEnv;
    process.env.HEARTBEAT_SECRET = prevSecret;
  }
});
