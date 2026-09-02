/**
 * Expo tunnel mode — works when phone and PC are on different networks.
 * Requires @expo/ngrok (devDependency).
 */
const os = require('os');
const { spawn } = require('child_process');
const { freePort } = require('./free-port');

const EXPO_PORT = 8081;

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        return net.address;
      }
    }
  }
  return null;
}

const freed = freePort(EXPO_PORT);
if (freed > 0) {
  console.log(`🔄 Freed port ${EXPO_PORT} (stopped ${freed} stale process${freed > 1 ? 'es' : ''})`);
}

const lanIp = getLanIp();
const env = {
  ...process.env,
  CI: '1',
  ...(lanIp ? { EXPO_PUBLIC_DEV_LAN_IP: lanIp } : {}),
};

console.log('');
console.log('🌐 Starting Expo with tunnel (ngrok)...');
console.log('   Tunnel can take up to 2 minutes on first connect — please wait.');
if (lanIp) {
  console.log(`   Backend API: http://${lanIp}:5000 (phone must reach this IP)`);
}
console.log('');

const args = ['expo', 'start', '--tunnel', '--go', '--port', String(EXPO_PORT)];
if (process.argv.includes('--clear') || process.argv.includes('-c')) {
  args.push('--clear');
}

const child = spawn('npx', args, {
  stdio: 'inherit',
  shell: true,
  env,
});

child.on('exit', (code) => {
  if (code !== 0) {
    console.log('');
    console.log('❌ Tunnel failed. Try this instead (same Wi‑Fi, works best for Android):');
    console.log('   npm start');
    console.log('');
    console.log('If you need tunnel: stop VPN, allow Node.js in Firewall, retry.');
    console.log('');
  }
  process.exit(code ?? 0);
});
