/**
 * Keeps the committed `android/` folder aligned with FCM requirements when
 * `npx expo prebuild` runs. Without google-services + notification_icon,
 * killed-app / background FCM never appears in the tray.
 */
const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withAndroidManifest,
  withAndroidColors,
  AndroidConfig,
} = require('expo/config-plugins');

const GMS_CLASSPATH = "classpath('com.google.gms:google-services:4.4.4')";
const GMS_APPLY = "apply plugin: 'com.google.gms.google-services'";
const NOTIFICATION_ICON_COLOR = '#5A2FC7';

function withFcmAndroid(config) {
  config = withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    let contents = cfg.modResults.contents;
    if (!contents.includes('com.google.gms:google-services')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n        ${GMS_CLASSPATH}`,
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    let contents = cfg.modResults.contents;
    if (!contents.includes("com.google.gms.google-services")) {
      contents = `${contents.trimEnd()}\n\n${GMS_APPLY}\n`;
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  // Required by expo-notifications / clipboard / imagepicker manifests
  config = withAndroidColors(config, (cfg) => {
    cfg.modResults = AndroidConfig.Colors.assignColorValue(cfg.modResults, {
      name: 'notification_icon_color',
      value: NOTIFICATION_ICON_COLOR,
    });
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    const ensureMeta = (name, value, type = 'value') => {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(
        app,
        name,
        value,
        type,
      );
    };

    ensureMeta(
      'com.google.firebase.messaging.default_notification_icon',
      '@drawable/notification_icon',
      'resource',
    );
    ensureMeta(
      'com.google.firebase.messaging.default_notification_color',
      '@color/notification_icon_color',
      'resource',
    );
    ensureMeta(
      'com.google.firebase.messaging.default_notification_channel_id',
      'system',
      'value',
    );
    ensureMeta(
      'expo.modules.notifications.default_notification_icon',
      '@drawable/notification_icon',
      'resource',
    );
    ensureMeta(
      'expo.modules.notifications.default_notification_color',
      '@color/notification_icon_color',
      'resource',
    );

    cfg.modResults = manifest;
    return cfg;
  });

  return config;
}

module.exports = withFcmAndroid;
