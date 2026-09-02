# Push Notification System

Firebase Cloud Messaging (FCM) end to end: permission handling, token
lifecycle, a persisted + queued delivery pipeline, and the in-app Notification
Center.

Notifications travel over two channels at once:

| Channel | Transport | When it applies |
| --- | --- | --- |
| In-app | Socket.IO (`notification:new`) | App is open — instant, no FCM round trip |
| Push | FCM via `firebase-admin` | App is backgrounded or closed |

Both are written to MongoDB first, so history and the unread badge are correct
regardless of which one reached the user.

---

## 1. Firebase setup (one time)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Add app → Android.** Use the package name from `frontend/app.json`
   (`expo.android.package`; if unset, Expo derives it from the slug — set it
   explicitly before building).
3. Download **`google-services.json`** and save it to `frontend/google-services.json`.
   It is gitignored; `frontend/app.config.js` wires it in automatically when
   present and warns when it isn't.
4. **Project settings → Service accounts → Generate new private key.** This JSON
   is the server credential — never ship it in the app.

### Backend credentials

Set exactly one of these in `backend/.env`:

```bash
# 1. Full JSON on one line
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...", ...}

# 2. Base64 of that JSON (easiest for most hosts)
FIREBASE_SERVICE_ACCOUNT_BASE64=eyJ0eXBlIjoi...

# 3. Path handled by the Google SDK
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

For local development you can instead drop the file at
`backend/config/firebase-service-account.json` (gitignored).

Also set the admin key used by the send/broadcast endpoints:

```bash
ADMIN_API_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

On boot the server logs either `🔔 FCM initialised` or
`FCM disabled (no credentials)`. **When disabled the app still works** — only
push delivery is skipped.

### Build the app

Remote push does not work in Expo Go (SDK 53 removed it). You need a dev build:

```bash
cd frontend
npx expo prebuild --clean
npx expo run:android          # or: eas build --profile development --platform android
```

---

## 2. Architecture

```
feature code ──► services/notifications.js ──┬─► MongoDB (Notification)
                                             ├─► Socket.IO (instant, in-app)
                                             └─► services/pushQueue.js
                                                      │  retries + backoff
                                                      ▼
                                                 services/fcm.js
                                                      │
                                                      ├─► FCM ──► device
                                                      ├─► NotificationLog (audit)
                                                      └─► invalid tokens deleted
```

### Backend files

| File | Responsibility |
| --- | --- |
| `models/Notification.js` | History, types, dedupe/group keys, push status |
| `models/DeviceToken.js` | One row per device; unique FCM token |
| `models/NotificationLog.js` | Per-attempt delivery audit (TTL 30 days) |
| `services/fcm.js` | firebase-admin init, multicast send, error classification |
| `services/deviceTokens.js` | Register/remove tokens, failure tracking |
| `services/pushQueue.js` | Bounded-concurrency queue, backoff retries, drain on shutdown |
| `services/notifications.js` | The single entry point every feature calls |
| `routes/notifications.js` | Notification Center + preferences + admin send |
| `routes/devices.js` | Token registration |
| `jobs/deviceTokenCleanup.js` | Prunes dead/stale tokens every 6 h |
| `middleware/adminAuth.js` | Constant-time admin key check |
| `middleware/rateLimit.js` | Per-user limiters |

### Frontend files

| File | Responsibility |
| --- | --- |
| `utils/push.ts` | Permissions, channels, FCM token, badge, tray dismissal, routing |
| `contexts/PushContext.tsx` | Lifecycle: register, refresh, handlers, deep links |
| `utils/notifications.ts` | Notification Center API client |
| `app/notifications.tsx` | Notification Center UI |

---

## 3. Sending a notification

Everything goes through one function:

```js
const { createNotification } = require('./services/notifications');

await createNotification(io, {
  userId: recipientId,      // required
  type: 'chat',             // required — see the type table
  title: 'New message',     // required
  body: 'Hey there!',
  actorId: senderId,        // fills actorName / actorPhoto and rewrites the copy
  groupKey: `chat:${roomId}`,
  deepLink: `/messages/${senderId}`,
  imageUrl: 'https://…',
  priority: 'high',
  dedupeKey: 'unique-key',  // repeats are silently ignored
  push: true,               // false = in-app only
  data: { roomId },
});
```

Fan out to many users, or to everyone:

```js
await createBulkNotifications(io, [id1, id2], { type: 'promo', title: '50% off' });
await broadcastNotification(io, { type: 'system', title: 'Scheduled maintenance' });
```

### Types, channels and defaults

| Type | Android channel | Priority | Deep link |
| --- | --- | --- | --- |
| `chat` | `messages` | high | `/messages/:userId` |
| `call` | `calls` | high | `/messages/:userId` |
| `match` | `social` | high | `/(tabs)/chat` |
| `like` | `social` | high | `/(tabs)/chat` |
| `friend_request` | `social` | high | `/(tabs)/chat` |
| `friends` | `social` | high | `/(tabs)/chat` |
| `token`, `token_purchase`, `token_low`, `spin`, `subscription` | `wallet` | normal | `/(tabs)/token` |
| `security` | `security` | high | `/settings/account` |
| `system` | `system` | normal | `/notifications` |
| `promo` | `promotions` | low | `/notifications` |

Where they are already wired in:

- `socket/index.js` — new message, incoming call
- `routes/chat.js` — message sent over REST
- `routes/friends.js` — like, friend request, match, request accepted
- `routes/tokens.js` — spin reward, spin available, purchase, low balance
- `routes/payment.js` — payment verified
- `routes/auth.js` — new device sign-in, account deactivation
- `jobs/accountDeletion.js` — deletion reminder

