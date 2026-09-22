/**
 * Public media stream from MongoDB.
 * GET /api/media/:id  → image/audio bytes (no auth — same as former /uploads static)
 */
const express = require('express');
const router = express.Router();
const { loadMediaById, mediaIdFromUrl } = require('../services/mediaStore');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

router.get('/:id', async (req, res) => {
  try {
    const rawId = String(req.params.id || '')
      .split('.')[0]
      .trim();
    const id = mediaIdFromUrl(`/api/media/${rawId}`) || rawId;
    const doc = await loadMediaById(id);
    if (!doc || !doc.data || !doc.data.length) {
      return res.status(404).type('text/plain').send('Not found');
    }

    setCors(res);
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(doc.data.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', `"${doc._id}-${doc.size || doc.data.length}"`);

    if (req.headers['if-none-match'] === `"${doc._id}-${doc.size || doc.data.length}"`) {
      return res.status(304).end();
    }

    return res.status(200).send(doc.data);
  } catch (err) {
    console.error('[media] serve error:', err);
    return res.status(500).type('text/plain').send('Error');
  }
});

router.options('/:id', (_req, res) => {
  setCors(res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.status(204).end();
});

module.exports = router;
