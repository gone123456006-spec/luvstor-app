const fs = require('fs');
const path = require('path');

/**
 * Extends app.json at build time.
 *
 * `google-services.json` is required for FCM but is gitignored (it is
 * environment-specific), so it is only wired in when actually present —
 * otherwise `expo prebuild` would fail for anyone without Firebase set up.
 */
module.exports = ({ config }) => {
  const googleServices = path.join(__dirname, 'google-services.json');
  const hasGoogleServices = fs.existsSync(googleServices);

  if (!hasGoogleServices) {
    console.warn(
      '⚠️  google-services.json not found — push notifications will be disabled in this build.\n' +
        '   Download it from the Firebase console and place it in frontend/.',
    );
  }

  return {
    ...config,
    android: {
      ...config.android,
      ...(hasGoogleServices
        ? { googleServicesFile: './google-services.json' }
        : {}),
    },
    extra: {
      ...config.extra,
      pushEnabled: hasGoogleServices,
    },
  };
};
