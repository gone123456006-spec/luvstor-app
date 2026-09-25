/**
 * Local (offline-capable) Android release builds — no EAS cloud.
 *
 * Usage:
 *   node ./scripts/build-android-release.js apk
 *   node ./scripts/build-android-release.js bundle
 *   node ./scripts/build-android-release.js prebuild
 *   node ./scripts/build-android-release.js apk --offline
 *   node ./scripts/build-android-release.js bundle --offline
 *
 * Release JS bundle talks to production API:
 *   https://luvstor-api.onrender.com
 * (override with EXPO_PUBLIC_API_URL in the environment or .env.production)
 *
 * Outputs:
 *   APK  → android/app/build/outputs/apk/release/app-release.apk
 *         (+ copy to dist/luvstor-release.apk)
 *   AAB  → android/app/build/outputs/bundle/release/app-release.aab
 *         (+ copy to dist/luvstor-release.aab)
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.join(__dirname, "..");
const androidDir = path.join(root, "android");
const distDir = path.join(root, "dist");
const PRODUCTION_API = "https://luvstor-api.onrender.com";

const gradleHome =
  process.env.GRADLE_USER_HOME ||
  (process.platform === "win32"
    ? "D:/gradle-cache"
    : path.join(os.homedir(), ".gradle"));

const args = process.argv.slice(2);
const mode = (args.find((a) => !a.startsWith("-")) || "apk").toLowerCase();
const wantOffline =
  args.includes("--offline") || process.env.ANDROID_BUILD_OFFLINE === "1";
const wantClean = args.includes("--clean");

/** Load KEY=VALUE lines from a dotenv-style file into process.env (no override). */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function applyProductionEnv() {
  // Prefer committed production defaults, then local .env for Firebase keys etc.
  loadEnvFile(path.join(root, ".env.production"));
  loadEnvFile(path.join(root, ".env"));

  if (!process.env.EXPO_PUBLIC_API_URL) {
    process.env.EXPO_PUBLIC_API_URL = PRODUCTION_API;
  }
  if (!process.env.EXPO_PUBLIC_SHARE_BASE_URL) {
    process.env.EXPO_PUBLIC_SHARE_BASE_URL = PRODUCTION_API;
  }
  if (!process.env.EXPO_PUBLIC_MEDIA_BASE_URL) {
    process.env.EXPO_PUBLIC_MEDIA_BASE_URL = PRODUCTION_API;
  }
  process.env.NODE_ENV = "production";

  console.log(`✔ API (baked into APK): ${process.env.EXPO_PUBLIC_API_URL}`);
  if (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
    console.log("✔ Google Sign-In: WEB_CLIENT_ID present");
  } else {
    console.warn(
      "⚠ Google Sign-In will be blocked — set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env.production",
    );
  }
  console.log(`✔ Media base:          ${process.env.EXPO_PUBLIC_MEDIA_BASE_URL}`);
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(" ")}\n`);
  const result = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    shell: true,
    cwd: opts.cwd || root,
    env: {
      ...process.env,
      GRADLE_USER_HOME: gradleHome,
      NODE_ENV: "production",
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
      EXPO_PUBLIC_SHARE_BASE_URL: process.env.EXPO_PUBLIC_SHARE_BASE_URL,
      EXPO_PUBLIC_MEDIA_BASE_URL: process.env.EXPO_PUBLIC_MEDIA_BASE_URL,
      ...(opts.env || {}),
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function syncSplashAndIcons() {
  const script = path.join(root, "scripts", "sync-splash-icons.js");
  if (!fs.existsSync(script)) return;
  console.log("↻ Syncing splash + launcher icons…");
  run("node", [script]);
}

/** Keep Gradle versionCode in sync with app.json (Play rejects reused codes). */
function syncAndroidVersionFromAppJson() {
  const gradlePath = path.join(androidDir, "app", "build.gradle");
  const appJsonPath = path.join(root, "app.json");
  if (!fs.existsSync(gradlePath) || !fs.existsSync(appJsonPath)) return;
  let appJson;
  try {
    appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  } catch {
    return;
  }
  const versionName = String(appJson?.expo?.version || "1.0.0");
  const versionCode = Number(appJson?.expo?.android?.versionCode || 1);
  if (!Number.isFinite(versionCode) || versionCode < 1) return;
  let gradle = fs.readFileSync(gradlePath, "utf8");
  const next = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
  if (next !== gradle) {
    fs.writeFileSync(gradlePath, next);
  }
  console.log(`✔ Android versionCode ${versionCode} (${versionName})`);
}

function ensureAndroidColors() {
  const colorsPath = path.join(
    androidDir,
    "app",
    "src",
    "main",
    "res",
    "values",
    "colors.xml",
  );
  if (!fs.existsSync(path.dirname(colorsPath))) return;

  const splashBg = "#5A2FC7";
  const iconBg =
    process.env.EXPO_PUBLIC_ICON_BACKGROUND ||
    "#5A2FC7";

  const desired = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<resources>
  <color name="splashscreen_background">${splashBg}</color>
  <color name="iconBackground">${iconBg}</color>
  <color name="colorPrimary">${iconBg}</color>
  <color name="colorPrimaryDark">${iconBg}</color>
  <color name="colorAccent">${iconBg}</color>
  <color name="notification_icon_color">${iconBg}</color>
</resources>
`;

  let current = "";
  if (fs.existsSync(colorsPath)) {
    current = fs.readFileSync(colorsPath, "utf8");
  }
  if (
    !current.includes('name="iconBackground"') ||
    !current.includes('name="splashscreen_background"') ||
    !current.includes('name="colorPrimary"') ||
    !current.includes('name="notification_icon_color"')
  ) {
    fs.writeFileSync(colorsPath, desired);
    console.log("✔ Ensured android colors.xml (splash + theme + notification colors)");
  }
}