---

## 4. API reference

All user endpoints require `Authorization: Bearer <jwt>`.

### Notification Center

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/notifications?limit=25&cursor=<ISO>&filter=unread&type=chat` | Cursor pagination; returns `nextCursor`, `hasMore`, `unread` |
| `GET` | `/api/notifications/unread-count` | `{ unread }` |
| `POST` | `/api/notifications/read` | `{ ids: [] }` or `{ all: true }` |
| `POST` | `/api/notifications/unread` | `{ ids: [] }` |
| `DELETE` | `/api/notifications/:id` | Delete one |
| `DELETE` | `/api/notifications` | Clear all |
| `GET` | `/api/notifications/preferences` | Per-category opt-outs |
| `PATCH` | `/api/notifications/preferences` | `{ chat, social, calls, wallet, system, promotions }` |

### Devices

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/devices/register` | `{ token, deviceId?, platform?, deviceName?, appVersion? }` |
| `POST` | `/api/devices/unregister` | `{ token? }` — defaults to the calling device |
| `GET` | `/api/devices` | The caller's registered devices |

### Admin — requires `x-admin-key`

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/notifications/send` | `{ userIds: [], type, title, body?, … }`, max 1000 recipients |
| `POST` | `/api/notifications/broadcast` | Every active user; returns immediately and runs in the background |
| `GET` | `/api/notifications/admin/logs?status=failed` | Delivery audit + live queue stats |
| `GET` | `/api/notifications/admin/health` | FCM state, queue depth, log counts |

```bash
curl -X POST http://localhost:5000/api/notifications/send \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userIds":["665f…"],"type":"promo","title":"Weekend offer","body":"2x tokens today"}'
```

---

## 5. How the requirements are met

**Token lifecycle.** `PushContext` registers on login and stores the token
locally, so repeat app starts skip the network call. `addPushTokenListener`
force-syncs whenever FCM rotates the token. Tokens are removed on logout, on
device transfer, and on account deletion. FCM's
`registration-token-not-registered` and friends delete the row immediately;
transient failures increment a counter and retire the token after 5 strikes.
`jobs/deviceTokenCleanup.js` prunes anything unused for 60 days.

**Reliability.** Every notification is persisted before any send, so nothing is
lost if FCM is down. `pushQueue` retries transient failures 3 times with
exponential backoff (2s → 4s → 8s), runs at most 5 concurrent jobs, and drains
on `SIGTERM`/`SIGINT` so a redeploy does not drop in-flight pushes. Sends are
chunked at FCM's 500-token multicast limit. Offline users simply get the stored
notification plus whatever FCM buffers.

**No duplicates.** Three layers: an optional `dedupeKey` backed by a unique
partial index; unread chat notifications from the same sender coalesce into a
single row; and the client tracks handled notification ids so a tap never
routes twice (foreground listener, response listener, and cold-start all share
the guard).

**Grouping.** `groupKey` becomes the Android notification `tag` and the iOS
`thread-id`, so a conversation stacks into one entry. Opening a chat calls
`dismissForGroup` to clear that conversation from the tray.

**Badges.** The launcher badge follows the backend unread count. When the user
reads a chat, `chat:read` marks the matching notifications read server-side and
emits `notification:sync`, so every device converges on the same number.

**Battery.** The badge poll dropped from every 1s to every 30s and pauses
entirely while the app is backgrounded; sockets carry real-time updates.
Notification list rendering uses `removeClippedSubviews` with bounded batch
sizes. All listeners are removed on unmount.

**Security.** Every endpoint is authenticated and scoped to `req.userId` — a
caller cannot read or mutate another account's notifications. Only
`adminAuth` (constant-time key comparison) can push to arbitrary users; without
`ADMIN_API_KEY` those routes return 503 rather than opening up. Payloads are
validated for type, length and ObjectId shape. Rate limits are per user:
120/min reads, 60/min writes, 20/min sends, 5/hour broadcasts. Service account
credentials stay in env vars and are gitignored.

---

## 6. Custom sounds (optional)

On Android 8+ the sound belongs to the notification **channel**, not the
message, so both sides must agree.

1. Add `.wav` files to `frontend/assets/sounds/` (e.g. `message.wav`, `call.wav`).
2. Register them in the `expo-notifications` plugin block in `app.json`:
   ```json
   ["expo-notifications", { "sounds": ["./assets/sounds/message.wav"] }]
   ```
3. Point the channel at the file in `frontend/utils/push.ts` — change the
   channel's `sound` from `'default'` to `'message.wav'`.
4. Set `PUSH_CUSTOM_SOUNDS=true` in `backend/.env` and rebuild the app.

Until step 4, every type uses the system default sound.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `FCM disabled (no credentials)` | Service account env var not set — see §1 |
| No token on device | Running in Expo Go, or `google-services.json` missing. Use a dev build |
| Push works in foreground only | Battery optimisation is killing the app — whitelist it in Android settings |
| `messaging/registration-token-not-registered` | Normal: the app was uninstalled. The token is deleted automatically |
| 403 on `/send` | Missing or wrong `x-admin-key` |
| 503 on `/send` | `ADMIN_API_KEY` is not set on the server |
| Badge out of sync | Check `GET /api/notifications/unread-count`; the client mirrors it directly |

Inspect delivery:

```bash
curl -H "x-admin-key: $ADMIN_API_KEY" \
  "http://localhost:5000/api/notifications/admin/logs?status=failed&limit=20"
```
