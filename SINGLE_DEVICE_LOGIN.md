# Single Device Login & Persistent Sessions

## Overview

Luvstor implements **Single Device Login** with **Persistent Sessions** to ensure:
- Users stay logged in indefinitely across app restarts, reloads, and device restarts
- Only one device can be logged in per account at any time
- Users can transfer their account to a new device via OTP verification
- Logging out immediately clears the session so another device can sign in

---

## How It Works

### 1. **Session Persistence**

```
Login → Store JWT + user in AsyncStorage
App Restart → AuthContext loads from AsyncStorage automatically
User stays logged in until they tap Logout
```

**Files:**
- `frontend/contexts/AuthContext.tsx` — Loads session on app start, waits for AsyncStorage
- `frontend/utils/auth.ts` — `getCurrentAuthUser()` checks both token and user are present
- `frontend/app/index.tsx` — Routes to tabs if user exists, welcome if not

### 2. **Device Locking**

Each account has an `activeDeviceId` on the server. Only the bound device can use the JWT.

```
Login on Device A → Generate Device ID → Store on User.activeDeviceId → Embed in JWT
Login on Device B → OTP verify → Check Device ID ≠ User.activeDeviceId → Show "Transfer Device" button
Transfer Device on B → OTP identity check → Move activeDeviceId to B → A is kicked on next API call
Logout on B → Clear activeDeviceId → A can sign in again
```

**Files:**
- `frontend/utils/device.ts` — Generate and persist stable Device ID
- `backend/models/User.js` — `activeDeviceId` field stores current device
- `backend/routes/auth.js` — `verify-otp`, `transfer-device`, `logout` endpoints
- `backend/middleware/auth.js` — Validate JWT deviceId matches User.activeDeviceId

### 3. **API Request Validation**

Every authenticated request checks device match:

```javascript
// JWT payload: { userId, deviceId }
// Server: if (user.activeDeviceId !== decoded.deviceId) → reject with 401 DEVICE_MISMATCH
// Frontend: ApiError catches DEVICE_MISMATCH → triggers setOnSessionInvalid → clears local session
```

**Files:**
- `backend/middleware/auth.js` — HTTP request validation
- `backend/socket/index.js` — WebSocket auth validation
- `frontend/utils/api.ts` — `setOnSessionInvalid()` handler for revoked sessions

---

## User Flows

### ✅ Normal Login (First Time)

```
1. Welcome screen → tap Sign In
2. Login screen → enter email → tap Send Code
3. OTP screen → receive code → enter 6 digits → tap Verify
4. AuthContext saves token + user to AsyncStorage
5. Profile creation (if not complete)
6. Tabs screen (discover, chat, profile, etc.)
7. Close app ← Session persists ✓
8. Reopen app → AuthContext loads from AsyncStorage → straight to tabs ✓
```

### ✅ Login on a Second Device (Same Account)

```
1. Device B: Welcome → Sign In → OTP screen
2. Backend: Device ID in B ≠ User.activeDeviceId (from Device A)
3. Frontend: Error "This account is already logged in on another device"
4. OTP screen shows "Transfer Device" button
5. Tap "Transfer Device" → confirm with same OTP code
6. Backend: Move activeDeviceId from A to B, issue JWT with B's deviceId
7. Device A: Next API call → JWT has B's deviceId, User has B's deviceId → 401 DEVICE_MISMATCH
8. Frontend: Session cleared, redirect to login
9. Device B: Logged in ✓
```

### ✅ Manual Logout

```
1. Profile screen → tap Logout → confirm
2. Frontend: Call `signOut()` → `logout()` → `apiLogout(token)` → clear AsyncStorage
3. Backend: `activeDeviceId` cleared on User
4. Frontend: User set to null → redirect to welcome/login
5. Another device can now sign in ✓
```

### ✅ App Restart

```
1. User logged in on Device A
2. Close app → kill process
3. Reopen app
4. RootLayout → AuthProvider → refreshSession() → load from AsyncStorage
5. Index screen → user exists → redirect to tabs
6. Straight to home, no login prompt ✓
```

### ✅ Device Reinstall / New Phone

```
1. Old Device A: Uninstall Luvstor (Device ID lost)
2. New Device B: Install Luvstor (new Device ID generated)
3. Sign in with same email → OTP screen
4. Backend: Device ID in B ≠ User.activeDeviceId (from A)
5. Error + Transfer Device option
6. Tap Transfer Device → OTP → session moves to B ✓
```

### ✅ Network Offline on Startup

```
1. User logged in (AsyncStorage has token + user)
2. Network down → close app
3. Reopen app offline
4. AuthContext: Load from AsyncStorage succeeds (no network needed)
5. User session available offline ✓
6. Tabs load with cached data
7. Network restored → sync with server
```

---

## Code Walkthrough

### **App Startup Flow**

```
_layout.tsx
  ↓
AuthProvider (wraps entire app)
  ↓
useEffect(() => refreshSession()) → calls getCurrentAuthUser()
  ↓
getCurrentAuthUser()
  • Reads auth_token from AsyncStorage
  • Reads auth_user from AsyncStorage
  • Returns user if both exist, null otherwise
  ↓
setIsInitialized(true) → render children
  ↓
index.tsx
  • if (user) → <Redirect to="/(tabs)" />
  • else → <Redirect to="/welcome" />
```

