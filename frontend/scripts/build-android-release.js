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
 * Outputs:
 *   APK  → android/app/build/outputs/apk/release/app-release.apk
 *         (+ copy to dist/luvstor-release.apk)
 *   AAB  → android/app/build/outputs/bundle/release/app-release.aab
 *         (+ copy to dist/luvstor-release.aab)
 *
 * Gradle cache defaults to D:/gradle-cache (same as android:build).
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const androidDir = path.join(root, "android");
const distDir = path.join(root, "dist");
const gradleHome = process.env.GRADLE_USER_HOME || "D:/gradle-cache";

const args = process.argv.slice(2);
const mode = (args.find((a) => !a.startsWith("-")) || "apk").toLowerCase();
const wantOffline = args.includes("--offline") || process.env.ANDROID_BUILD_OFFLINE === "1";
const wantClean = args.includes("--clean");

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(" ")}\n`);
  const result = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    shell: true,
    cwd: opts.cwd || root,
    env: {
      ...process.env,
      GRADLE_USER_HOME: gradleHome,
      ...(opts.env || {}),
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/** Persist network/TLS hardening across expo prebuild regenerations. */
function patchAndroidGradleConfig() {
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
        (m, args) =>
          `org.gradle.jvmargs=${args} -Dhttps.protocols=TLSv1.2,TLSv1.3 -Djdk.tls.client.protocols=TLSv1.2,TLSv1.3`,
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
    // Upgrade stale 1.1.0 pin (crashes on launch) to 1.4.2
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
  const gradlew =
    process.platform === "win32" ? "gradlew.bat" : "./gradlew";
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

function main() {
  console.log("═══════════════════════════════════════");
  console.log("  Luvstor Android local release build");
  console.log(`  Mode: ${mode}${wantOffline ? " (offline)" : ""}`);
  console.log(`  GRADLE_USER_HOME=${gradleHome}`);
  console.log("═══════════════════════════════════════");

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
    console.error('Usage: build-android-release.js <apk|bundle|prebuild> [--offline] [--clean]');
    process.exit(1);
  }

  ensureAndroidProject();

  if (mode === "apk") {
    gradleTask("assembleRelease");
    const apkDir = path.join(androidDir, "app", "build", "outputs", "apk", "release");
    const apk =
      findFile(apkDir, (n) => n.endsWith(".apk") && !n.endsWith("-unsigned.apk")) ||
      findFile(apkDir, (n) => n.endsWith(".apk"));
    if (apk) {
      console.log(`\n✔ APK ready: ${apk}`);
      copyOut(apk, "luvstor-release.apk");
    } else {
      console.error("✖ APK not found under android/app/build/outputs/apk/release/");
      process.exit(1);
    }
  } else {
    // bundle | aab
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

  console.log("\nDone.");
}

main();
