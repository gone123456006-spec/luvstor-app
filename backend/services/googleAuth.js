/**
 * Verify Google OAuth ID tokens from expo-auth-session (no Firebase client SDK).
 */
const { OAuth2Client } = require('google-auth-library');

let oauthClient = null;

function getAudiences() {
  const ids = [
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  return [...new Set(ids)];
}

function isGoogleAuthConfigured() {
  return getAudiences().length > 0;
}

function getClient() {
  if (!oauthClient) oauthClient = new OAuth2Client();
  return oauthClient;
}

/**
 * @returns {{ sub, email, name, picture, email_verified }}
 */
async function verifyGoogleIdToken(idToken) {
  const audiences = getAudiences();
  if (!audiences.length) {
    throw new Error('Google OAuth client IDs not configured on server');
  }

  const client = getClient();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: audiences,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Invalid Google token payload');
  }

  if (!payload.email) {
    throw new Error('Google account has no email');
  }

  if (payload.email_verified === false) {
    throw new Error('Google email is not verified');
  }

  return payload;
}

module.exports = {
  verifyGoogleIdToken,
  isGoogleAuthConfigured,
  getAudiences,
};
