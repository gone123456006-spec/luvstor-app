/**
 * @file Signed private-media links + /api/media route behaviour (no DB: bytes come from the LRU).
 */
process.env.MEDIA_URL_SECRET = 'test-secret';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const {
  signMediaUrl,
  verifyMediaSignature,
  signMessageMedia,
} = require('../utils/mediaSign');
const memCache = require('../services/mediaMemCache');
const mediaRouter = require('../routes/media');

const PUB = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PRIV = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const bytes = Buffer.from('0123456789');

memCache.set(PUB, { data: bytes, mimeType: 'image/jpeg', size: 10, kind: 'image', private: false });
memCache.set(PRIV, { data: bytes, mimeType: 'audio/m4a', size: 10, kind: 'audio', private: true });

function request(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(fn) {
  const app = express();
  app.use('/api/media', mediaRouter);
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
}

test('signMediaUrl signs only /api/media paths and verifies', () => {
  const signed = signMediaUrl(`/api/media/${PRIV}`);
  const u = new URL(signed, 'http://x');
  assert.equal(u.pathname, `/api/media/${PRIV}`);
  assert.ok(verifyMediaSignature(PRIV, u.searchParams.get('e'), u.searchParams.get('s')));
  assert.equal(verifyMediaSignature(PUB, u.searchParams.get('e'), u.searchParams.get('s')), false);
  assert.equal(signMediaUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(signMediaUrl(null), null);
});

test('signatures expire and are stable within a window', () => {
  const now = Date.now();
  assert.equal(signMediaUrl(`/api/media/${PRIV}`, now), signMediaUrl(`/api/media/${PRIV}`, now + 1000));
  const u = new URL(signMediaUrl(`/api/media/${PRIV}`, now), 'http://x');
  const e = u.searchParams.get('e');
  const s = u.searchParams.get('s');
  assert.equal(verifyMediaSignature(PRIV, e, s, Number(e) * 1000 + 1), false);
});

test('signMessageMedia signs message and reply quote', () => {
  const out = signMessageMedia({
    mediaUrl: `/api/media/${PRIV}`,
    replyTo: { mediaUrl: `/api/media/${PUB}` },
  });
  assert.match(out.mediaUrl, /\?e=\d+&s=/);
  assert.match(out.replyTo.mediaUrl, /\?e=\d+&s=/);
});

test('public media: long immutable cache, 304 on ETag, HEAD, Range', async () => {
  await withServer(async (port) => {
    const res = await request(port, `/api/media/${PUB}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), '0123456789');
    assert.match(res.headers['cache-control'], /public.*immutable/);
    assert.equal(res.headers['accept-ranges'], 'bytes');

    const etag = res.headers.etag;
    const notMod = await request(port, `/api/media/${PUB}`, {
      headers: { 'If-None-Match': `W/${etag}, "other"` },
    });
    assert.equal(notMod.status, 304);

    const head = await request(port, `/api/media/${PUB}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], '10');

    const part = await request(port, `/api/media/${PUB}`, { headers: { Range: 'bytes=2-4' } });
    assert.equal(part.status, 206);
    assert.equal(part.body.toString(), '234');
    assert.equal(part.headers['content-range'], 'bytes 2-4/10');

    const bad = await request(port, `/api/media/${PUB}`, { headers: { Range: 'bytes=50-60' } });
    assert.equal(bad.status, 416);
  });
});

test('private media: enforce=on blocks unsigned, allows signed; log mode serves', async () => {
  await withServer(async (port) => {
    process.env.MEDIA_PRIVATE_ENFORCE = 'on';
    const blocked = await request(port, `/api/media/${PRIV}`);
    assert.equal(blocked.status, 403);

    const ok = await request(port, signMediaUrl(`/api/media/${PRIV}`));
    assert.equal(ok.status, 200);
    assert.match(ok.headers['cache-control'], /^private/);

    process.env.MEDIA_PRIVATE_ENFORCE = 'log';
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const served = await request(port, `/api/media/${PRIV}`);
      assert.equal(served.status, 200);
    } finally {
      console.warn = origWarn;
      delete process.env.MEDIA_PRIVATE_ENFORCE;
    }
  });
});