### **Login Flow**

```
login.tsx: apiSendOTP(email)
  → backend POST /api/auth/send-otp
  ↓
otp.tsx: apiVerifyOTP(email, otp, deviceId)
  → backend POST /api/auth/verify-otp
  → generate JWT with deviceId claim
  → store User.activeDeviceId
  ↓
loginWithToken(token, user)
  → completeAccountLogin()
    • Save token to auth_token (AsyncStorage)
    • Save user to auth_user (AsyncStorage)
    • Migrate account-specific data
    • Hydrate full profile from /api/users/me (catch errors)
  → setUser() in AuthContext
  ↓
resolvePostLoginRoute()
  → if (profileComplete) → /(tabs)
  → else → /create-profile
```

### **Logout Flow**

```
profile.tsx: signOut()
  ↓
AuthContext.signOut()
  → logout()
    • Get token from AsyncStorage
    • Call apiLogout(token)
      → POST /api/auth/logout
      → Backend clears User.activeDeviceId
    • Clear all AsyncStorage keys
    • Clear legacy cache
  → setUser(null)
  → bump() sessionVersion
  ↓
TabsLayout detects user === null
  → router.replace('/login')
```

### **Device Mismatch Handling**

```
apiRequest() in api.ts makes HTTP call with Authorization: Bearer <token>
  ↓
Backend middleware/auth.js
  • jwt.verify(token) → { userId, deviceId }
  • User.findById(userId)
  • if (user.activeDeviceId !== deviceId) → res.status(401).json({ code: 'DEVICE_MISMATCH' })
  ↓
Frontend api.ts apiFetch()
  • Catches error code === 'DEVICE_MISMATCH'
  • Calls setOnSessionInvalid()
    → clearLocalSessionOnly() (clear AsyncStorage, keep per-account profile data)
    → setUser(null)
    → bump() sessionVersion
  ↓
TabsLayout detects user === null
  → router.replace('/login')
```

---

## Key Constants & Storage Keys

| Key | Purpose | Scope |
|-----|---------|-------|
| `auth_token` | JWT (persists across restarts) | Global |
| `auth_user` | Current user { id, email, name, profileComplete } | Global |
| `active_account_email` | Currently logged-in email | Global |
| `luvstor_device_id` | Stable device identifier | Persists even after logout |
| `user_profile:<email>` | Per-account profile cache | Per-email, survives logout |

---

## Testing Checklist

### **Session Persistence**
- [ ] Login, close app, reopen → still logged in
- [ ] Login, restart phone, reopen app → still logged in
- [ ] Offline: load app without network, see cached session
- [ ] Profile loads correctly after restart

### **Single Device Lock**
- [ ] Login on Device A
- [ ] Device B: same email → see "already logged in" error
- [ ] Device B: tap Transfer Device + confirm OTP → B succeeds
- [ ] Device A: make any API call → kicked to login
- [ ] Device B is now the active device

### **Logout**
- [ ] Profile screen → Logout → confirm
- [ ] Redirect to welcome/login screen
- [ ] Session fully cleared (AsyncStorage empty)
- [ ] Another device can now login with same email

### **Transfer After Reinstall**
- [ ] Device A: uninstall app
- [ ] Device B (new install): same email → Transfer Device → success
- [ ] Device A: reinstall, same email → blank state (no old session)

### **Offline Behavior**
- [ ] Login with network
- [ ] Go offline
- [ ] Close and reopen app → session restored
- [ ] Tabs/chat load with cached data
- [ ] Reconnect network → sync resumes

---

## Error Codes

| Code | Meaning | User Action |
|------|---------|-------------|
| `DEVICE_IN_USE` | Account logged in on another device (HTTP 403) | Tap "Transfer Device" or logout other device |
| `DEVICE_MISMATCH` | Token device ≠ stored device (HTTP 401) | App auto-clears session, redirect to login |
| `Invalid or expired token` | JWT expired (>30 days) | Re-login |
| Network timeout | API unreachable | Retry; use cached session if available |

---

## Architecture

```
Frontend (React Native)
├── contexts/AuthContext.tsx ← Session state + persistence
├── utils/device.ts ← Device ID management
├── utils/auth.ts ← Token/user storage
├── utils/api.ts ← API client + error handling
└── app/
    ├── _layout.tsx ← AuthProvider wrapper
    ├── index.tsx ← Route guard (user → tabs | null → welcome)
    └── login.tsx, otp.tsx, profile.tsx ← Auth screens

Backend (Node.js + MongoDB)
├── models/User.js ← activeDeviceId field
├── middleware/auth.js ← JWT + deviceId validation
├── socket/index.js ← WebSocket auth
└── routes/auth.js ← OTP, verify, transfer, logout
```

---

## Configuration

No configuration needed. The system is fully automatic:
- Device ID is generated on first app install (survives logout)
- Session stored in AsyncStorage (no secure storage needed for MVP)
- JWT expires in 30 days (set in `backend/routes/auth.js`)
- Logout endpoint is protected by auth middleware

For production, consider:
- Move JWT secret to environment variable ✓ (already done)
- Use SecureStore for sensitive tokens (optional)
- Add session rotation on login
- Implement token refresh for shorter expiry
