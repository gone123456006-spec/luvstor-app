import { Alert, Platform } from 'react-native';
import { apiRequest } from './api';
import { RazorpayCheckout, isRazorpayAvailable } from './razorpay.native';

interface RazorpayOrderResponse {
  success: boolean;
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  packId: string;
  tokens: number;
}

interface RazorpayPaymentResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface PaymentVerificationResponse {
  success: boolean;
  verified: boolean;
  credited: number;
  tokenBalance: number;
  paymentId: string;
  orderId: string;
}

/**
 * Initiate Razorpay payment for token purchase
 */
export async function initiateTokenPurchase(
  token: string,
  packId: string,
  userName: string,
  userEmail: string
): Promise<{ success: boolean; tokenBalance?: number; error?: string }> {
  try {
    // Check if Razorpay is available (requires development build)
    if (!isRazorpayAvailable || !RazorpayCheckout) {
      Alert.alert(
        'Development Build Required',
        'Payment functionality requires a development build. Please run:\n\nnpx expo prebuild\nnpx expo run:android\n\nSee RAZORPAY_QUICK_START.md for details.',
        [{ text: 'OK' }]
      );
      return { success: false, error: 'Razorpay not available in Expo Go' };
    }

    // 1. Create order on backend
    const orderData: RazorpayOrderResponse = await apiRequest(
      '/api/payment/create-order',
      token,
      {
        method: 'POST',
        body: JSON.stringify({ packId }),
      }
    );

    if (!orderData.success) {
      return { success: false, error: 'Failed to create payment order' };
    }

    // 2. Prepare Razorpay options
    const options = {
      description: `${orderData.tokens} Tokens`,
      image: 'https://your-app-logo-url.com/logo.png', // Replace with your app logo
      currency: orderData.currency,
      key: orderData.keyId,
      amount: orderData.amount,
      name: 'Luvstor',
      order_id: orderData.orderId,
      prefill: {
        name: userName || 'User',
        email: userEmail || '',
      },
      theme: { color: '#8E2DE2' }, // Your app's primary color
    };

    // 3. Open Razorpay checkout
    const paymentResult: RazorpayPaymentResponse = await new Promise(
      (resolve, reject) => {
        RazorpayCheckout.open(options)
          .then((data: RazorpayPaymentResponse) => resolve(data))
          .catch((error: { code: number; description: string }) => {
            reject(error);
          });
      }
    );

    // 4. Verify payment on backend
    const verificationData: PaymentVerificationResponse = await apiRequest(
      '/api/payment/verify',
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          razorpay_order_id: paymentResult.razorpay_order_id,
          razorpay_payment_id: paymentResult.razorpay_payment_id,
          razorpay_signature: paymentResult.razorpay_signature,
          packId: packId,
        }),
      }
    );

    if (verificationData.success && verificationData.verified) {
      return {
        success: true,
        tokenBalance: verificationData.tokenBalance,
      };
    } else {
      return {
        success: false,
        error: 'Payment verification failed',
      };
    }
  } catch (error: any) {
    console.error('Payment error:', error);
    
    // Handle specific Razorpay errors
    if (error.code === 0) {
      // Payment cancelled by user
      return { success: false, error: 'Payment cancelled' };
    } else if (error.code === 1) {
      // Payment failed
      return { success: false, error: 'Payment failed' };
    } else if (error.code === 2) {
      // Network error
      return { success: false, error: 'Network error. Please try again.' };
    }
    
    return {
      success: false,
      error: error.description || error.message || 'Payment failed',
    };
  }
}

/**
 * Get Razorpay key from backend (optional, for additional validation)
 */
export async function getRazorpayKey(
  token: string
): Promise<{ keyId: string } | null> {
  try {
    const data = await apiRequest('/api/payment/razorpay-key', token);
    return data;
  } catch (error) {
    console.error('Failed to get Razorpay key:', error);
    return null;
  }
}
