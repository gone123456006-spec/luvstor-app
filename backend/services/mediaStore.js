/**
 * Persist / serve media from MongoDB.
 * Relative URL: /api/media/{ObjectId}
 */
const mongoose = require('mongoose');
const MediaAsset = require('../models/MediaAsset');
const Upload = require('../models/Upload');

const MEDIA_PATH_RE = /^\/api\/media\/([a-fA-F0-9]{24})(?:\.[a-z0-9]+)?$/i;

function isMediaApiPath(url) {
  const raw = String(url || '').trim().split('?')[0].split('#')[0];
  return MEDIA_PATH_RE.test(raw) || raw.startsWith('/api/media/');
}

function mediaIdFromUrl(url) {
  const raw = String(url || '').trim().split('?')[0].split('#')[0];
  const m = raw.match(MEDIA_PATH_RE);
  if (m) return m[1];
  try {
    const u = new URL(raw, 'https://placeholder.local');
    const m2 = u.pathname.match(MEDIA_PATH_RE);
    if (m2) return m2[1];
  } catch {
    /* ignore */
  }
  return null;
}

function kindFromMime(mime, prefix) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/') || prefix === 'img') return 'image';
  if (m.startsWith('audio/') || prefix === 'aud') return 'audio';
  return 'other';
}

/**
 * Store buffer in MongoDB and return durable relative URL + metadata.
 */
async function persistMediaBuffer({
  userId,
  buffer,
  mime,
  originalName,
  prefix,
  defaultMime,
}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Empty media buffer');
  }
  // BSON hard limit 16MB — leave headroom
  const MAX = 14 * 1024 * 1024;
  if (buffer.length > MAX) {
    throw new Error('File too large (max 14MB)');
  }

  const resolvedMime = mime || defaultMime || 'application/octet-stream';
  const fileName = `${prefix || 'file'}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;

  const doc = await MediaAsset.create({
    userId,
    kind: kindFromMime(resolvedMime, prefix),
    mimeType: resolvedMime,
    fileName,
    originalName: originalName || fileName,
    size: buffer.length,
    data: buffer,
  });

  const relativePath = `/api/media/${doc._id}`;

  // Keep lightweight Upload index for ownership / admin lists (no disk path)
  try {
    await Upload.create({
      userId,
      fileName,
      originalName: originalName || fileName,
      mimeType: resolvedMime,
      size: buffer.length,
      path: `mongodb:${doc._id}`,
      url: relativePath,
    });
  } catch (err) {
    console.warn('[mediaStore] Upload index create failed:', err.message);
  }

  return {
    id: String(doc._id),
    url: relativePath,
    mimeType: resolvedMime,
    size: buffer.length,
  };
}

async function mediaExists(url) {
  const id = mediaIdFromUrl(url);
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return false;
  const found = await MediaAsset.exists({ _id: id });
  return !!found;
}

async function loadMediaById(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return MediaAsset.findById(id).select('+data');
}

async function deleteUserMedia(userId) {
  await MediaAsset.deleteMany({ userId });
}

module.exports = {
  MEDIA_PATH_RE,
  isMediaApiPath,
  mediaIdFromUrl,
  persistMediaBuffer,
  mediaExists,
  loadMediaById,
  deleteUserMedia,
};