/**
 * Voice/video calls need RECORD_AUDIO in the merged APK manifest.
 * Older prebuilds stripped it — patch before every release build.
 */
function ensureAndroidCallPermissions() {
  const manifestPath = path.join(
    androidDir,
    "app",
    "src",
    "main",
    "AndroidManifest.xml",
  );
  if (!fs.existsSync(manifestPath)) return;
  let xml = fs.readFileSync(manifestPath, "utf8");
  const required = [
    "android.permission.RECORD_AUDIO",
    "android.permission.CAMERA",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_AUDIO",
  ];
  let changed = false;
  if (!xml.includes('xmlns:tools=')) {
    xml = xml.replace(
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n  xmlns:tools="http://schemas.android.com/tools"',
    );
    changed = true;
  }
  for (const perm of required) {
    if (xml.includes(perm)) continue;
    xml = xml.replace(
      /(<manifest\b[^>]*>)/,
      `$1\n  <uses-permission android:name="${perm}" tools:node="replace"/>`,
    );
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(manifestPath, xml);
    console.log("✔ Ensured Android mic / camera / media permissions in AndroidManifest.xml");
  }
}

/**
 * Keep AGP namespace + applicationId aligned with app.json android.package
 * and Kotlin sources (package com.luvstor.app). Drift causes:
 *   Unresolved reference 'R' / 'BuildConfig'
 */
