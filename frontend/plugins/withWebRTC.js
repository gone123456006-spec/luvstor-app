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
    // Force RECORD_AUDIO even if another plugin (e.g. expo-camera
    // recordAudioAndroid:false) stripped it earlier in the chain.
    const app = manifest.manifest;
    if (app) {
      const list = app['uses-permission'] || [];
      const hasMic = list.some(
        (p) =>
          p?.$?.['android:name'] === 'android.permission.RECORD_AUDIO',
      );
      if (!hasMic) {
        list.push({
          $: { 'android:name': 'android.permission.RECORD_AUDIO' },
        });
        app['uses-permission'] = list;
      }
    }
    return cfg;
  });

  return config;
}

module.exports = withWebRTC;
