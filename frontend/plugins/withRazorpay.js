const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo config plugin for react-native-razorpay
 * Adds CheckoutActivity + Android 11+ package visibility for UPI Intent (GPay, PhonePe, etc.)
 *
 * Without <queries>, targetSdk 30+ cannot see installed UPI apps, so checkout
 * hides GPay / PhonePe / Paytm / QR-intent options.
 */
const UPI_PACKAGES = [
  'com.google.android.apps.nbu.paisa.user', // Google Pay
  'com.phonepe.app', // PhonePe
  'net.one97.paytm', // Paytm
  'in.org.npci.upiapp', // BHIM
  'com.amazon.mobile.shopping', // Amazon Pay (UPI)
  'com.csam.icici.bank.imobile', // iMobile
  'com.sbi.upi', // SBI Pay
  'com.upi.axispay', // Axis Pay
  'com.snapwork.hdfc', // HDFC PayZapp / related
  'com.mobikwik_new', // MobiKwik
  'com.freecharge.android', // Freecharge
  'com.whatsapp', // WhatsApp Pay
];

function ensureUpiQueries(androidManifest) {
  if (!androidManifest.queries) {
    androidManifest.queries = [{}];
  }
  const queries = androidManifest.queries[0];
  if (!queries.package) queries.package = [];
  if (!queries.intent) queries.intent = [];

  const existingPkgs = new Set(
    queries.package.map((p) => p?.$?.['android:name']).filter(Boolean),
  );
  for (const name of UPI_PACKAGES) {
    if (!existingPkgs.has(name)) {
      queries.package.push({ $: { 'android:name': name } });
    }
  }

  const hasUpiIntent = queries.intent.some((intent) => {
    const data = intent?.data;
    if (!Array.isArray(data)) return false;
    return data.some((d) => d?.$?.['android:scheme'] === 'upi');
  });
  if (!hasUpiIntent) {
    queries.intent.push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      data: [{ $: { 'android:scheme': 'upi' } }],
    });
  }
}

const withRazorpay = (config) => {
  config = withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;

    if (!androidManifest.$) {
      androidManifest.$ = {};
    }
    if (!androidManifest.$['xmlns:tools']) {
      androidManifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    ensureUpiQueries(androidManifest);

    if (!androidManifest.application) {
      androidManifest.application = [{}];
    }

    const application = androidManifest.application[0];
    if (!application.activity) {
      application.activity = [];
    }

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
        activity.$?.['android:name'] === 'com.razorpay.CheckoutActivity',
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
