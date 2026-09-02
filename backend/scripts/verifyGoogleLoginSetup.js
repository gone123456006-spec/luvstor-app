/**
 * Production readiness check for Google Sign-In.
 * Run: node scripts/verifyGoogleLoginSetup.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const checks = [];

function pass(name, detail) {
  checks.push({ ok: true, name, detail });
}

function fail(name, detail) {
  checks.push({ ok: false, name, detail });
}

// Backend Firebase Admin (file path OR base64 for Render)
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
const credJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (credB64 || (credJson && credJson.trim().startsWith('{'))) {
  pass('Backend service account', credB64 ? 'FIREBASE_SERVICE_ACCOUNT_BASE64 set' : 'FIREBASE_SERVICE_ACCOUNT JSON set');
} else if (credPath) {
  const resolved = path.isAbsolute(credPath)
    ? credPath
    : path.join(__dirname, '..', credPath);
  if (fs.existsSync(resolved)) {
    pass('Backend service account', resolved);
  } else {
    fail('Backend service account', `Missing file: ${resolved}`);
  }
} else {
  fail('Backend service account', 'Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_BASE64');
}

const { isFirebaseAdminReady, getFirebaseInitError } = require('../services/firebaseAdmin');
if (isFirebaseAdminReady()) {
  pass('Firebase Admin SDK', 'Initialized');
} else {
  fail('Firebase Admin SDK', getFirebaseInitError() || 'Not initialized');
}

// Frontend env (optional local file)
const frontendEnv = path.join(__dirname, '..', '..', 'frontend', '.env');
if (fs.existsSync(frontendEnv)) {
  const envText = fs.readFileSync(frontendEnv, 'utf8');
  const apiMatch = envText.match(/^EXPO_PUBLIC_API_URL=(.+)$/m);
  const apiUrl = apiMatch?.[1]?.trim();
  if (apiUrl) {
    pass('Production API URL (frontend)', apiUrl);
  } else {
    fail('Production API URL (frontend)', 'Set EXPO_PUBLIC_API_URL in frontend/.env before release APK');
  }

  const required = [
    'EXPO_PUBLIC_FIREBASE_API_KEY',
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID',
  ];
  for (const key of required) {
    const match = envText.match(new RegExp(`^${key}=(.+)$`, 'm'));
    const value = match?.[1]?.trim();
    if (value) {
      pass(key, 'Set');
    } else {
      fail(key, 'Empty in frontend/.env');
    }
  }
} else {
  fail('frontend/.env', 'File not found');
}

const googleServices = path.join(__dirname, '..', '..', 'frontend', 'google-services.json');
if (fs.existsSync(googleServices)) {
  pass('google-services.json', 'Present (good for production APK)');
} else {
  fail('google-services.json', 'Missing — download from Firebase for production Android build');
}

const { isGoogleAuthConfigured, getAudiences } = require('../services/googleAuth');

// Backend Google OAuth (must match frontend EXPO_PUBLIC_GOOGLE_*)
const bWeb = process.env.GOOGLE_WEB_CLIENT_ID;
const bAndroid = process.env.GOOGLE_ANDROID_CLIENT_ID;
if (bWeb) {
  pass('GOOGLE_WEB_CLIENT_ID (backend)', 'Set');
} else {
  fail('GOOGLE_WEB_CLIENT_ID (backend)', 'Set in Render env / backend/.env');
}
if (bAndroid) {
  pass('GOOGLE_ANDROID_CLIENT_ID (backend)', 'Set');
} else {
  fail('GOOGLE_ANDROID_CLIENT_ID (backend)', 'Set for Android token verification');
}
if (isGoogleAuthConfigured()) {
  pass('Google token verify audiences', `${getAudiences().length} client ID(s)`);
}

console.log('\n=== Google Login + Render Production Readiness ===\n');
console.log('=== Render deploy checklist ===');
console.log('1. MongoDB Atlas → Network Access → allow 0.0.0.0/0 (or Render static IPs)');
console.log('2. Render → Web Service → plan: starter (never sleeps), healthCheckPath: /health');
console.log('3. Render → Cron Job luvstor-heartbeat → pings GET /ping every 60s');
console.log('4. Set FIREBASE_SERVICE_ACCOUNT_BASE64 (run: node scripts/encodeFirebaseForRender.js)');
console.log('5. Frontend APK: EXPO_PUBLIC_API_URL=https://your-app.onrender.com');
console.log('');
let allOk = true;
for (const c of checks) {
  const icon = c.ok ? '✅' : '❌';
  console.log(`${icon} ${c.name}: ${c.detail}`);
  if (!c.ok) allOk = false;
}
console.log(allOk ? '\n✅ Config looks ready for testing.\n' : '\n❌ Fix the items above before production.\n');
process.exit(allOk ? 0 : 1);
