/**
 * Config plugin: wire react-native-webrtc permissions for Expo prebuild.
 * (Official @config-plugins/react-native-webrtc targets newer Expo majors.)
 */
const {
  withAndroidManifest,
  withInfoPlist,
  AndroidConfig,
} = require('expo/config-plugins');

const ANDROID_PERMISSIONS = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.INTERNET',
];

function withWebRTC(config) {
  config = withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    plist.NSCameraUsageDescription =
      plist.NSCameraUsageDescription ||
      'Luvstor uses the camera for photos and video calls.';
    plist.NSMicrophoneUsageDescription =
      plist.NSMicrophoneUsageDescription ||
      'Luvstor uses the microphone for voice messages and voice/video calls.';
    const modes = new Set(plist.UIBackgroundModes || []);
    modes.add('audio');
    modes.add('voip');
    modes.add('remote-notification');
    plist.UIBackgroundModes = [...modes];
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    for (const permission of ANDROID_PERMISSIONS) {
      AndroidConfig.Permissions.ensurePermission(manifest, permission);
    }
    // Force RECORD_AUDIO / CAMERA even if another plugin stripped them
    // (e.g. older expo-camera recordAudioAndroid:false). tools:node=replace
    // wins the Gradle manifest merger so voice calls keep working.
    const app = manifest.manifest;
    if (app) {
      const list = app['uses-permission'] || [];
      const force = (name) => {
        const idx = list.findIndex((p) => p?.$?.['android:name'] === name);
        const entry = {
          $: {
            'android:name': name,
            'tools:node': 'replace',
          },
        };
        if (idx >= 0) list[idx] = entry;
        else list.push(entry);
      };
      force('android.permission.RECORD_AUDIO');
      force('android.permission.CAMERA');
      force('android.permission.MODIFY_AUDIO_SETTINGS');
      app['uses-permission'] = list;
      if (!app.$) app.$ = {};
      if (!app.$['xmlns:tools']) {
        app.$['xmlns:tools'] = 'http://schemas.android.com/tools';
      }
    }
    return cfg;
  });

  return config;
}

module.exports = withWebRTC;
