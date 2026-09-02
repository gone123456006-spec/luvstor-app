/**
 * Shared Firebase Admin SDK bootstrap (FCM + Auth token verification).
 */
const fs = require('fs');
const path = require('path');

let app = null;
let authAdmin = null;
let initError = null;

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) {
    return JSON.parse(raw);
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const resolved = path.isAbsolute(credPath)
      ? credPath
      : path.join(__dirname, '..', credPath);
    if (fs.existsSync(resolved)) {
      return JSON.parse(fs.readFileSync(resolved, 'utf8'));
    }
  }

  const configDir = path.join(__dirname, '..', 'config');
  const preferred = path.join(configDir, 'firebase-service-account.json');
  if (fs.existsSync(preferred)) {
    return JSON.parse(fs.readFileSync(preferred, 'utf8'));
  }

  try {
    const match = fs
      .readdirSync(configDir)
      .find((name) => /firebase-adminsdk.*\.json$/i.test(name));
    if (match) {
      return JSON.parse(fs.readFileSync(path.join(configDir, match), 'utf8'));
    }
  } catch {
    /* no config dir yet */
  }

  return null;
}

function ensureApp() {
  if (app) return app;
  if (initError) return null;

  try {
    const {
      initializeApp,
      getApps,
      cert,
      applicationDefault,
    } = require('firebase-admin/app');

    if (getApps().length > 0) {
      app = getApps()[0];
      return app;
    }

    const serviceAccount = loadServiceAccount();
    if (serviceAccount) {
      app = initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      app = initializeApp({ credential: applicationDefault() });
    } else {
      initError = 'No Firebase credentials found';
      return null;
    }

    return app;
  } catch (err) {
    initError = err.message;
    console.error('❌ Firebase Admin init failed:', err.message);
    return null;
  }
}

function getAuthAdmin() {
  if (!ensureApp()) return null;
  if (!authAdmin) {
    const { getAuth } = require('firebase-admin/auth');
    authAdmin = getAuth();
  }
  return authAdmin;
}

async function verifyFirebaseIdToken(idToken) {
  const auth = getAuthAdmin();
  if (!auth) {
    throw new Error('Firebase Auth is not configured on the server');
  }
  return auth.verifyIdToken(idToken);
}

function isFirebaseAdminReady() {
  return Boolean(ensureApp());
}

function getFirebaseInitError() {
  return initError;
}

module.exports = {
  ensureApp,
  getAuthAdmin,
  verifyFirebaseIdToken,
  isFirebaseAdminReady,
  getFirebaseInitError,
  loadServiceAccount,
};
