# Quick Start: Razorpay Integration

## Step 1: Get Razorpay Keys

1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Sign up or log in
3. Navigate to **Settings** → **API Keys**
4. Click **Generate Test Key** or **Generate Live Key**
5. Copy both `Key ID` and `Key Secret`

## Step 2: Configure Backend

Edit `backend/.env` and replace the placeholders:

```env
# Replace with your actual Razorpay credentials
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

## Step 3: Restart Backend Server

```bash
cd backend
npm run dev
```

## Step 4: Setup Frontend (Important!)

**Note:** Since `react-native-razorpay` requires native modules, you MUST create a development build.

### Option A: Local Development Build

```bash
cd frontend

# Prebuild native code
npx expo prebuild

# For Android
npx expo run:android

# For iOS (macOS only)
npx expo run:ios
```

### Option B: EAS Cloud Build

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Login
eas login

# Configure project
eas build:configure

# Create development build for Android
eas build --profile development --platform android

# Install the APK on your device
```

## Step 5: Test Payment

1. Open the app
2. Navigate to **Tokens** tab
3. Select a token pack
4. Click **Continue**
5. Razorpay checkout will open
6. Use test credentials:
   - **Card:** 4111 1111 1111 1111
   - **CVV:** Any 3 digits
   - **Expiry:** Any future date
   - **UPI:** success@razorpay

7. Complete payment
8. Tokens should be credited immediately

## Common Issues

### "react-native-razorpay module not found"
**Solution:** You're running in Expo Go. You need a development build:
```bash
npx expo prebuild
npx expo run:android
```

### Payment succeeds but tokens not credited
**Solution:** Check backend logs and ensure:
- MongoDB is connected
- Razorpay keys are correct in `.env`
- Backend server is running

### "Invalid Razorpay key"
**Solution:** 
- Verify you copied the entire key ID and secret
- Ensure no extra spaces in `.env` file
- Restart backend after updating `.env`

## Testing Checklist

- [ ] Backend running with correct Razorpay keys
- [ ] Frontend running as development build (not Expo Go)
- [ ] Can select token pack
- [ ] Razorpay checkout opens
- [ ] Test payment succeeds
- [ ] Tokens credited to balance
- [ ] Balance updates in UI

## Go Live Checklist

1. **Switch to Live Keys**
   - Get live keys from Razorpay dashboard
   - Update `backend/.env` with live keys
   - Restart backend

2. **Enable Payment Methods**
   - Go to Razorpay Dashboard → Settings → Payment Methods
   - Enable desired payment options (UPI, Cards, Net Banking, etc.)

3. **Configure Webhooks (Optional but Recommended)**
   - Razorpay Dashboard → Settings → Webhooks
   - Add webhook URL: `https://your-domain.com/api/payment/webhook`
   - Select events: `payment.authorized`, `payment.failed`, `payment.captured`

4. **Test with Real Money**
   - Make a small test purchase (₹10)
   - Verify tokens are credited
   - Check Razorpay dashboard for transaction

5. **Deploy**
   - Deploy backend with live keys
   - Build and publish app with EAS or Play Store/App Store

## Support

- **Razorpay Docs:** https://razorpay.com/docs/
- **Expo Docs:** https://docs.expo.dev/
- **React Native Razorpay:** https://github.com/razorpay/react-native-razorpay

## Need Help?

Check the detailed documentation in `RAZORPAY_INTEGRATION.md`
