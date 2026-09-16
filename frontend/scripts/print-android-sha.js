/**
 * Print Android signing SHA-1 / SHA-256 fingerprints used by Google Sign-In.
 * DEVELOPER_ERROR almost always means Firebase is missing the SHA of THIS keystore.
 *
 * Usage: node ./scripts/print-android-sha.js
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.join(__dirname, "..");
const keystores = [
  {
    label: "App debug.keystore (used by release APK when signingConfigs.debug)",
    file: path.join(root, "android", "app", "debug.keystore"),
    alias: "androiddebugkey",
    storePass: "android",
    keyPass: "android",
  },
  {
    label: "User ~/.android/debug.keystore",
    file: path.join(os.homedir(), ".android", "debug.keystore"),
    alias: "androiddebugkey",
    storePass: "android",
    keyPass: "android",
  },
];

function runKeytool(ks) {
  if (!fs.existsSync(ks.file)) {
    console.log(`\n• ${ks.label}\n  missing: ${ks.file}`);
    return null;
  }
  try {
    const out = execFileSync(
      "keytool",
      [
        "-list",
        "-v",
        "-keystore",
        ks.file,
        "-alias",
        ks.alias,
        "-storepass",
        ks.storePass,
        "-keypass",
        ks.keyPass,
      ],
      { encoding: "utf8" },
    );
    const sha1 = (out.match(/SHA1:\s*([0-9A-Fa-f:]+)/) || [])[1] || "";
    const sha256 = (out.match(/SHA256:\s*([0-9A-Fa-f:]+)/) || [])[1] || "";
    console.log(`\n• ${ks.label}`);
    console.log(`  file:   ${ks.file}`);
    console.log(`  SHA-1:  ${sha1}`);
    console.log(`  SHA-256:${sha256}`);
    console.log(`  compact SHA-1: ${sha1.replace(/:/g, "").toLowerCase()}`);
    return sha1;
  } catch (e) {
    console.log(`\n• ${ks.label}\n  keytool failed: ${e.message}`);
    return null;
  }
}

console.log("=== Luvstor Android signing fingerprints ===");
for (const ks of keystores) runKeytool(ks);

const gs = path.join(root, "google-services.json");
if (fs.existsSync(gs)) {
  const json = JSON.parse(fs.readFileSync(gs, "utf8"));
  const hashes = [];
  for (const client of json.client || []) {
    for (const oc of client.oauth_client || []) {
      const h = oc.android_info?.certificate_hash;
      if (h) hashes.push(h.toLowerCase());
    }
  }
  console.log("\n• google-services.json Android certificate_hash entries:");
  if (!hashes.length) console.log("  (none — re-download from Firebase after adding SHA-1)");
  else hashes.forEach((h) => console.log(`  ${h}`));
}

console.log(`
Next steps if Google Sign-In shows DEVELOPER_ERROR:
1. Firebase Console → Project settings → Your Android app (com.luvstor.app)
2. Add fingerprint → paste the App debug.keystore SHA-1 above
3. Download google-services.json into frontend/
4. Rebuild APK: npm run android:apk
`);
