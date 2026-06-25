const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Ensure uploads dir exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ─────────────────────────────────────────────
// POST /api/upload/image
// Accepts: { base64: "data:image/jpeg;base64,...", fileName: "optional.jpg" }
// Returns: { url: "http://...server.../uploads/filename.jpg" }
// ─────────────────────────────────────────────
router.post('/image', auth, (req, res) => {
  try {
    const { base64, fileName } = req.body;

    if (!base64) {
      return res.status(400).json({ error: 'base64 is required' });
    }

    // Strip the data URI prefix if present: "data:image/jpeg;base64,..."
    const matches = base64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    let ext = 'jpg';
    let data = base64;

    if (matches) {
      const mime = matches[1];
      data = matches[2];
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('gif')) ext = 'gif';
      else if (mime.includes('webp')) ext = 'webp';
    }

    const uniqueName = `img_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, uniqueName);

    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

    // Build public URL from request
    const host = `${req.protocol}://${req.get('host')}`;
    const url = `${host}/uploads/${uniqueName}`;

    res.json({ url });
  } catch (err) {
    console.error('upload/image error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

module.exports = router;
