# Testing Video & Voice Calls - Quick Guide

## ⚠️ IMPORTANT: You MUST Use a Production/Development Build

**Expo Go does NOT support video/voice calls** because it doesn't include the react-native-webrtc native module.

### Option 1: Build APK (Recommended)
```bash
cd frontend
npm run android:apk
```
This will create a production APK in `frontend/android/app/build/outputs/apk/release/`

### Option 2: Build Development Client
```bash
npx eas build --profile development --platform android
```

---

## 📱 Testing Steps

### 1. Prerequisites
- **2 Android devices** (or 1 Android + 1 iOS device)
- Both devices on **same or different WiFi/mobile network**
- Backend server running (`npm run dev` in `backend/`)
- Frontend Metro bundler running (`npx expo start` in `frontend/`)

### 2. Install & Setup
1. Install the APK on both devices
2. Sign in with different accounts on each device
3. Make sure both users are friends (match + chat)

### 3. Grant Permissions
When first opening the app or starting a call:
- ✅ Allow Camera access
- ✅ Allow Microphone access

### 4. Test Voice Call

**Device A (Caller):**
1. Open chat with Device B's user
2. Tap the **phone icon** (top right)
3. You should see: "Calling..." → "Ringing..."

**Device B (Callee):**
1. Should see incoming call overlay with Device A's name/photo
2. Tap green **Accept** button
3. Call should connect

**During Call:**
- Test **Mute** button → other person can't hear you
- Test **Speaker** button → audio switches to speaker
- Test **End** button → call ends

### 5. Test Video Call

**Device A (Caller):**
1. Open chat with Device B's user
2. Tap the **video camera icon** (top right)
3. You should see: Your camera preview → "Calling..." → "Ringing..."

**Device B (Callee):**
1. Should see incoming video call overlay
2. Tap green **Accept** button (with video icon)
3. Call should connect with video

**During Call:**
- Test **Camera On/Off** button → your video toggles
- Test **Flip Camera** button → switches front/back camera
- Test **Mute** button → your audio mutes
- Test **Speaker** button → audio switches
- Test **Minimize** (chevron down) → call continues in floating bar
- Tap floating bar → restore full screen
- Test **End** button → call ends

### 6. Test Call History
1. After ending a call, open the **Calls** tab
2. You should see the call logged with:
   - Voice/Video icon
   - Duration (if call was answered)
   - Incoming/Outgoing arrow
   - Call status
3. Tap a call log → Should navigate to chat

---

## ✅ Expected Behavior

### Voice Call Success
```
✅ Audio from Device A → Device B works
✅ Audio from Device B → Device A works
✅ Mute toggles correctly
✅ Speaker toggles correctly
✅ Duration timer updates every second
✅ End call works from either device
✅ Call history shows correct duration
```

### Video Call Success
```
✅ Video from Device A → Device B displays
✅ Video from Device B → Device A displays
✅ Audio works both ways
✅ Camera toggle shows/hides video
✅ Flip camera switches front/back
✅ Mute/Speaker work
✅ PiP shows your video in corner
✅ Remote video fills screen
✅ Minimize → floating bar works
✅ Call history shows "video" icon
```

---

## 🐛 Troubleshooting

### Problem: "Expo Go does not include WebRTC"
**Solution**: You're using Expo Go. Build and install the APK instead.

### Problem: Call starts but no audio
**Solutions**:
1. Check microphone permission was granted
2. Tap **Speaker** button to switch audio output
3. Check device volume is not muted
4. Restart app and try again

### Problem: Call starts but no video (black screen)
**Solutions**:
1. Check camera permission was granted
2. Try tapping **Camera** button to toggle off and on
3. Try **Flip Camera** button
4. Close any other apps using camera
5. Restart app and try again

### Problem: "User is offline" even when online
**Solutions**:
1. Check backend server is running
2. Check Socket.io is connected (look for green status in app)
3. Kill and restart both apps
4. Check network connectivity

### Problem: "User is busy on another call"
**Solution**: End the existing call first, or wait for it to timeout.

### Problem: Calls immediately end or timeout
**Solutions**:
1. Make sure both users are **friends** (you can only call friends)
2. Check neither user has **blocked** the other
3. Check backend logs for errors
4. Ensure network allows WebRTC (not blocked by firewall)

### Problem: Poor quality / choppy audio/video
**Solutions**:
1. Check network quality indicator (top right during call)
2. Switch to better WiFi/mobile network
3. Move closer to router (if on WiFi)
4. Reduce video quality by upgrading voice → video instead of starting with video

---

## 📊 What to Check

### Backend Logs
When a call is initiated, you should see in backend terminal:
```
[calls] create: c_xxxxx status=ringing
[calls] accept: c_xxxxx
[calls] end c_xxxxx status=ended reason=hangup dur=45s
```

### Frontend Console
Open React Native DevTools and check for:
```
[Call] audio mode: OK
[WebRTC] peer created
[WebRTC] local stream ready
[WebRTC] remote stream received
```

---

## 🎯 Final Checklist

Before reporting "calls are working":

- [ ] Built production APK (not using Expo Go)
- [ ] Installed APK on 2 real devices
- [ ] Granted camera + microphone permissions
- [ ] Both users are signed in and are friends
- [ ] Backend server is running
- [ ] Made a voice call → Audio works both ways
- [ ] Made a video call → Video/audio works both ways
- [ ] Tested all call controls (mute, speaker, camera, flip, end)
- [ ] Tested minimize → floating bar
- [ ] Checked call history logs the call
- [ ] Tested declining an incoming call
- [ ] Tested canceling an outgoing call

---

## 📞 Quick Test Commands

### Build APK
```bash
cd frontend
npm run android:apk
# APK location: frontend/android/app/build/outputs/apk/release/app-release.apk
```

### Start Backend
```bash
cd backend
npm run dev
# Should show: "🚀 Luvstor server running on port 5000"
```

### Start Frontend (Dev Mode)
```bash
cd frontend
npx expo start
# Scan QR with development build, or use:
npx expo start --dev-client
```

---

**If all tests pass, video and voice calls are fully working! 🎉**

Any issues? Check the main documentation file: `CALL_FEATURE_DOCUMENTATION.md`
