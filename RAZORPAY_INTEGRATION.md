# Razorpay Payment Integration for Token Purchases

## Overview

The app now supports real payment processing through Razorpay for token purchases. Users can buy token packs using various payment methods supported by Razorpay (UPI, Cards, Net Banking, Wallets, etc.).

## Backend Setup

### 1. Install Dependencies

Already installed: `razorpay` package in `backend/package.json`

### 2. Configure Razorpay Keys

Add your Razorpay credentials to `backend/.env`:

```env
# Razorpay Configuration
RAZORPAY_KEY_ID=your_actual_razorpay_key_id
RAZORPAY_KEY_SECRET=your_actual_razorpay_key_secret
```

**To get your Razorpay keys:**
1. Sign up at https://razorpay.com/
2. Navigate to Settings → API Keys
3. Generate Test/Live keys
4. Copy the `key_id` and `key_secret`

### 3. Backend API Endpoints

Three new endpoints have been created in `backend/routes/payment.js`:

#### POST /api/payment/create-order
- Creates a Razorpay order for token purchase
- Request: `{ packId: string }`
- Response: Order details including `orderId`, `amount`, `keyId`, etc.

#### POST /api/payment/verify
- Verifies Razorpay payment signature
- Credits tokens to user upon successful verification
- Request: `{ razorpay_order_id, razorpay_payment_id, razorpay_signature, packId }`
- Response: `{ success, verified, credited, tokenBalance }`

#### GET /api/payment/razorpay-key
- Returns public Razorpay key for frontend

### 4. Token Pack Pricing

Current pricing structure (in INR):

| Tokens   | Price    | Special Tag   |
|----------|----------|---------------|
| 10       | ₹10      |               |
| 100      | ₹80      |               |
| 500      | ₹350     |               |
| 1,000    | ₹600     | Popular       |
| 5,000    | ₹2,000   |               |
| 10,000   | ₹3,000   |               |
| 50,000   | ₹10,000  |               |
| 100,000  | ₹15,000  | Biggest deal  |

## Frontend Setup

### 1. Install Dependencies

Already installed: `react-native-razorpay` package in `frontend/package.json`

### 2. Build Configuration

**IMPORTANT:** `react-native-razorpay` requires native modules and will NOT work in Expo Go.

You have two options:

#### Option A: Development Build (Recommended)
```bash
cd frontend

# Install dependencies if not done
npm install

# Prebuild native modules
npx expo prebuild

# Run on Android (requires Android Studio)
npx expo run:android

# Run on iOS (requires Xcode on macOS)
npx expo run:ios
```

#### Option B: EAS Build
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure EAS
eas build:configure

# Create development build
eas build --profile development --platform android
# or
eas build --profile development --platform ios
```

### 3. Payment Flow

The payment flow is implemented in `frontend/utils/payment.ts` with the following steps:

1. User selects a token pack
2. User clicks "Continue" button
3. Frontend calls `POST /api/payment/create-order` to create Razorpay order
4. Razorpay checkout opens with payment options
5. User completes payment
6. Frontend receives payment details
7. Frontend calls `POST /api/payment/verify` to verify payment
8. Upon successful verification, tokens are credited to user's account
9. Balance is updated in UI

### 4. Testing

#### Test Mode (Sandbox)
Use Razorpay test keys for development. You can use test cards:

**Test Card Details:**
- Card Number: `4111 1111 1111 1111`
- CVV: Any 3 digits
- Expiry: Any future date
- Name: Any name

**Test UPI:**
- UPI ID: `success@razorpay`

#### Live Mode
Switch to live keys in production for real payments.

## Security Features

1. **Server-side verification**: Payment signature is verified on the backend to prevent tampering
2. **Token crediting**: Tokens are only credited after successful payment verification
3. **Receipt generation**: Each order has a unique receipt ID for tracking
4. **User authentication**: All payment endpoints require valid JWT token

## Error Handling

The payment flow handles various scenarios:

- Payment cancelled by user
- Payment failed
- Network errors
- Invalid signature
- Server errors

All errors are displayed to the user with appropriate messages.

## UI/UX

The token purchase UI includes:

- WhatsApp-style subscription pack list
- Visual indicators for popular/biggest deal packs
- Real-time balance updates
- Loading states during payment
- Success/failure alerts

## Customization

### Change Token Prices

Update both files:
1. `backend/routes/payment.js` - `TOKEN_PACKS` object
2. `frontend/app/(tabs)/token.tsx` - `TOKEN_PACKS` constant

### Change App Logo in Razorpay Checkout

Update in `frontend/utils/payment.ts`:
```typescript
image: 'https://your-app-logo-url.com/logo.png'
```

### Change Theme Color

Update in `frontend/utils/payment.ts`:
```typescript
theme: { color: '#8E2DE2' }
```

## Production Checklist

- [ ] Replace test Razorpay keys with live keys in `.env`
- [ ] Test payment flow with real payment methods
- [ ] Verify webhook integration (if needed for subscription features)
- [ ] Set up Razorpay webhook signatures
- [ ] Implement payment failure retry logic
- [ ] Add transaction history/receipts feature
- [ ] Configure refund policy in Razorpay dashboard
- [ ] Enable required payment methods in Razorpay dashboard
- [ ] Test on both Android and iOS devices
- [ ] Implement payment analytics tracking

## Troubleshooting

### "react-native-razorpay not found"
- Ensure you're using a development build, not Expo Go
- Run `npx expo prebuild` to generate native code

### Payment verification fails
- Check Razorpay key_secret in `.env`
- Ensure signature verification logic is correct
- Check backend logs for errors

### Payment succeeds but tokens not credited
- Check `/api/payment/verify` endpoint logs
- Verify MongoDB connection
- Check user authentication token validity

## Support

For Razorpay-specific issues:
- Documentation: https://razorpay.com/docs/
- Support: https://razorpay.com/support/

## Future Enhancements

Possible improvements:
- Add saved payment methods
- Implement subscription plans
- Add payment history/receipts
- Integrate Razorpay webhooks for automated updates
- Add refund functionality
- Implement promotional offers/discounts
- Add international payment methods
