/**
 * Media stream from MongoDB.
 * GET|HEAD /api/media/:id → image/audio bytes
 *
 * Profile / post photos are public. Chat photos and voice notes are private:
 * they need a signed link (?e=&s=) — see utils/mediaSign.js.
 *
 * Order matters for speed: metadata first (no bytes), then 304 / HEAD exits,
 * then bytes from the in-process LRU or MongoDB.
 */
const express = require('express');
const router = express.Router();
const { loadMediaById, loadMediaMeta, mediaIdFromUrl } = require('../services/mediaStore');
const memCache = require('../services/mediaMemCache');
const { verifyMediaSignature, enforceMode } = require('../utils/mediaSign');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

let unsignedCount = 0;
let unsignedLoggedAt = 0;
function noteUnsigned(id) {
  unsignedCount += 1;
  const now = Date.now();
  if (now - unsignedLoggedAt < 60_000) return;
  unsignedLoggedAt = now;
  console.warn(
    `[media] ${unsignedCount} unsigned private-media request(s) so far (latest ${id}). ` +
      'Set MEDIA_PRIVATE_ENFORCE=on once old app versions are gone.',
  );
}

function etagMatches(header, etag) {
  if (!header) return false;
  return String(header)
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*');
}

/** Parse a single `bytes=a-b` range; null when absent/unsupported */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start;
  let end;
  if (!m[1]) {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return { invalid: true };
  }
  return { start, end };
}

router.get('/:id', async (req, res) => {
  try {
    const rawId = String(req.params.id || '').split('.')[0].trim();
    const id = (mediaIdFromUrl(`/api/media/${rawId}`) || rawId).toLowerCase();

    const cached = memCache.get(id);
    const meta = cached || (await loadMediaMeta(id));
    if (!meta) {
      return res.status(404).type('text/plain').send('Not found');
    }

    const isPrivate = !!meta.private || meta.kind === 'audio';
    if (isPrivate && !verifyMediaSignature(id, req.query.e, req.query.s)) {
      const mode = enforceMode();
      if (mode === 'on') {
        setCors(res);
        return res.status(403).type('text/plain').send('Link expired');
      }
      if (mode === 'log') noteUnsigned(id);
    }

    setCors(res);
    // Legacy rows kept whatever the client declared — never serve html / svg / script
    const mime = String(meta.mimeType || '');
    res.setHeader(
      'Content-Type',
      /^(image\/(jpeg|jpg|png|gif|webp|heic|heif|avif)|audio\/[a-z0-9.+-]+)$/i.test(mime)
        ? mime
        : 'application/octet-stream',
    );
    res.setHeader('Accept-Ranges', 'bytes');
    // Private media must not sit in shared/CDN caches
    res.setHeader(
      'Cache-Control',
      isPrivate ? 'private, max-age=86400' : 'public, max-age=31536000, immutable',
    );

    let data = cached?.data || null;
    let size = Number(meta.size) || data?.length || 0;

    // Legacy rows without a stored size: need bytes to know the length
    if (!size) {
      const doc = await loadMediaById(id);
      data = doc?.data || null;
      if (!data?.length) return res.status(404).type('text/plain').send('Not found');
      size = data.length;
    }

    const etag = `"${id}-${size}"`;
    res.setHeader('ETag', etag);
    if (etagMatches(req.headers['if-none-match'], etag)) {
      return res.status(304).end();
    }

    const range = req.headers.range ? parseRange(req.headers.range, size) : null;
    if (range?.invalid) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }

    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', String(size));
      return res.status(200).end();
    }

    if (!data) {
      const doc = await loadMediaById(id);
      data = doc?.data || null;
      if (!data?.length) return res.status(404).type('text/plain').send('Not found');
      memCache.set(id, {
        data,
        mimeType: meta.mimeType,
        size: data.length,
        kind: meta.kind,
        private: meta.private,
      });
    }

    if (range) {
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${data.length}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
      return res.status(206).send(data.subarray(range.start, range.end + 1));
    }

    res.setHeader('Content-Length', String(data.length));
    return res.status(200).send(data);
  } catch (err) {
    console.error('[media] serve error:', err);
    return res.status(500).type('text/plain').send('Error');
  }
});

router.options('/:id', (_req, res) => {
  setCors(res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, If-None-Match');
  res.status(204).end();
});

router.unsignedStats = () => ({ unsignedCount });

module.exports = router;
