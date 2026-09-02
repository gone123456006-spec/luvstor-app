const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');
const Upload = require('../models/Upload');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

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
  if (m.includes('m4a') || m.includes('mp4') || m.includes('aac')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('3gpp') || m.includes('3gp')) return '3gp';
  if (m.includes('caf') || m.includes('x-caf')) return 'caf';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('webm')) return 'webm';
  return fallback;
}

async function persistUploadBuffer(req, { buffer, mime, originalName, prefix, defaultMime, defaultExt }) {
  const resolvedMime = mime || defaultMime;
  const ext = extensionForMime(resolvedMime, defaultExt);
  const userId = String(req.userId);
  const userDir = path.join(UPLOADS_DIR, userId);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const filePath = path.join(userDir, fileName);
  fs.writeFileSync(filePath, buffer);

  const relativePath = `/uploads/${userId}/${fileName}`;
  const absoluteUrl = `${req.protocol}://${req.get('host')}${relativePath}`;

  const upload = await Upload.create({
    userId: req.userId,
    fileName,
    originalName: originalName || fileName,
    mimeType: resolvedMime,
    size: buffer.length,
    path: filePath,
    url: relativePath,
  });

  return {
    url: relativePath,
    absoluteUrl,
    uploadId: upload._id,
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

// POST /api/upload/audio  — voice notes for chat
router.post('/audio', auth, (req, res) =>
  saveUpload(req, res, { prefix: 'aud', defaultMime: 'audio/m4a', defaultExt: 'm4a' })
);

// GET /api/upload/verify/:uploadId
router.get('/verify/:uploadId', auth, async (req, res) => {
  try {
    const upload = await Upload.findById(req.params.uploadId);
    if (!upload) {
      return res.status(404).json({ error: 'File not found' });
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
