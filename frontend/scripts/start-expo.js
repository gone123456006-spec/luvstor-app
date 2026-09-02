/**
 * Start Expo on LAN with a stable IP so Android / multiple phones can scan the QR.
 * Sets REACT_NATIVE_PACKAGER_HOSTNAME to this PC's Wi‑Fi/LAN address.
 */
const os = require('os');
const { spawn } = require('child_process');
const { freePort } = require('./free-port');

const EXPO_PORT = 8081;

function getLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      candidates.push({ name, address: net.address });
    }
  }

  // Prefer typical Wi‑Fi / Ethernet adapters on Windows
  const preferred = candidates.find(
    (c) =>
      /wi-?fi|wlan|wireless|ethernet|eth/i.test(c.name) &&
      !c.address.startsWith('169.254.')
  );
  if (preferred) return preferred.address;

  // Skip link-local when possible
  const nonLinkLocal = candidates.find((c) => !c.address.startsWith('169.254.'));
  return nonLinkLocal?.address ?? candidates[0]?.address ?? null;
}

const ip = getLanIp();
const env = { ...process.env };

freePort(EXPO_PORT);

if (ip) {
  env.REACT_NATIVE_PACKAGER_HOSTNAME = ip;
  env.EXPO_PUBLIC_DEV_LAN_IP = ip;
  console.log('');
  console.log('📱 Connect phones on the SAME Wi‑Fi as this PC');
  console.log(`   Expo URL:  exp://${ip}:8081`);
  console.log(`   Backend:   http://${ip}:5000`);
  console.log('   Scan the QR in Expo Go (Android) or Camera (iOS)');
  console.log('');
} else {
  console.warn('⚠️  Could not detect LAN IP — QR may not work on physical devices.');
  console.warn('   Try: npx expo start --tunnel --go');
}

const child = spawn('npx', ['expo', 'start', '--lan', '--go', '--port', String(EXPO_PORT), ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env,
});

child.on('exit', (code) => process.exit(code ?? 0));
