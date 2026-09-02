/**
 * Safe wrapper for react-native-razorpay
 * 
 * NOTE: This module requires a development build and will NOT work in Expo Go.
 * Run: npx expo prebuild && npx expo run:android
 */

// This will fail in Expo Go - that's expected
// The app shows a helpful error message when users try to make payments
let RazorpayCheckout: any = null;

try {
  const RazorpayLib = require('react-native-razorpay');
  RazorpayCheckout = RazorpayLib.default || RazorpayLib;
} catch (error: any) {
  // Expected in Expo Go - user will see friendly error when attempting payment
  console.log('react-native-razorpay not available:', error.message);
}

export { RazorpayCheckout };
export const isRazorpayAvailable = !!RazorpayCheckout;

export default RazorpayCheckout;
