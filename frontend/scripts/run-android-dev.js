/**
 * Native Android debug build with a reliable JDK on macOS.
 * Avoids "Unable to locate a Java Runtime" and concurrent Gradle lock failures.
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');

function resolveJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin', 'java'))) {
    return process.env.JAVA_HOME;
  }

  const candidates = [
    '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'bin', 'java'))) {
      return candidate;
    }
  }

  try {
    const home = execSync('/usr/libexec/java_home -v 17', { encoding: 'utf8' }).trim();
    if (home) return home;
  } catch {
    /* ignore */
  }

  throw new Error(
    'No JDK found. Install OpenJDK 17 (`brew install openjdk@17`) or Android Studio, then retry.',
  );
}

function resolveAndroidSdk() {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const macDefault = path.join(os.homedir(), 'Library', 'Android', 'sdk');
  if (fs.existsSync(macDefault)) return macDefault;

  throw new Error('Android SDK not found. Set ANDROID_HOME or install Android Studio SDK.');
}

function ensureLocalProperties(sdkDir) {
  const localProps = path.join(androidDir, 'local.properties');
  const content = `sdk.dir=${sdkDir.replace(/\\/g, '\\\\')}\n`;
  fs.writeFileSync(localProps, content, 'utf8');
}

function stopGradleDaemons(javaHome) {
  try {
    execSync('./gradlew --stop', {
      cwd: androidDir,
      env: { ...process.env, JAVA_HOME: javaHome, PATH: `${javaHome}/bin:${process.env.PATH}` },
      stdio: 'ignore',
    });
  } catch {
    /* ignore */
  }
}

const javaHome = resolveJavaHome();
const androidSdk = resolveAndroidSdk();
ensureLocalProperties(androidSdk);
stopGradleDaemons(javaHome);

console.log(`JAVA_HOME=${javaHome}`);
console.log(`ANDROID_HOME=${androidSdk}`);

const child = spawn('npx', ['expo', 'run:android', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  cwd: root,
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidSdk,
    ANDROID_SDK_ROOT: androidSdk,
    PATH: `${javaHome}/bin:${androidSdk}/platform-tools:${androidSdk}/emulator:${process.env.PATH}`,
  },
});

child.on('exit', (code) => process.exit(code ?? 1));
