#!/usr/bin/env node
/**
 * Production env checklist — never prints secret values.
 * Usage: node scripts/checkProductionEnv.js
 */
require('dotenv').config({ override: true });

const REQUIRED = [
  'MONGODB_URI',
  'JWT_SECRET',
  'PUBLIC_API_URL',
  'BREVO_API_KEY',
  'SMTP_FROM_EMAIL',
  'FIREBASE_SERVICE_ACCOUNT_BASE64',
  'GOOGLE_WEB_CLIENT_ID',
  'GOOGLE_ANDROID_CLIENT_ID',
  'TURN_URLS',
  'TURN_USERNAME',
  'TURN_CREDENTIAL',
];

const RECOMMENDED = [
  'REDIS_URL',
  'UPLOADS_DIR',
  'PUBLIC_SHARE_BASE_URL',
  'HEARTBEAT_SECRET',
  'ADMIN_API_KEY',
  'GOOGLE_CLIENT_IDS',
  'STUN_URLS',
  'CALL_HEARTBEAT_TIMEOUT_MS',
  'CALL_RING_TIMEOUT_MS',
  'JSON_BODY_LIMIT',
];

const fail = [];
const warn = [];
const ok = [];

function present(k) {
  const v = process.env[k];
  return !!(v && String(v).trim());
}

for (const k of REQUIRED) {
  if (present(k)) ok.push(k);
  else fail.push(`MISSING required: ${k}`);
}

for (const k of RECOMMENDED) {
  if (present(k)) ok.push(k);
  else warn.push(`Unset recommended: ${k}`);
}

const turn = String(process.env.TURN_URLS || '').trim();
const first = turn.split(',')[0]?.trim() || '';
if (turn && !/^turns?:/i.test(first)) {
  fail.push('TURN_URLS must start with turn: or turns: (not an API key)');
}
if (/^[a-f0-9]{20,}$/i.test(turn) && !turn.includes(':')) {
  fail.push('TURN_URLS looks like a Metered API key — paste iceServers URLs instead');
}

if (process.env.ADMIN_API_KEY === 'dev_admin_key_change_in_production') {
  fail.push('ADMIN_API_KEY is still the default — rotate it');
}
if (process.env.HEARTBEAT_SECRET === 'change_me_heartbeat_secret') {
  warn.push('HEARTBEAT_SECRET is still the placeholder');
}
if (process.env.JWT_SECRET === 'change_this_to_a_long_random_secret') {
  fail.push('JWT_SECRET is still the example placeholder');
}

const hb = Number(process.env.CALL_HEARTBEAT_TIMEOUT_MS || 0);
if (hb && hb < 45_000) {
  warn.push(`CALL_HEARTBEAT_TIMEOUT_MS=${hb} — prefer 60000 for WhatsApp-like flaps`);
}

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.UPLOADS_DIR) {
  warn.push('UPLOADS_DIR unset — on Render set /var/data/uploads (persistent disk)');
}
if (isProd && !process.env.REDIS_URL) {
  warn.push('REDIS_URL unset — required for multi-instance / reliable presence on Render');
}

const publicApi = String(process.env.PUBLIC_API_URL || '');
if (publicApi && /localhost|127\.0\.0\.1/i.test(publicApi)) {
  fail.push('PUBLIC_API_URL must be your https production host, not localhost');
}

console.log('── Luvstor production env check ──');
console.log(`NODE_ENV=${process.env.NODE_ENV || '(unset)'}`);
console.log(`PUBLIC_API_URL=${publicApi || '(unset)'}`);
console.log(`CALL_HEARTBEAT_TIMEOUT_MS=${process.env.CALL_HEARTBEAT_TIMEOUT_MS || '(default)'}`);
console.log(`UPLOADS_DIR=${process.env.UPLOADS_DIR || '(default ./uploads)'}`);
console.log(`ok keys: ${ok.length}`);
if (warn.length) {
  console.log('\nWarnings:');
  warn.forEach((w) => console.log('  ⚠', w));
}
if (fail.length) {
  console.log('\nFailures:');
  fail.forEach((f) => console.log('  ✖', f));
  process.exit(1);
}
console.log('\n✓ Required keys present. Deploy backend so /api/upload/audio-bin exists, then rebuild APK.');
process.exit(0);
