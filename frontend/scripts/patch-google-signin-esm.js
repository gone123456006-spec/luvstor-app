const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  '@react-native-google-signin',
  'google-signin',
  'lib',
  'module',
  'index.js',
);

if (!fs.existsSync(target)) {
  console.warn('Google Sign-In module not installed; skip ESM import patch');
  process.exit(0);
}

const source = fs.readFileSync(target, 'utf8');
const unpatched = "from './signIn/GoogleSignin';";
const patched = "from './signIn/GoogleSignin.js';";

if (source.includes(patched)) {
  console.log('Google Sign-In ESM import already patched');
} else if (source.includes(unpatched)) {
  fs.writeFileSync(target, source.replace(unpatched, patched));
  console.log('Patched Google Sign-In ESM import extension');
} else {
  console.warn('Google Sign-In module shape changed; skip ESM import patch');
}