const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo config plugin for react-native-razorpay
 * Adds required permissions and configurations for Razorpay payment gateway
 */
const withRazorpay = (config) => {
  // Add Android manifest configurations
  config = withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;

    // Ensure application tag exists
    if (!androidManifest.application) {
      androidManifest.application = [{}];
    }

    const application = androidManifest.application[0];

    // Add required activities for Razorpay
    if (!application.activity) {
      application.activity = [];
    }

    // Check if Razorpay activity already exists
    const hasRazorpayActivity = application.activity.some(
      (activity) =>
        activity.$?.['android:name'] === 'com.razorpay.CheckoutActivity'
    );

    if (!hasRazorpayActivity) {
      application.activity.push({
        $: {
          'android:name': 'com.razorpay.CheckoutActivity',
          'android:configChanges': 'keyboard|keyboardHidden|orientation|screenSize',
          'android:exported': 'true',
          'android:theme': '@style/CheckoutTheme',
        },
      });
    }

    return config;
  });

  return config;
};

module.exports = withRazorpay;
