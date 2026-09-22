/**
 * Adds Notifee's local Maven repo so Gradle can resolve `app.notifee:core`.
 * expo-build-properties alone is unreliable on newer Expo SDK subprojects.
 */
const { withProjectBuildGradle } = require('expo/config-plugins');

const NOTIFEE_MARKER = '@notifee/react-native/android/libs';
const NOTIFEE_MAVEN = `maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }`;

function addNotifeeMavenRepo(buildGradle) {
  if (buildGradle.includes(NOTIFEE_MARKER)) {
    return buildGradle;
  }

  // Prefer allprojects { repositories { ... } }
  if (/allprojects\s*\{\s*repositories\s*\{/.test(buildGradle)) {
    return buildGradle.replace(
      /allprojects\s*\{\s*repositories\s*\{/,
      (match) => `${match}\n        ${NOTIFEE_MAVEN}`,
    );
  }

  // Expo root build.gradle often uses pluginManagement / dependencyResolutionManagement
  if (/dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{/.test(buildGradle)) {
    return buildGradle.replace(
      /(dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{)/,
      `$1\n        ${NOTIFEE_MAVEN}`,
    );
  }

  // Fallback: append allprojects block
  return `${buildGradle.trimEnd()}

allprojects {
    repositories {
        ${NOTIFEE_MAVEN}
    }
}
`;
}

function withNotifee(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy') {
      cfg.modResults.contents = addNotifeeMavenRepo(cfg.modResults.contents);
    }
    return cfg;
  });
}

module.exports = withNotifee;
