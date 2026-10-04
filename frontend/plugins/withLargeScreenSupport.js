/**
 * Expo config plugin: large-screen (tablet / foldable) support for Android 16.
 *
 * Play flags manifest `screenOrientation` locks. Following Android's guidance,
 * phones stay portrait via a runtime lock (smallest width < 600dp) while
 * tablets and unfolded foldables follow the device. The ML Kit code-scanner
 * activity (via expo-camera) ships its own portrait lock — stripped at merge.
 */
const { withAndroidManifest, withMainActivity } = require('expo/config-plugins');

const MLKIT_SCANNER_ACTIVITY =
  'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity';

const MARKER = 'applyOrientationPolicy';

function withManifestUnlocked(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const application = manifest.application?.[0];
    if (!application) return cfg;
    const activities = application.activity || [];

    for (const activity of activities) {
      if (activity.$['android:name'] === '.MainActivity') {
        delete activity.$['android:screenOrientation'];
      }
    }

    if (!activities.some((a) => a.$['android:name'] === MLKIT_SCANNER_ACTIVITY)) {
      activities.push({
        $: {
          'android:name': MLKIT_SCANNER_ACTIVITY,
          'tools:remove': 'android:screenOrientation',
        },
      });
    }
    application.activity = activities;
    return cfg;
  });
}

function withPhonePortraitLock(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;

    for (const imp of ['android.content.pm.ActivityInfo', 'android.content.res.Configuration']) {
      if (!src.includes(`import ${imp}`)) {
        src = src.replace(/(package\s+[^\n]+\n)/, `$1import ${imp}\n`);
      }
    }

    src = src.replace(
      /(\n\s*)super\.onCreate\(/,
      `$1${MARKER}(resources.configuration)$1super.onCreate(`,
    );

    src = src.replace(
      /\n}\s*$/,
      `

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    // Folding / unfolding changes the smallest width without recreating the activity
    ${MARKER}(newConfig)
  }

  /** Phones stay portrait; tablets and unfolded foldables (sw600dp+) rotate freely. */
  private fun ${MARKER}(config: Configuration) {
    val desired =
        if (config.smallestScreenWidthDp in 1 until 600) ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    if (requestedOrientation != desired) requestedOrientation = desired
  }
}
`,
    );

    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withLargeScreenSupport(config) {
  return withPhonePortraitLock(withManifestUnlocked(config));
};
