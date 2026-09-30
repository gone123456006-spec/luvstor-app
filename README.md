# Luvstor — Meet & Chat

Luvstor is a social / dating app for Android. People discover profiles nearby,
like each other, match, chat (text, photos, voice notes), make voice and video
calls, and meet strangers in a live random voice/video "Explore" mode. The app
earns money through **tokens** (pay-per-chat) and **subscriptions**
(Explore Plus, Gold, Platinum, Black), paid with Razorpay.

- Play Store: <https://play.google.com/store/apps/details?id=com.luvstor.app>
- Production API: <https://luvstor-api.onrender.com>
- Android package: `com.luvstor.app`

This repository holds three apps:

| Folder      | What it is                                   | Tech                                    |
|-------------|----------------------------------------------|-----------------------------------------|
| `frontend/` | The mobile app users install                 | Expo (React Native), TypeScript         |
| `backend/`  | The main API, real-time server and jobs      | Node.js, Express 5, Socket.IO, MongoDB  |
| `admin/`    | Private admin panel (server + web dashboard) | Node.js/Express + React (Vite)          |

---

## Table of contents

1. [How it all fits together](#1-how-it-all-fits-together)
2. [App features (what users can do)](#2-app-features-what-users-can-do)
3. [Tokens, subscriptions and payments](#3-tokens-subscriptions-and-payments)
4. [Frontend (mobile app)](#4-frontend-mobile-app)
5. [Backend (API + real-time)](#5-backend-api--real-time)
6. [Database (MongoDB collections)](#6-database-mongodb-collections)
7. [Admin panel](#7-admin-panel)
8. [Third-party services](#8-third-party-services)
9. [Running locally](#9-running-locally)
10. [Environment variables](#10-environment-variables)
11. [Deployment (Render + Google Play)](#11-deployment-render--google-play)
12. [Testing](#12-testing)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. How it all fits together

```
                 ┌──────────────────────────┐
                 │  Android app (Expo RN)   │
                 │  frontend/               │
                 └──────┬─────────┬─────────┘
          HTTPS (REST)  │         │  WebSocket (Socket.IO)
                        ▼         ▼
                 ┌──────────────────────────┐        ┌───────────────┐
                 │  luvstor-api (Render)    │◄──────►│ Redis         │
                 │  backend/  Express +     │        │ presence,     │
                 │  Socket.IO + cron jobs   │        │ caches, push  │
                 └──┬──────────┬────────┬───┘        │ queue (BullMQ)│
                    │          │        │            └───────────────┘
                    ▼          ▼        ▼
            ┌──────────┐ ┌─────────┐ ┌──────────────────────────────┐
            │ MongoDB  │ │ Firebase│ │ Razorpay · Brevo/SMTP email · │
            │ Atlas    │ │ FCM push│ │ Google Sign-In · TURN server  │
            └────▲─────┘ └─────────┘ └──────────────────────────────┘
                 │
     ┌───────────┴──────────────┐
     │ luvstor-admin (Render)   │  reads the same MongoDB; calls the
     │ admin/ server + web UI   │  main API with ADMIN_API_KEY for
     └──────────────────────────┘  actions (ban, notify, verify…)
```

- **REST API** handles login, profiles, discovery, likes, payments, uploads, etc.
- **Socket.IO** handles live chat, typing / read receipts, online presence,
  call signaling and Explore matchmaking.
- **Voice/video media** goes **peer-to-peer over WebRTC**; the server only
  relays signaling. A TURN server relays media when phones can't connect
  directly (mobile data, strict Wi-Fi).
- **Push notifications** go through Firebase Cloud Messaging (FCM), queued with
  BullMQ on Redis. On the phone, Notifee shows rich notifications and the
  full-screen incoming-call UI.
- **Photos, voice notes and selfies** are stored in MongoDB (`MediaAsset`) and
  served from `/api/media/:id` (legacy files also live on the Render disk at
  `/var/data/uploads`).

---

## 2. App features (what users can do)

### Sign up & login
- **Email OTP login**: enter email → 6-digit code by email (Brevo API or SMTP)
  → verified. Rate-limited sends, resend cooldown, max verify attempts.
- **Google Sign-In** (native): the app gets a Google ID token and the backend
  verifies it with Google.
- **Single-device login**: an account is active on one phone at a time. Logging
  in on a new phone offers a **device transfer**; the old phone is signed out.
- **Profile setup**: name, age, gender, *Show me* (who you want to see),
  relationship goal, interests, height, bio, main photo, cover photo and up to
  6 gallery photos. Every user gets a unique public ID like `ABCD1234`.
- **Account deletion** with a grace period (restore by logging in again),
  reminder emails and permanent deletion by a scheduled job.

### Discover (home tab)
- **Nearby**: people around you (geospatial query, up to 100 km), ordered by a
  per-viewer **7-day rotation** so you see fresh faces every day.
- **For You**: a recommendation feed scored on distance, activity, profile
  quality, shared interests, verification etc. Ranked results are cached in Redis.
- **Online now** strip: people nearby who are online right now.
- **Preferences**: *Show me* (gender), distance limit and *Last active* window.
  These are strict filters, never relaxed to "fill" the feed.
- **Search by public ID**, profile view with photos, like / unlike.
- Paid plans get a **Discover boost** and daily **Top spot** (Black).

### Likes, matches & connections
- Like someone → they get a like notification. If they like you back it's a
  **match** ("It's a match!") and you become friends/connected.
- Requests list, likes list, friends list, unfriend.
- **Profile views**: who viewed your profile (Gold, Platinum, Black).

### Chat
- One-to-one chat over Socket.IO with REST fallback.
- Text, **photos**, **view-once photos**, **voice messages**, replies.
- Delivered / read ticks, typing indicator, online / last seen.
- Mute, archive, delete conversation, unread counts.
- **Chat starters / icebreakers** suggested after a match.
- **Token-gated chat**: starting a chat session costs tokens (see §3); plans
  make sessions longer.

### Voice & video calls
- WhatsApp-style calls between connected users: ringing, accept/decline,
  busy, missed, heartbeat, reconnect, camera/mic toggles, speaker/Bluetooth
  routing, call quality reporting.
- Native **foreground service** keeps the call alive in the background, and a
  full-screen incoming-call notification wakes the phone.
- **Call history** screen.

### Explore (live random matching)
- Tap to meet a random stranger by **voice** or **video** (separate queues).
- Anonymous cards: no real name, photo or ID is shared. Skip to the next person.
- Explore Plus and higher plans unlock Explore preferences (who to meet,
  verified-only).

### Photo verification
- Live selfie with a random pose challenge. After ~30 minutes the backend
  compares the selfie with the profile photos and **approves or rejects**
  (optionally AWS Rekognition face compare). Admins can also approve/reject.
- Approved profiles get a **verified badge** and a one-time token bonus.
- The user gets a push + in-app notification for approve **and** reject.

### Notifications
- Push (FCM) + in-app Notification Center for: messages, calls, likes,
  matches, profile views, tokens/wallet, security, system and promotions.
- Per-category preferences in Settings, message-preview privacy.
- **Smart notifications**: daily "suggested for you" digest, re-engagement
  nudges, streaks, spin-ready reminders — with frequency caps.

### Safety
- Block / unblock, report a profile (reasons).
- **Automatic warning** when a user has been reported by 3 different people
  ("2 more reports may lead to a permanent block").
- Admins review reports and can **permanently block (ban)** accounts.
- Safety Center, Help & Support tickets, screen-capture protection on
  sensitive screens.

### Growth features
- **Refer & earn**: share your invite link; when a friend installs and logs
  in, you get **50 tokens** (max 5 referrals per month). Attribution works via
  the Google Play install referrer and short links (`/go/:slug`, `/r/:code`).
- **Share profile** links (`/u/:publicId`).
- **Daily open streak**, **daily lucky spin** for free tokens.
- **Rate the app**: "Rate us" in Profile opens the Play Store, plus Google's
  in-app review popup after happy moments (new match / active chatting).

---

## 3. Tokens, subscriptions and payments

### Tokens
| Rule                                  | Value                      |
|---------------------------------------|----------------------------|
| Cost to open a chat session           | 10 tokens                  |
| Free chat session length              | 2 hours                    |
| Max messages in a row without a reply | 10                         |
| Welcome bonus (profile completed)     | 50 tokens                  |
| Photo verification bonus              | 30 tokens                  |
| Gallery photo bonus                   | 5 tokens per photo         |
| Referral reward                       | 50 tokens (max 5 / month)  |
| Daily spin                            | free tokens (reward cycle) |

**Token packs** (`backend/services/tokenPacks.js`, prices in INR):
10 → ₹10 · 100 → ₹80 · 500 → ₹350 · 1,000 → ₹600 · 5,000 → ₹2,000 ·
10,000 → ₹3,000 · 50,000 → ₹10,000 · 100,000 → ₹15,000

### Subscription plans (`backend/services/subscriptions.js`)
| Plan         | Price (monthly)                     | Chat session | Token bonus | Monthly tokens | Spins/day | Extras                                   |
|--------------|-------------------------------------|--------------|-------------|----------------|-----------|------------------------------------------|
| Free         | —                                   | 2 h          | —           | —              | 1         |                                          |
| Explore Plus | ₹99                                 | 2 h          | —           | —              | 1         | Explore preferences                      |
| Gold         | ₹349 (₹899 / 3 mo, ₹1,999 / yr)     | 6 h          | +10%        | 100            | 2         | Gold badge, profile views                |
| Platinum     | ₹699 (₹1,799 / 3 mo, ₹4,199 / yr)   | 12 h         | +25%        | 350            | 4         | Badge, Discover boost, profile views     |
| Black        | ₹1,499 (₹3,499 / 3 mo, ₹8,999 / yr) | 24 h         | +40%        | 1,200          | unlimited | Badge, boost, daily 40-min Top spot      |

6-month prices also exist for Gold/Platinum/Black.

### Payment flow (Razorpay)
1. App calls `POST /api/payment/create-order` (tokens) or
   `POST /api/subscriptions/create-order` (plans).
2. Razorpay checkout opens in the app.
3. App sends the result to `.../verify`; the backend checks the Razorpay
   signature, then credits tokens / activates the plan (idempotent — the same
   payment can't be credited twice). `POST /api/subscriptions/recover` fixes
   paid-but-not-activated cases.

---

## 4. Frontend (mobile app)

**Stack:** Expo SDK 57 · React Native 0.86 (New Architecture, Hermes) ·
React 19 · TypeScript · Expo Router (file-based routes) · Reanimated ·
socket.io-client · react-native-webrtc · Notifee · Firebase Messaging ·
Google Sign-In · Razorpay · expo-location / camera / image-picker / audio.

### Folder structure
```
frontend/
├── app/                    # Screens (Expo Router — file name = route)
│   ├── (tabs)/             # Bottom tabs
│   │   ├── index.tsx       #   Discover (Nearby + For You)
│   │   ├── explore.tsx     #   Explore — random voice/video
│   │   ├── chat.tsx        #   Chats, likes, requests
│   │   ├── token.tsx       #   Wallet: balance, spin, token packs
│   │   └── profile.tsx     #   My profile + menu
│   ├── welcome.tsx, login.tsx, otp.tsx, create-profile.tsx
│   ├── messages/[id].tsx   # Chat thread
│   ├── calls.tsx           # Call history
│   ├── notifications.tsx   # Notification Center
│   ├── photo-verify.tsx    # Selfie verification
│   ├── refer.tsx           # Refer & earn
│   ├── subscription.tsx    # Plans & purchase
│   ├── settings/, profile/, delete-account/
│   ├── safety-center.tsx, help-support.tsx, blocked.tsx
│   └── u/, r/, go/         # Deep-link handlers (profile, referral, short link)
├── components/             # Reusable UI (avatars, modals, call overlay…)
├── contexts/               # Auth, Socket, Call, Push, Explore providers
├── hooks/                  # useGoogleAuth, useNearbyFeed, …
├── services/webrtc.ts      # WebRTC peer connection logic
├── utils/                  # API clients, caches, helpers (api.ts, auth.ts…)
├── config/                 # Google OAuth config
├── plugins/                # Expo config plugins (native Android changes)
│   ├── withWebRTC.js, withCallForegroundService.js, withCallAudio.js
│   ├── withNotifee.js, withFcmAndroid.js, withRazorpay.js
├── scripts/                # build-android-release.js, print-android-sha.js
├── android/                # Generated native project (gitignored — prebuild)
├── app.json                # Expo config: version, package, plugins, R8
└── google-services.json    # Firebase Android config
```

### Key ideas
- **State**: React contexts (`AuthContext`, `SocketContext`, `CallContext`,
  `PushContext`, `ExploreContext`) plus small module-level stores and caches
  (`nearbyStore`, `chatListCache`, `threadCache`, `profileCache`) for instant
  screens. AsyncStorage / SecureStore persist the session.
- **API**: `utils/api.ts` builds the base URL from `EXPO_PUBLIC_API_URL`, adds
  the JWT and device ID, and applies timeouts.
- **Real-time**: one Socket.IO connection (`SocketContext`) with automatic
  reconnect and heartbeats.
- **Calls**: `CallContext` + `services/webrtc.ts` + native Kotlin modules in
  `android/app/src/main/java/com/luvstor/app/` (`CallForegroundService`,
  `CallAudioModule`) created by the config plugins.
- **Release build**: R8 code shrinking + obfuscation is enabled
  (`expo-build-properties` in `app.json`); keep rules protect WebRTC, Notifee,
  Razorpay and the app's own native modules.

---

## 5. Backend (API + real-time)

**Stack:** Node.js ≥ 20 · Express 5 · Socket.IO 4 (+ Redis adapter) ·
Mongoose 9 (MongoDB) · ioredis · BullMQ · firebase-admin · Razorpay ·
nodemailer / Brevo · jsonwebtoken · express-rate-limit.

### Folder structure
```
backend/
├── index.js          # App entry: Express, routes, Socket.IO, jobs, health
├── routes/           # REST endpoints (one file per area)
├── services/         # Business logic (discovery, calls, payments, push…)
├── models/           # Mongoose schemas (MongoDB collections)
├── socket/index.js   # All Socket.IO events (chat, presence, calls, explore)
├── middleware/       # auth (JWT + single device), adminAuth, rate limits
├── jobs/             # Scheduled jobs (deletion, daily digest, cleanup…)
├── utils/            # Helpers (presence, redis, email, bans, media URLs…)
├── config/           # SMTP + profile limits
├── scripts/          # Maintenance / diagnostics scripts
└── tests/            # node:test suites
```

### REST API overview
All `/api/*` routes need `Authorization: Bearer <JWT>` except login and public
links. Admin routes need the `x-admin-key` header (`ADMIN_API_KEY`).

| Base path            | Main endpoints                                                                                                         |
|----------------------|------------------------------------------------------------------------------------------------------------------------|
| `/api/auth`          | `send-otp`, `verify-otp`, `google`, `transfer-device`, `sync-device`, `logout`, `delete-account`, `restore-account`    |
| `/api/users`         | `GET/PUT me`, `PUT location`, `profile/:userId`, `search-by-id`, `nearby`, `online-nearby`                             |
| `/api/recommendations` | `for-you`                                                                                                            |
| `/api/friends`       | `like`, `unlike`, `requests`, `accept`, `decline`, `list`, `likes`, `status/:userId`, `unfriend`, `block`, `unblock`, `blocked`, `report` |
| `/api/chat`          | `history/:id`, `conversations`, `send`, `poll/:id`, `view-once/:id`, `delete`, `unread-count`, `mute`, `archive`, `unarchive`, `conversation/:id` |
| `/api/calls`         | `ice-servers`, `active`, `:callId/accept`, `:callId/decline`, `history`                                                |
| `/api/upload`        | `image`, `image-bin`, `audio`, `audio-bin`, `verify/:uploadId`, `my-files`                                              |
| `/api/media`         | `:id` — serves stored images / audio                                                                                   |
| `/api/tokens`        | `balance`, `chat-access`, `ensure-session`, `spin`, `purchase`                                                          |
| `/api/payment`       | `packs`, `create-order`, `verify`, `razorpay-key`                                                                       |
| `/api/subscriptions` | `plans`, `status`, `create-order`, `verify`, `recover`                                                                  |
| `/api/verification`  | `challenge`, `me`, `selfie`, admin: `admin/pending`, `admin/:userId`                                                   |
| `/api/notifications` | list, `unread-count`, `read`, `unread`, delete, `preferences`; admin: `send`, `broadcast`, `admin/logs`, `admin/health` |
| `/api/devices`       | `register`, `unregister` (FCM tokens)                                                                                   |
| `/api/engagement`    | `view`, `nudge`, `stats`, `chat-starters/:id`, `icebreaker/:id`                                                         |
| `/api/referrals`     | `me`, `claim`, `ensure-code`                                                                                            |
| `/api/share`         | `profile/:publicId`, `me/profile`, `me/referral`, `resolve/:slug`                                                       |
| `/api/retention`     | `open`, `streak`                                                                                                        |
| `/api/support`       | `tickets` (create/list/get); admin ticket management                                                                    |
| `/api/admin`         | `reports`, `reports/stats`, `reports/:id`, `users/:id/ban`, `users/:id/unban`                                           |
| Public pages         | `/u/:publicId` (profile), `/r/:code` (referral), `/go/:slug` (short link) — open the app or the Play Store             |
| Health               | `/health` (liveness), `/ready` (Mongo + Redis), `/ping` (heartbeat)                                                     |

### Socket.IO events
| Area     | Events                                                                                                                                                                           |
|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Chat     | `chat:join`, `chat:leave`, `chat:message`, `chat:typing`, `chat:read`, `chat:delete`, `chat:image-preview`, `chat:view-once-open`, `chat:heartbeat`                             |
| Presence | `presence:ping`, `presence:away`, `disconnect`                                                                                                                                   |
| Calls    | `call:invite`, `call:respond`, `call:accept`, `call:decline`, `call:cancel`, `call:offer`, `call:answer`, `call:ice-candidate`, `call:renegotiate`, `call:connected`, `call:media-state`, `call:quality`, `call:heartbeat`, `call:sync`, `call:end` |
| Explore  | `explore:join`, `explore:leave`, `explore:skip`                                                                                                                                  |

### Important services
- `discovery.js`, `discoveryRotation.js`, `onlineNearby.js`, `forYou.js`,
  `recommendations.js`: the Discover feeds (geo queries, 7-day rotation,
  scoring, Redis caching).
- `calls.js`: call sessions, busy locks, ring/heartbeat timeouts, ICE config.
- `exploreMatchmaking.js`: anonymous random voice/video queues.
- `notifications.js`, `pushQueue.js`, `fcm.js`: create notifications, apply
  preferences, dedupe, queue and send FCM pushes.
- `photoFaceMatch.js`: pose challenge + selfie vs profile photo matching.
- `subscriptions.js`, `tokenPacks.js`, `chatTokens.js`: monetisation rules.
- `referrals.js`, `shareLinks.js`: invite codes, short links, install referrer.
- `utils/presence.js`: cross-instance online status (WhatsApp-style grace).

### Scheduled jobs (`backend/jobs/`)
- `accountDeletion.js`: deletion reminders + permanent deletion.
- `dailySuggestions.js`: daily digest of missed likes, matches and visits.
- `engagingNotificationScheduler.js`: smart re-engagement notifications.
- `deviceTokenCleanup.js`: removes dead FCM tokens.
- Jobs use a Redis-based leader lock (`utils/cronLeader.js`) so only one
  instance runs them.

### Security
- JWT auth bound to one active device; banned / deleted accounts are blocked
  in middleware.
- Rate limits on OTP, uploads, verification and reports (Redis-backed).
- Uploads must belong to the requesting user; block privacy is enforced
  everywhere (blocked users can't see / message / call you).
- Admin endpoints use a constant-time key check; secrets only live in env vars.

---

## 6. Database (MongoDB collections)

MongoDB Atlas, accessed with Mongoose. Main models (`backend/models/`):

| Model                                                           | Purpose                                                                                                                                                                                                                                                           |
|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `User`                                                          | Account + profile: email, googleUid, publicId, name, age, gender, showMe, bio, interests, photos, `location` (GeoJSON, 2dsphere index), photoVerification, tokenBalance, subscriptionPlan / expiry, discoveryPrefs, explorePrefs, referral fields, notificationPrefs, online / lastSeen, activeDeviceId, ban and deletion flags |
| `Friendship`                                                    | Like / match / friends / declined / blocked state between two users                                                                                                                                                                                               |
| `Message`                                                       | Chat messages (text, image, audio, view-once, reply, read / delivered)                                                                                                                                                                                             |
| `ConversationState`                                             | Per-user chat state: mute, archive, unread, session info                                                                                                                                                                                                          |
| `Call`                                                          | Call history (type, direction, status, duration)                                                                                                                                                                                                                  |
| `Notification`                                                  | In-app Notification Center rows (type, title, body, deep link, read, dedupeKey)                                                                                                                                                                                   |
| `NotificationPreference`, `NotificationHistory`, `NotificationLog` | Smart-notification settings, send history, delivery logs                                                                                                                                                                                                      |
| `DeviceToken`                                                   | FCM push tokens per device                                                                                                                                                                                                                                        |
| `Report`                                                        | User reports (reporter, reported, reason, status)                                                                                                                                                                                                                 |
| `Referral`                                                      | Successful referrals (referrer, referee, tokens awarded)                                                                                                                                                                                                          |
| `ShortLink`                                                     | Share slugs for profile / referral links + click counts                                                                                                                                                                                                           |
| `MediaAsset`, `Upload`                                          | Stored images / audio and upload records                                                                                                                                                                                                                          |
| `ProfileView`                                                   | Who viewed whose profile                                                                                                                                                                                                                                          |
| `DiscoveryImpression`, `RecommendationImpression`, `RecommendationScore` | Discovery / For You exposure and scoring history                                                                                                                                                                                                        |
| `ContactMatch`, `SearchHistory`                                 | Explore matches and search history                                                                                                                                                                                                                                |
| `SupportTicket`                                                 | Help & Support tickets                                                                                                                                                                                                                                            |
| `OTP`                                                           | Email login codes (expiring)                                                                                                                                                                                                                                      |

**Redis** (optional locally, used in production) stores presence, feed caches,
rate-limit counters, the BullMQ push queue and the Socket.IO adapter state.

---

## 7. Admin panel

`admin/` is a separate app, deployed as its own Render service
(`luvstor-admin`). It reads the same MongoDB and calls the main API (with
`MAIN_ADMIN_API_KEY` = the API's `ADMIN_API_KEY`) for actions.

- **Server**: `admin/server/` — Express, bcrypt passwords, JWT session cookie,
  login lockout, helmet, role-based permissions, full **audit log**.
- **Web**: `admin/web/` — React + Vite dashboard.

**Pages:** Overview · Users (search, detail, tokens, logout, restore,
verification, **permanent block / unblock**, send a notification to one user)
· Reports & safety · Notifications (to one user or broadcast to all users,
scheduling) · Support tickets · Subscriptions (filter by plan) · Revenue
(Razorpay totals, charts, payment health) · Engagement · System health ·
Audit log · Admins · Change password.

**Roles:** `owner`, `admin`, `moderator`, `support`, `analyst` (each with its
own permissions — see `admin/server/lib/permissions.js`).

```bash
cd admin
npm install
cp .env.example .env              # fill in values
npm run create-admin              # create the first owner account
npm run dev                       # server; run `npm run dev:web` for the UI
npm run build && npm start        # production
```

---

## 8. Third-party services

| Service                      | Used for                                                 |
|------------------------------|----------------------------------------------------------|
| **MongoDB Atlas**            | Main database                                            |
| **Render**                   | Hosting: API (starter plan, 5 GB disk), admin, Redis, heartbeat cron |
| **Redis** (Render)           | Presence, caches, rate limits, BullMQ push queue         |
| **Firebase**                 | Cloud Messaging (push) + Android app config              |
| **Google Sign-In**           | Login with Google (OAuth client IDs in Google Cloud)     |
| **Brevo / SMTP**             | OTP and account emails                                   |
| **Razorpay**                 | Token and subscription payments (INR)                    |
| **STUN / TURN** (e.g. Metered) | WebRTC call connectivity                               |
| **AWS Rekognition** (optional) | Face comparison for photo verification                 |
| **Google Play**              | Distribution, app signing, install referrer, in-app review |

---

## 9. Running locally

**Requirements:** Node.js 20+, npm, MongoDB (local or Atlas), Android Studio +
SDK (for native builds), JDK 17. Redis is optional locally.

### Backend
```bash
cd backend
npm install
cp .env.example .env        # set MONGODB_URI, JWT_SECRET, email settings…
npm run dev                 # http://localhost:5000
npm run check:env           # sanity-check production env values
```

### Mobile app
```bash
cd frontend
npm install
cp .env.example .env        # EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:5000
npm run android:dev         # dev build on a connected phone / emulator
npx expo start              # start Metro for the dev client
```
Native features (Google Sign-In, calls, Razorpay, push) need a **dev build**,
not Expo Go.

### Admin
See [§7](#7-admin-panel).

---

## 10. Environment variables

Never commit `.env` files (they are gitignored). Names only — values live in
your local `.env` and in the Render dashboard.

**Backend (`backend/.env`)**
- Core: `NODE_ENV`, `PORT`, `MONGODB_URI`, `MONGO_POOL_SIZE`, `JWT_SECRET`,
  `REDIS_URL`, `PUBLIC_API_URL`, `UPLOADS_DIR`, `JSON_BODY_LIMIT`, `CORS_ORIGIN`
- Admin / heartbeat: `ADMIN_API_KEY`, `HEARTBEAT_SECRET`
- Email / OTP: `BREVO_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
  `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`,
  `SMTP_DEV_MODE`, `OTP_EXPIRY_MINUTES`, `OTP_MAX_SENDS_PER_HOUR`,
  `OTP_MAX_VERIFY_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`
- Google login: `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`,
  `GOOGLE_CLIENT_IDS`
- Push: `FIREBASE_SERVICE_ACCOUNT_BASE64`, `PUSH_CONCURRENCY`,
  `PUSH_MAX_ATTEMPTS`, `PUSH_BACKOFF_MS`, `NOTIFICATION_TTL_DAYS`
- Payments: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- Calls: `STUN_URLS`, `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`,
  `CALL_RING_TIMEOUT_MS`, `CALL_HEARTBEAT_TIMEOUT_MS`
- Discovery / digest: `DISCOVERY_ROTATION_TZ_OFFSET_MINUTES`,
  `DAILY_SUGGESTION_*`, `DISCOVERY_MAX_RADIUS_METRES`
- Sharing: `PUBLIC_SHARE_BASE_URL`, `PUBLIC_SHARE_EXTERNAL_READY`,
  `ONELINK_TEMPLATE_PATH`, `ANDROID_PACKAGE_ID`, `ANDROID_PLAY_STORE_URL`
- Verification: `FACE_MATCH_PROVIDER`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`
- Play review login: `PLAY_REVIEW_LOGIN_ENABLED`, `PLAY_REVIEW_LOGIN_EMAIL`,
  `PLAY_REVIEW_LOGIN_OTP`

**Frontend (`frontend/.env`)** — baked into the app at build time:
`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_MEDIA_BASE_URL`,
`EXPO_PUBLIC_SHARE_BASE_URL`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`,
`EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`, `EXPO_PUBLIC_FIREBASE_*`

**Admin (`admin/.env`)**: `MONGODB_URI`, `ADMIN_JWT_SECRET`, `MAIN_API_URL`,
`MAIN_ADMIN_API_KEY`, `MEDIA_BASE_URL`, `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `PORT`, `NODE_ENV`, `TRUST_PROXY`,
`ADMIN_SESSION_HOURS`

Env values on Render must **not** have surrounding quotes.

---

## 11. Deployment (Render + Google Play)

### Backend & admin (Render)
- `render.yaml` defines **luvstor-api** (root `backend`, health `/health`,
  persistent disk at `/var/data/uploads`), **luvstor-redis** and the
  **luvstor-heartbeat** cron (pings `/ping` every minute).
- **luvstor-admin**: root `admin`, build `npm install && npm run build`,
  start `npm start`, health `/healthz`.
- Both **auto-deploy when `main` is pushed** to GitHub.

### Custom share domain (optional)
Point `link.luvstor.com` (CNAME → `luvstor-api.onrender.com`) and add it as a
custom domain in Render, then set `PUBLIC_SHARE_BASE_URL=https://link.luvstor.com`,
`PUBLIC_SHARE_EXTERNAL_READY=1`, `ONELINK_TEMPLATE_PATH=go`. Until then,
profile / referral links use the Play Store URL (the API host is never shared).

### Android release (Google Play)
1. Bump `version` and `android.versionCode` in `frontend/app.json` (and
   `android/app/build.gradle` if the native folder exists).
2. Build the signed bundle:
   ```bash
   cd frontend && npm run android:bundle
   ```
   Output: `frontend/android/app/build/outputs/bundle/release/app-release.aab`
   (signed with the upload key from `android/keystore.properties`).
3. Upload to Play Console (Internal testing → Production).

**Google Sign-In on Play builds:** Firebase must contain the SHA-1 of every key
that signs the app: debug key, upload key, the **Play app signing** key and the
**internal app sharing** key (Play Console → App integrity). Print local keys
with `npm run android:sha`.

---

## 12. Testing

```bash
cd backend
npm test                                  # all node:test suites
MONGO_TEST_URI=mongodb://127.0.0.1:27017 npm test   # use a local scratch DB
```
Test suites only ever write to their own `luvstor_*_test` databases. Calls:
see `TESTING_CALLS.md`. Scaling notes: `backend/SCALE.md`.

```bash
cd admin && npm test                      # admin unit tests
cd frontend && npm run lint               # app lint
```

---

## 13. Troubleshooting

| Problem                                        | Fix                                                                                                        |
|------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| Google Sign-In `DEVELOPER_ERROR`               | Add the SHA-1 of the key that signed the installed app to Firebase (see §11). Check with `apksigner verify --print-certs` on the installed APK. |
| Render `MongoParseError`                       | Remove quotes around `MONGODB_URI` in Render env.                                                          |
| Render "Root directory admin does not exist"   | Push the admin commit to `main`.                                                                           |
| Calls connect on Wi-Fi but not on mobile data  | Configure `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL`.                                               |
| No push notifications                          | Check `FIREBASE_SERVICE_ACCOUNT_BASE64`, device registered via `/api/devices/register`, notification permission on the phone. |
| OTP email not arriving                         | Check Brevo / SMTP env, run `node scripts/testBrevoOtp.js`.                                                |
| Release build very slow / out of memory        | Gradle heap is set to 4 GB by `scripts/build-android-release.js` (R8 needs it).                            |
