#!/usr/bin/env node
/**
 * Encode Firebase service account JSON for Render env var FIREBASE_SERVICE_ACCOUNT_BASE64.
 * Usage: node scripts/encodeFirebaseForRender.js path/to/service-account.json
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/encodeFirebaseForRender.js <firebase-service-account.json>');
  process.exit(1);
}

const resolved = path.resolve(file);
if (!fs.existsSync(resolved)) {
  console.error('File not found:', resolved);
  process.exit(1);
}

const json = fs.readFileSync(resolved, 'utf8');
JSON.parse(json); // validate

const b64 = Buffer.from(json, 'utf8').toString('base64');
console.log('\nPaste this into Render → Environment → FIREBASE_SERVICE_ACCOUNT_BASE64:\n');
console.log(b64);
console.log('\n(Do not commit this value to git.)\n');
