/**
 * Remove orphaned /uploads/{userId}/... files when profile media refs change.
 * Only deletes files owned by that userId (path prefix check).
 */
const fs = require('fs');
const path = require('path');
const Upload = require('../models/Upload');
const { getUploadsDir } = require('./uploadsPath');
const { toPersistentMediaUrl } = require('./mediaUrl');

function normalizeUploadPath(url) {
  return toPersistentMediaUrl(url) || '';
}

/** Absolute filesystem path if url is this user's upload; else null. */
function ownedUploadFilePath(userId, url) {
  const rel = normalizeUploadPath(url);
  if (!rel.startsWith('/uploads/')) return null;
  const suffix = rel.slice('/uploads/'.length);
  const uid = String(userId);
  if (!suffix.startsWith(`${uid}/`)) return null;
  // Prevent path traversal
  if (suffix.includes('..')) return null;
  return path.join(getUploadsDir(), suffix);
}

/**
 * Collect media URLs present in `before` but not in `after`.
 * @param {{ photo?: string, coverPhoto?: string, photos?: string[] }} before
 * @param {{ photo?: string, coverPhoto?: string, photos?: string[] }} after
 */
function orphanedMediaUrls(before, after) {
  const prev = new Set();
  const next = new Set();

  const add = (set, url) => {
    const n = normalizeUploadPath(url);
    if (n) set.add(n);
  };

  add(prev, before?.photo);
  add(prev, before?.coverPhoto);
  for (const p of before?.photos || []) add(prev, p);

  add(next, after?.photo);
  add(next, after?.coverPhoto);
  for (const p of after?.photos || []) add(next, p);

  const orphans = [];
  for (const url of prev) {
    if (!next.has(url)) orphans.push(url);
  }
  return orphans;
}

/**
 * Best-effort delete of orphaned upload files + Upload docs.
 * Never throws — media refs in Mongo are already updated.
 */
async function purgeOrphanedUploads(userId, urls) {
  const list = [...new Set((urls || []).map(normalizeUploadPath).filter(Boolean))];
  if (!list.length) return;

  for (const url of list) {
    const filePath = ownedUploadFilePath(userId, url);
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (err) {
        console.warn('purge upload file failed:', filePath, err?.message || err);
      }
    }
    try {
      await Upload.deleteMany({
        userId,
        $or: [{ url }, { path: filePath || '__none__' }],
      });
    } catch (err) {
      console.warn('purge Upload doc failed:', url, err?.message || err);
    }
  }
}

module.exports = {
  normalizeUploadPath,
  ownedUploadFilePath,
  orphanedMediaUrls,
  purgeOrphanedUploads,
};
