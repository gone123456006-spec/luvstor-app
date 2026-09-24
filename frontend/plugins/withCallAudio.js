/**
 * Expo config plugin: native Android call-audio router (Bluetooth SCO /
 * setCommunicationDevice). JS must not fake routes or start InCallManager
 * on Android — this module is the single AudioManager owner during calls.
 */
const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PERMISSIONS = [
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN',
  'android.permission.BLUETOOTH_CONNECT',
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyKotlin(root, filename) {
  const src = path.join(__dirname, 'call-audio', filename);
  const destDir = path.join(
    root,
    'app',
    'src',
    'main',
    'java',
    'com',
    'luvstor',
    'app',
  );
  ensureDir(destDir);
  fs.copyFileSync(src, path.join(destDir, filename));
}

function withCallAudio(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    for (const permission of PERMISSIONS) {
      AndroidConfig.Permissions.ensurePermission(manifest, permission);
    }
    const app = manifest.manifest;
    if (app) {
      const list = app['uses-permission'] || [];
      const force = (name) => {
        const idx = list.findIndex((p) => p?.$?.['android:name'] === name);
        const entry = { $: { 'android:name': name, 'tools:node': 'replace' } };
        if (idx >= 0) list[idx] = entry;
        else list.push(entry);
      };
      force('android.permission.MODIFY_AUDIO_SETTINGS');
      force('android.permission.BLUETOOTH_CONNECT');
      app['uses-permission'] = list;
      if (!app.$) app.$ = {};
      if (!app.$['xmlns:tools']) {
        app.$['xmlns:tools'] = 'http://schemas.android.com/tools';
      }
    }
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      copyKotlin(root, 'CallAudioModule.kt');
      copyKotlin(root, 'CallAudioPackage.kt');
      return cfg;
    },
  ]);

  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('CallAudioPackage')) {
      if (!src.includes('import com.luvstor.app.CallAudioPackage')) {
        src = src.replace(
          /(package\s+[^\n]+\n)/,
          '$1\nimport com.luvstor.app.CallAudioPackage\n',
        );
      }
      if (src.includes('PackageList(this).packages.apply')) {
        src = src.replace(
          /PackageList\(this\)\.packages\.apply\s*\{/,
          `PackageList(this).packages.apply {\n              add(CallAudioPackage())`,
        );
      } else if (src.includes('packages.apply {')) {
        src = src.replace(
          /packages\.apply\s*\{/,
          `packages.apply {\n              add(CallAudioPackage())`,
        );
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
}

module.exports = withCallAudio;
