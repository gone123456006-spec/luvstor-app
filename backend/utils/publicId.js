const User = require('../models/User');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PUBLIC_ID_REGEX = /^[A-Z]{4}[0-9]{4}$/;

/** Random ID in format ABCD1234 (4 letters + 4 digits). */
function generatePublicIdCandidate() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  }
  for (let i = 0; i < 4; i++) {
    code += String(Math.floor(Math.random() * 10));
  }
  return code;
}

/**
 * Generate a publicId that is unique across all users.
 * Retries on rare collisions.
 */
async function generateUniquePublicId(maxAttempts = 30) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generatePublicIdCandidate();
    const exists = await User.exists({ publicId: candidate });
    if (!exists) return candidate;
  }
  throw new Error('Could not generate a unique public ID');
}

/**
 * Ensure the user document has a unique publicId (backfill for older accounts).
 * Returns the publicId string.
 */
async function ensureUserPublicId(user) {
  if (!user) return null;
  if (user.publicId && PUBLIC_ID_REGEX.test(String(user.publicId).toUpperCase())) {
    user.publicId = String(user.publicId).toUpperCase();
    return user.publicId;
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const publicId = await generateUniquePublicId();
      user.publicId = publicId;
      await user.save();
      return publicId;
    } catch (err) {
      // Duplicate key race — try another code
      if (err && (err.code === 11000 || String(err.message || '').includes('duplicate'))) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Could not assign a unique public ID');
}

module.exports = {
  PUBLIC_ID_REGEX,
  generatePublicIdCandidate,
  generateUniquePublicId,
  ensureUserPublicId,
};
