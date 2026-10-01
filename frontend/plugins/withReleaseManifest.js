/**
 * Expo config plugin: Play device reach + release network hardening.
 *
 * CAMERA / RECORD_AUDIO / BLUETOOTH / location / Wi-Fi permissions make Play
 * treat that hardware as required, hiding the app from devices without it.
 * Every such feature is optional in-app, so declare required="false".
 *
 * Release builds are HTTPS-only; the debug and debugOptimized manifests
 * re-enable cleartext (tools:replace) for the LAN dev server.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const OPTIONAL_FEATURES = [
  'android.hardware.camera',
  'android.hardware.camera.autofocus',
  'android.hardware.camera.front',
  'android.hardware.microphone',
  'android.hardware.bluetooth',
  'android.hardware.location',
  'android.hardware.location.gps',
  'android.hardware.location.network',
  'android.hardware.wifi',
];

module.exports = function withReleaseManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const features = manifest['uses-feature'] || [];
    for (const name of OPTIONAL_FEATURES) {
      const existing = features.find((f) => f.$['android:name'] === name);
      if (existing) existing.$['android:required'] = 'false';
      else features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    manifest['uses-feature'] = features;

    const application = manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = 'false';
    return cfg;
  });
};
