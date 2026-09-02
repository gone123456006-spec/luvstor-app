/**
 * Free a TCP port on Windows/macOS/Linux before starting Expo.
 * Stale Metro processes often block 8081 and break tunnel mode.
 */
const { execSync } = require('child_process');

function freePort(port) {
  const isWin = process.platform === 'win32';
  let killed = 0;

  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== String(process.pid)) {
          pids.add(pid);
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
          killed += 1;
        } catch {
          /* already gone */
        }
      }
    } else {
      execSync(`lsof -ti:${port} | xargs -r kill -9`, { stdio: 'ignore', shell: true });
      killed = 1;
    }
  } catch {
    /* port already free */
  }

  return killed;
}

module.exports = { freePort };
