/**
 * Verify Google Sign-In ID tokens for production.
 * Accepts Web / Android / iOS OAuth client IDs as audiences.
 */
const { OAuth2Client } = require('google-auth-library');

let oauthClient = null;

function cleanId(value) {
  return String(value || '').trim();
}

function getAudiences() {
  const ids = [
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    // Optional extras (comma-separated) for Play App Signing / extra clients
    ...(String(process.env.GOOGLE_CLIENT_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)),
  ]
    .map(cleanId)
    .filter(Boolean);

  return [...new Set(ids)];
}

function isGoogleAuthConfigured() {
  // Web client ID is required so native GoogleSignin can mint an ID token
  return Boolean(cleanId(process.env.GOOGLE_WEB_CLIENT_ID));
}

function getGoogleAuthStatus() {
  const audiences = getAudiences();
  return {
    configured: isGoogleAuthConfigured(),
    webClientIdSet: Boolean(cleanId(process.env.GOOGLE_WEB_CLIENT_ID)),
    androidClientIdSet: Boolean(cleanId(process.env.GOOGLE_ANDROID_CLIENT_ID)),
    iosClientIdSet: Boolean(cleanId(process.env.GOOGLE_IOS_CLIENT_ID)),
    audienceCount: audiences.length,
    // Never return full secrets — only suffixes for debugging mismatch
    audiencesPreview: audiences.map((id) => {
      const at = id.indexOf('-');
      return at > 0 ? `${id.slice(0, at)}-…${id.slice(-12)}` : '…';
    }),
  };
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
    const err = new Error('Google OAuth client IDs not configured on server');
    err.code = 'GOOGLE_NOT_CONFIGURED';
    throw err;
  }

  const client = getClient();
  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: audiences,
    });
  } catch (e) {
    const err = new Error(
      e.message?.includes('Wrong recipient') || e.message?.includes('audience')
        ? 'Google token audience mismatch. Ensure GOOGLE_WEB_CLIENT_ID / GOOGLE_ANDROID_CLIENT_ID match the app.'
        : `Invalid Google ID token: ${e.message}`,
    );
    err.code = 'GOOGLE_TOKEN_INVALID';
    err.cause = e;
    throw err;
  }

  const payload = ticket.getPayload();
  if (!payload) {
    const err = new Error('Invalid Google token payload');
    err.code = 'GOOGLE_TOKEN_INVALID';
    throw err;
  }

  if (!payload.email) {
    const err = new Error('Google account has no email');
    err.code = 'GOOGLE_NO_EMAIL';
    throw err;
  }

  if (payload.email_verified === false) {
    const err = new Error('Google email is not verified');
    err.code = 'GOOGLE_EMAIL_UNVERIFIED';
    throw err;
  }

  return payload;
}

module.exports = {
  verifyGoogleIdToken,
  isGoogleAuthConfigured,
  getAudiences,
  getGoogleAuthStatus,
};