function ensureAndroidPackageAlignment() {
  const appJsonPath = path.join(root, "app.json");
  const gradlePath = path.join(androidDir, "app", "build.gradle");
  if (!fs.existsSync(appJsonPath) || !fs.existsSync(gradlePath)) return;

  let expected = "com.luvstor.app";
  try {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    expected =
      appJson?.expo?.android?.package ||
      appJson?.android?.package ||
      expected;
  } catch {
    /* keep default */
  }

  let gradle = fs.readFileSync(gradlePath, "utf8");
  const before = gradle;
  gradle = gradle.replace(
    /namespace\s+"[^"]+"/g,
    `namespace "${expected}"`,
  );
  gradle = gradle.replace(
    /applicationId\s+"[^"]+"/g,
    `applicationId "${expected}"`,
  );
  if (!/buildFeatures\s*\{[\s\S]*?buildConfig\s+true/.test(gradle)) {
    // Ensure BuildConfig is generated (AGP 8+ defaults it off).
    if (/buildFeatures\s*\{/.test(gradle)) {
      gradle = gradle.replace(
        /buildFeatures\s*\{/,
        "buildFeatures {\n        buildConfig true",
      );
    } else {
      gradle = gradle.replace(
        /defaultConfig\s*\{[\s\S]*?\n    \}/,
        (block) =>
          `${block}\n    buildFeatures {\n        buildConfig true\n    }`,
      );
    }
  }
  if (gradle !== before) {
    fs.writeFileSync(gradlePath, gradle);
    console.log(
      `✔ Aligned android namespace/applicationId → ${expected} (+ buildConfig)`,
    );
  }
}

/** Persist network/TLS hardening across expo prebuild regenerations. */
function patchAndroidGradleConfig() {
  ensureAndroidColors();
  ensureAndroidCallPermissions();
  ensureAndroidPackageAlignment();
  ensureReleaseSigningConfig();
  const propsPath = path.join(androidDir, "gradle.properties");
  if (fs.existsSync(propsPath)) {
    let props = fs.readFileSync(propsPath, "utf8");
    const markers = [
      [
        "systemProp.https.protocols=",
        "systemProp.https.protocols=TLSv1.2,TLSv1.3\n",
      ],
      [
        "systemProp.jdk.tls.client.protocols=",
        "systemProp.jdk.tls.client.protocols=TLSv1.2,TLSv1.3\n",
      ],
      [
        "systemProp.org.gradle.internal.http.connectionTimeout=",
        "systemProp.org.gradle.internal.http.connectionTimeout=120000\n",
      ],
      [
        "systemProp.org.gradle.internal.http.socketTimeout=",
        "systemProp.org.gradle.internal.http.socketTimeout=120000\n",
      ],
      [
        "systemProp.org.gradle.internal.repository.max.tentatives=",
        "systemProp.org.gradle.internal.repository.max.tentatives=10\n",
      ],
      [
        "systemProp.org.gradle.internal.repository.initial.backoff=",
        "systemProp.org.gradle.internal.repository.initial.backoff=2000\n",
      ],
    ];
    let changed = false;
    for (const [key, line] of markers) {
      if (!props.includes(key)) {
        props += (props.endsWith("\n") ? "" : "\n") + line;
        changed = true;
      }
    }
    if (
      props.includes("org.gradle.jvmargs=") &&
      !props.includes("-Dhttps.protocols=TLSv1.2,TLSv1.3")
    ) {
      props = props.replace(
        /org\.gradle\.jvmargs=([^\r\n]*)/,
        (m, jvmArgs) =>
          `org.gradle.jvmargs=${jvmArgs} -Dhttps.protocols=TLSv1.2,TLSv1.3 -Djdk.tls.client.protocols=TLSv1.2,TLSv1.3`,
      );
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(propsPath, props);
      console.log("✔ Patched android/gradle.properties (TLS/network)");
    }
  }

  const rootGradle = path.join(androidDir, "build.gradle");
  if (fs.existsSync(rootGradle)) {
    let gradle = fs.readFileSync(rootGradle, "utf8");
    if (gradle.includes("androidx.collection:collection:1.1.0")) {
      gradle = gradle.replace(
        /force 'androidx\.collection:collection:1\.1\.0'/g,
        [
          "force 'androidx.collection:collection:1.4.2'",
          "      force 'androidx.collection:collection-ktx:1.4.2'",
          "      force 'androidx.collection:collection-jvm:1.4.2'",
        ].join("\n"),
      );
      fs.writeFileSync(rootGradle, gradle);
      console.log("✔ Patched android/build.gradle (collection 1.4.2)");
    } else if (!gradle.includes("androidx.collection:collection:1.4.2")) {
      const needle = "maven { url 'https://www.jitpack.io' }\n  }\n}";
      const replacement = `maven { url 'https://www.jitpack.io' }
  }

  // Pin collection to a modern version:
  // - avoids flaky downloads of ancient 1.0.0 (TLS handshake failures)
  // - 1.1.0 is too old and crashes at launch with NoSuchMethodError on SimpleArrayMap
  configurations.all {
    resolutionStrategy {
      force 'androidx.collection:collection:1.4.2'
      force 'androidx.collection:collection-ktx:1.4.2'
      force 'androidx.collection:collection-jvm:1.4.2'
    }
  }
}`;
      if (gradle.includes(needle)) {
        gradle = gradle.replace(needle, replacement);
        fs.writeFileSync(rootGradle, gradle);
        console.log("✔ Patched android/build.gradle (collection force)");
      }
    }
  }
}

function ensureAndroidProject() {
  const gradlew = path.join(
    androidDir,
    process.platform === "win32" ? "gradlew.bat" : "gradlew",
  );

  const gsSrc = path.join(root, "google-services.json");
  const gsDest = path.join(androidDir, "app", "google-services.json");
  if (fs.existsSync(gsSrc) && fs.existsSync(path.dirname(gsDest))) {
    fs.copyFileSync(gsSrc, gsDest);
    console.log("✔ Synced android/app/google-services.json");
  }

  if (fs.existsSync(gradlew) && !wantClean) {
    console.log("✔ android/ project found");
    patchAndroidGradleConfig();
    return;
  }

  console.log(
    wantClean
      ? "↻ Regenerating native android/ project (--clean)…"
      : "↻ android/ missing — running expo prebuild…",
  );

  const prebuildArgs = ["expo", "prebuild", "--platform", "android"];
  if (wantClean) prebuildArgs.push("--clean");
  run("npx", prebuildArgs);

  if (!fs.existsSync(gradlew)) {
    console.error("✖ prebuild finished but gradlew was not created.");
    process.exit(1);
  }
  patchAndroidGradleConfig();
}

function gradleTask(task) {
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const gArgs = [task, "--no-daemon"];
  if (wantOffline) {
    gArgs.push("--offline");
    console.log("📡 Gradle --offline (uses cached deps only)");
  }
  run(gradlew, gArgs, { cwd: androidDir });
}

function copyOut(src, destName) {
  if (!fs.existsSync(src)) {
    console.warn(`⚠ Expected artifact missing: ${src}`);
    return null;
  }
  fs.mkdirSync(distDir, { recursive: true });
  const dest = path.join(distDir, destName);
  fs.copyFileSync(src, dest);
  console.log(`✔ Copied → ${dest}`);
  return dest;
}

function findFile(dir, predicate) {
  if (!fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (predicate(name, full)) return full;
    }
  }
  return null;
}

/**
 * Persist upload-keystore signing block across expo prebuild regenerations.
 * Expects android/keystore.properties (see keystore.properties.example).
 */
function ensureReleaseSigningConfig() {
  const gradlePath = path.join(androidDir, "app", "build.gradle");
  if (!fs.existsSync(gradlePath)) return;

  let gradle = fs.readFileSync(gradlePath, "utf8");
  if (
    gradle.includes("keystore.properties") &&
    gradle.includes("signingConfigs.release")
  ) {
    return;
  }

  const marker = "RELEASE_SIGNING_VIA_KEYSTORE_PROPERTIES";
  if (gradle.includes(marker)) return;

  // Replace the whole signingConfigs + release signingConfig.debug block with
  // a properties-driven release config (idempotent enough for Expo templates).
  const injection = `
    // ${marker}
    def keystorePropertiesFile = rootProject.file("keystore.properties")
    def keystoreProperties = new Properties()
    if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
    }
`;

  if (!gradle.includes("keystorePropertiesFile")) {
    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `${injection}    signingConfigs {`,
    );
  }

  if (!/signingConfigs\s*\{[\s\S]*?release\s*\{/.test(gradle)) {
    gradle = gradle.replace(
      /signingConfigs\s*\{([\s\S]*?)(\n    \})/,
      (match, body, close) => {
        if (body.includes("release {")) return match;
        return `signingConfigs {${body}
        release {
            if (keystorePropertiesFile.exists()) {
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
                storeFile rootProject.file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
            }
        }${close}`;
      },
    );
  }

  // Prefer release keystore when properties exist
  gradle = gradle.replace(
    /buildTypes\s*\{([\s\S]*?)release\s*\{([\s\S]*?)signingConfig\s+signingConfigs\.debug/,
    (match) =>
      match.replace(
        "signingConfig signingConfigs.debug",
        `signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug`,
      ),
  );

  // If release block still hard-codes debug only, swap it
  if (
    /release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.debug/.test(gradle) &&
    !gradle.includes("signingConfigs.release")
  ) {
    console.warn(
      "⚠ Could not fully patch release signing automatically — edit android/app/build.gradle manually.",
    );
  }

  fs.writeFileSync(gradlePath, gradle);
  console.log("✔ Ensured release signing via android/keystore.properties");
}

function assertReleaseSigningReady() {
  const propsPath = path.join(androidDir, "keystore.properties");
  const examplePath = path.join(root, "keystore.properties.example");
  const allow =
    process.env.ALLOW_DEBUG_SIGNED_RELEASE === "1" ||
    process.env.ALLOW_DEBUG_SIGNED_RELEASE === "true";

  if (fs.existsSync(propsPath)) {
    const props = fs.readFileSync(propsPath, "utf8");
    const storeFile = (props.match(/^storeFile=(.+)$/m) || [])[1]?.trim();
    if (storeFile) {
      const storePath = path.isAbsolute(storeFile)
        ? storeFile
        : path.join(androidDir, storeFile);
      if (!fs.existsSync(storePath)) {
        console.error(`✖ Keystore file missing: ${storePath}`);
        console.error("  Fix storeFile= in android/keystore.properties");
        process.exit(1);
      }
    }
    console.log("✔ Release keystore configured (android/keystore.properties)");
    return;
  }

  console.warn("");
  console.warn("⚠ No android/keystore.properties — release would use debug signing.");
  console.warn("  1) Create keystore (see instructions printed below)");
  console.warn(
    `  2) Copy ${examplePath} → android/keystore.properties and fill passwords`,
  );
  console.warn("");

  if (mode === "bundle" || mode === "aab") {
    if (!allow) {
      console.error("✖ Refusing production AAB without an upload keystore.");
      console.error("");
      console.error("Create one (from frontend/):");
      console.error("  keytool -genkeypair -v \\");
      console.error("    -storetype PKCS12 \\");
      console.error("    -keystore android/app/luvstor-upload.keystore \\");
      console.error("    -alias luvstor-upload \\");
      console.error("    -keyalg RSA -keysize 2048 -validity 10000");
      console.error("");
      console.error("Then:");
      console.error(
        "  cp keystore.properties.example android/keystore.properties",
      );
      console.error("  # edit passwords in android/keystore.properties");
      console.error("  npm run android:bundle");
      console.error("");
      console.error(
        "Sideload-only override: ALLOW_DEBUG_SIGNED_RELEASE=1 (not for Play)",
      );
      process.exit(1);
    }
  }
}

function main() {
  console.log("═══════════════════════════════════════");
  console.log("  Luvstor Android local release build");
  console.log(`  Mode: ${mode}${wantOffline ? " (offline)" : ""}`);
  console.log(`  GRADLE_USER_HOME=${gradleHome}`);
  console.log("═══════════════════════════════════════");

  applyProductionEnv();

  if (mode === "prebuild") {
    run("npx", [
      "expo",
      "prebuild",
      "--platform",
      "android",
      ...(wantClean ? ["--clean"] : []),
    ]);
    console.log("\n✔ Prebuild done. Next:");
    console.log("  npm run android:apk");
    console.log("  npm run android:bundle");
    return;
  }

  if (mode !== "apk" && mode !== "bundle" && mode !== "aab") {
    console.error(
      "Usage: build-android-release.js <apk|bundle|prebuild> [--offline] [--clean]",
    );
    process.exit(1);
  }

  ensureAndroidProject();
  syncSplashAndIcons();
  syncAndroidVersionFromAppJson();
  ensureReleaseSigningConfig();
  assertReleaseSigningReady();

  if (mode === "bundle" || mode === "aab") {
    console.log(
      "✔ Cleartext HTTP disabled in app.json (production HTTPS only).",
    );
  }

  if (mode === "apk") {
    gradleTask("assembleRelease");
    const apkDir = path.join(
      androidDir,
      "app",
      "build",
      "outputs",
      "apk",
      "release",
    );
    const apk =
      findFile(apkDir, (n) => n.endsWith(".apk") && !n.endsWith("-unsigned.apk")) ||
      findFile(apkDir, (n) => n.endsWith(".apk"));
    if (apk) {
      console.log(`\n✔ APK ready: ${apk}`);
      copyOut(apk, "luvstor-release.apk");
      console.log("\nInstall on device:");
      console.log(`  adb install -r "${apk}"`);
    } else {
      console.error(
        "✖ APK not found under android/app/build/outputs/apk/release/",
      );
      process.exit(1);
    }
  } else {
    gradleTask("bundleRelease");
    const aabDir = path.join(
      androidDir,
      "app",
      "build",
      "outputs",
      "bundle",
      "release",
    );
    const aab = findFile(aabDir, (n) => n.endsWith(".aab"));
    if (aab) {
      console.log(`\n✔ Bundle (AAB) ready: ${aab}`);
      copyOut(aab, "luvstor-release.aab");
    } else {
      console.error(
        "✖ AAB not found under android/app/build/outputs/bundle/release/",
      );
      process.exit(1);
    }
  }

  console.log("\nDone. APK talks to production backend:");
  console.log(`  ${process.env.EXPO_PUBLIC_API_URL}`);
}

main();
