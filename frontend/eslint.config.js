// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Build-time Node scripts and config plugins (never bundled into the app)
    files: ['*.config.js', 'plugins/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: { __dirname: 'readonly', __filename: 'readonly' },
    },
  },
]);
