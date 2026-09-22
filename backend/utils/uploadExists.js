/**
 * Check whether a media ref exists (MongoDB `/api/media/...` or legacy disk `/uploads/...`).
 */
const fs = require('fs');
const path = require('path');
const { getUploadsDir } = require('./uploadsPath');
const {
  isMediaApiPath,
  mediaExists,
} = require('../services/mediaStore');

function isUploadsPath(url) {
  const raw = String(url || '').trim().split('?')[0];
  return raw.startsWith('/uploads/');
}

/** True when this process owns the canonical media disk (legacy /uploads only). */
function isUploadsAuthoritative() {
  if (process.env.UPLOADS_AUTHORITATIVE === '1') return true;
  if (process.env.UPLOADS_AUTHORITATIVE === '0') return false;
  if (process.env.RENDER) return true;
  const dir = String(process.env.UPLOADS_DIR || '').trim();
  if (dir.startsWith('/var/data')) return true;
  return false;
}

function uploadsFsPath(url) {
  const raw = String(url || '').trim().split('?')[0].split('#')[0];
  if (!raw.startsWith('/uploads/')) return null;
  const rel = raw.slice('/uploads/'.length);
  if (!rel || rel.includes('..')) return null;
  return path.join(getUploadsDir(), rel);
}

function uploadExists(url) {
  if (isMediaApiPath(url)) {
    // Sync callers cannot await Mongo — treat Mongo media URLs as present.
    // Async validation uses mediaExistsAsync.
    return true;
  }
  const fsPath = uploadsFsPath(url);
  if (!fsPath) return false;
  try {
    return fs.existsSync(fsPath) && fs.statSync(fsPath).isFile();
  } catch {
    return false;
  }
}

async function mediaExistsAsync(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (isMediaApiPath(raw)) return mediaExists(raw);
  if (isUploadsPath(raw)) return uploadExists(raw);
  // External https (Google) — assume ok
  return /^https?:\/\//i.test(raw);
}

/**
 * Keep durable refs. Drop legacy `/uploads/...` missing on disk when authoritative.
 * Mongo `/api/media/...` always kept here (presence checked async on write).
 */
function keepIfUploadPresent(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (isMediaApiPath(raw)) {
    return raw.split('?')[0].split('#')[0];
  }
  if (!isUploadsPath(raw)) return raw;
  if (!isUploadsAuthoritative()) return raw;
  return uploadExists(raw) ? raw.split('?')[0].split('#')[0] : '';
}

module.exports = {
  isUploadsPath,
  isUploadsAuthoritative,
  uploadsFsPath,
  uploadExists,
  mediaExistsAsync,
  keepIfUploadPresent,
  isMediaApiPath,
};
