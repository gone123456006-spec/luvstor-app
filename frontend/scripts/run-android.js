/**
 * Build/install Android with Gradle cache on D: (C: is often full on this machine).
 */
const { spawn } = require('child_process');
const path = require('path');

const gradleHome = process.env.GRADLE_USER_HOME || 'D:/gradle-cache';
const args = process.argv.slice(2);

const child = spawn('npx', ['expo', 'run:android', ...args], {
  stdio: 'inherit',
  shell: true,
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    GRADLE_USER_HOME: gradleHome,
  },
});

child.on('exit', (code) => process.exit(code ?? 1));
