/**
 * Expo ngrok tunnel timeout is only 10s by default — too short on many networks.
 * Patch to 120s after npm install.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '../node_modules/expo/node_modules/@expo/cli/build/src/start/server/AsyncNgrok.js'
);

if (!fs.existsSync(file)) {
  process.exit(0);
}

const src = fs.readFileSync(file, 'utf8');
const from = 'const TUNNEL_TIMEOUT = 10 * 1000;';
const to = 'const TUNNEL_TIMEOUT = 120 * 1000;';

if (src.includes(to)) {
  console.log('✓ Expo tunnel timeout already patched (120s)');
} else if (src.includes(from)) {
  fs.writeFileSync(file, src.replace(from, to));
  console.log('✓ Patched Expo tunnel timeout: 10s → 120s');
} else {
  console.warn('⚠ Could not patch Expo tunnel timeout (Expo CLI version changed)');
}
