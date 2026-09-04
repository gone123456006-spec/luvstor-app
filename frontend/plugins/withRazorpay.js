const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo config plugin for react-native-razorpay
 * Adds required permissions and configurations for Razorpay payment gateway
 */
const withRazorpay = (config) => {
  // Add Android manifest configurations
  config = withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;

    // Ensure tools namespace for tools:replace on CheckoutActivity
    if (!androidManifest.$) {
      androidManifest.$ = {};
    }
    if (!androidManifest.$['xmlns:tools']) {
      androidManifest.$['xmlns:tools'] =
        'http://schemas.android.com/tools';
    }

    // Ensure application tag exists
    if (!androidManifest.application) {
      androidManifest.application = [{}];
    }

    const application = androidManifest.application[0];

    // Add required activities for Razorpay
    if (!application.activity) {
      application.activity = [];
    }

    // Align with razorpay:standard-core (exported=false) and force merge
    const razorpayAttrs = {
      'android:name': 'com.razorpay.CheckoutActivity',
      'android:configChanges':
        'keyboard|keyboardHidden|orientation|screenSize',
      'android:exported': 'false',
      'android:theme': '@style/CheckoutTheme',
      'tools:replace': 'android:exported',
    };

    const existing = application.activity.find(
      (activity) =>
        activity.$?.['android:name'] === 'com.razorpay.CheckoutActivity'
    );

    if (existing) {
      existing.$ = { ...existing.$, ...razorpayAttrs };
    } else {
      application.activity.push({ $: razorpayAttrs });
    }

    return config;
  });

  return config;
};

module.exports = withRazorpay;
