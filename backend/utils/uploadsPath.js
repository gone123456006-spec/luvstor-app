/**
 * Shared uploads directory — must match express.static + upload writes.
 * On Render, set UPLOADS_DIR to a persistent disk mount (see render.yaml).
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', 'uploads');

function getUploadsDir() {
  const fromEnv = String(process.env.UPLOADS_DIR || '').trim();
  return fromEnv || DEFAULT_DIR;
}

function ensureUploadsDir() {
  const dir = getUploadsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

module.exports = {
  getUploadsDir,
  ensureUploadsDir,
  DEFAULT_DIR,
};
