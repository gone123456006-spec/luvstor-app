const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Upload = require('../models/Upload');
const { persistMediaBuffer } = require('../services/mediaStore');
const { publicApiBase } = require('../utils/absoluteUrl');

function parseDataUri(base64) {
  const matches = String(base64 || '').match(/^data:([A-Za-z0-9-+/.]+);base64,(.+)$/);
  if (matches) {
    return { mime: matches[1], data: matches[2] };
  }
  return { mime: 'application/octet-stream', data: String(base64 || '') };
}

function extensionForMime(mime, fallback = 'bin') {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('m4a') || m.includes('mp4') || m.includes('aac') || m === 'audio/mp4') return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('3gpp') || m.includes('3gp')) return '3gp';
  if (m.includes('caf') || m.includes('x-caf')) return 'caf';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('webm')) return 'webm';
  return fallback;
}

/**
 * Store file bytes in MongoDB and return durable `/api/media/{id}` URL.
 * Same Atlas DB as production → images survive redeploy / reinstall / device transfer.
 */
async function persistUploadBuffer(req, { buffer, mime, originalName, prefix, defaultMime, defaultExt }) {
  const resolvedMime = mime || defaultMime;
  const result = await persistMediaBuffer({
    userId: req.userId,
    buffer,
    mime: resolvedMime,
    originalName,
    prefix,
    defaultMime,
  });

  const publicBase = publicApiBase();
  const hostBase =
    publicBase && !/localhost|127\.0\.0\.1/i.test(publicBase)
      ? publicBase
      : `${req.protocol}://${req.get('host')}`;
  const absoluteUrl = `${hostBase}${result.url}`;

  // Optional ext hint for clients that append types (not required for serve)
  const ext = extensionForMime(resolvedMime, defaultExt);

  return {
    url: result.url,
    absoluteUrl,
    uploadId: result.id,
    mediaId: result.id,
    mimeType: result.mimeType,
    size: result.size,
    ext,
  };
}

async function saveUpload(req, res, { prefix, defaultMime, defaultExt }) {
  try {
    const { base64, originalName } = req.body;
    if (!base64) {
      return res.status(400).json({ error: 'base64 is required' });
    }

    const { mime, data } = parseDataUri(base64);
    const json = await persistUploadBuffer(req, {
      buffer: Buffer.from(data, 'base64'),
      mime: mime || defaultMime,
      originalName,
      prefix,
      defaultMime,
      defaultExt,
    });
    res.json(json);
  } catch (err) {
    console.error('upload error:', err);
    const msg = err?.message || 'Failed to upload file';
    if (/too large/i.test(msg)) {
      return res.status(413).json({ error: msg });
    }
    res.status(500).json({ error: 'Failed to upload file' });
  }
}

// POST /api/upload/image
router.post('/image', auth, (req, res) =>
  saveUpload(req, res, { prefix: 'img', defaultMime: 'image/jpeg', defaultExt: 'jpg' })
);

// POST /api/upload/image-bin  — raw JPEG/PNG (much faster than base64 JSON)
router.post('/image-bin', auth, async (req, res) => {
    try {
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      if (!buffer.length) {
        return res.status(400).json({ error: 'Empty file' });
      }
      const mime = String(req.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
      if (!mime.startsWith('image/')) {
        return res.status(400).json({ error: 'Only images are allowed' });
      }
      const originalName = String(req.headers['x-original-name'] || '').slice(0, 180);
      const json = await persistUploadBuffer(req, {
        buffer,
        mime,
        originalName,
        prefix: 'img',
        defaultMime: 'image/jpeg',
        defaultExt: 'jpg',
      });
      res.json(json);
    } catch (err) {
      console.error('binary image upload error:', err);
      res.status(500).json({ error: 'Failed to upload file' });
    }
});

// POST /api/upload/audio  — voice notes for chat (base64 JSON — legacy)
router.post('/audio', auth, (req, res) =>
  saveUpload(req, res, { prefix: 'aud', defaultMime: 'audio/m4a', defaultExt: 'm4a' })
);

// POST /api/upload/audio-bin  — raw AAC/M4A (faster than base64; preferred for voice notes)
router.post('/audio-bin', auth, async (req, res) => {
  try {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!buffer.length) {
      return res.status(400).json({ error: 'Empty file' });
    }
    const mime = String(req.headers['content-type'] || 'audio/mp4').split(';')[0].trim();
    if (!mime.startsWith('audio/') && mime !== 'application/octet-stream') {
      return res.status(400).json({ error: 'Only audio is allowed' });
    }
    const originalName = String(req.headers['x-original-name'] || '').slice(0, 180);
    const json = await persistUploadBuffer(req, {
      buffer,
      mime: mime.startsWith('audio/') ? mime : 'audio/mp4',
      originalName,
      prefix: 'aud',
      defaultMime: 'audio/m4a',
      defaultExt: 'm4a',
    });
    res.json(json);
  } catch (err) {
    console.error('binary audio upload error:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// GET /api/upload/verify/:uploadId
router.get('/verify/:uploadId', auth, async (req, res) => {
  try {
    const upload = await Upload.findById(req.params.uploadId);
    if (!upload) {
      // Also accept MediaAsset id
      const MediaAsset = require('../models/MediaAsset');
      const media = await MediaAsset.findById(req.params.uploadId);
      if (!media) {
        return res.status(404).json({ error: 'File not found' });
      }
      if (String(media.userId) !== String(req.userId)) {
        return res.status(403).json({
          error: 'Access denied. This file is not yours.',
          code: 'OWNERSHIP_MISMATCH',
        });
      }
      return res.json({
        id: media._id,
        fileName: media.fileName,
        url: `/api/media/${media._id}`,
        uploadedAt: media.createdAt,
        isOwnedByUser: true,
      });
    }
    if (upload.userId.toString() !== req.userId.toString()) {
      return res.status(403).json({
        error: 'Access denied. This file is not yours.',
        code: 'OWNERSHIP_MISMATCH',
      });
    }
    res.json({
      id: upload._id,
      fileName: upload.fileName,
      url: upload.url,
      uploadedAt: upload.uploadedAt,
      isOwnedByUser: true,
    });
  } catch (err) {
    console.error('upload/verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// GET /api/upload/my-files
router.get('/my-files', auth, async (req, res) => {
  try {
    const uploads = await Upload.find({ userId: req.userId })
      .sort({ uploadedAt: -1 })
      .limit(100);

    res.json({
      count: uploads.length,
      files: uploads.map(u => ({
        id: u._id,
        fileName: u.fileName,
        originalName: u.originalName,
        url: u.url,
        uploadedAt: u.uploadedAt,
        size: u.size,
      })),
    });
  } catch (err) {
    console.error('upload/my-files error:', err);
    res.status(500).json({ error: 'Failed to list uploads' });
  }
});

module.exports = router;
