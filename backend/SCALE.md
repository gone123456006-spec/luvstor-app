# Scaling Luvstor to 1M+ users

The backend is built to run as **many identical Node processes** behind a load
balancer. Scale is unlocked by setting `REDIS_URL`.

## Architecture

```
Clients ──► LB ──► API/Socket nodes (N)
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
     MongoDB      Redis       FCM (Google)
   (Atlas M30+)  (adapter +   multicast
                  BullMQ +     500/batch
                  presence)
```

| Piece | Without Redis (local) | With Redis (production) |
| --- | --- | --- |
| Socket.IO | Single process only | `@socket.io/redis-adapter` — any node can emit |
| Push queue | In-memory (lost on crash) | **BullMQ** — durable, multi-worker |
| Presence / mute-open-chat | Process memory | Shared Redis keys |
| Notify user | `user:{id}` room | Same room, cross-node |

## Minimum production checklist

1. **MongoDB Atlas** (or replica set) — set `MONGODB_URI`, raise `MONGO_POOL_SIZE` (50–100).
2. **Redis** (Elasticache / Upstash / Redis Cloud) — set `REDIS_URL`.
3. **2+ Node processes** — same image, same env (PM2 cluster, ECS, K8s).
4. **Sticky sessions optional** — Redis adapter means sockets do not require sticky, but sticky still helps reconnects.
5. **Firebase** — service account + Android/iOS builds with `google-services.json`.
6. **Probe** — load balancer hits `GET /health` (mongo + redis + queue).

## Env knobs

```bash
REDIS_URL=redis://...
MONGO_POOL_SIZE=50
PUSH_CONCURRENCY=20          # FCM workers per process
PUSH_MAX_ATTEMPTS=5
NOTIFICATION_TTL_DAYS=90     # prune read rows
CORS_ORIGIN=https://api.example.com
```

## Redis setup (Upstash / Redis Cloud)

1. Create a database — **Upstash** (free tier, pick the region closest to the
   API host) or **Redis Cloud**. Use the TLS URL: `rediss://default:<password>@<host>:<port>`.
2. Set `REDIS_URL` on every API instance and redeploy. Logs show `🟥 Redis connected`.
3. `npm run check:env` confirms it is set (values are never printed).

If Redis is unreachable the API keeps working: sockets run single-node, the
push queue is in-memory and caches fall back to process memory.

## Caching (utils/cache.js)

| What | Key | TTL | Invalidated by |
| --- | --- | --- | --- |
| Chat unread badge | `unread:chat:{user}:{v}` | 30 s | any Message write for the user, archive/unarchive |
| Notification badge(s) | `unread:center|notif:{user}:{v}` | 30 s | any Notification write for the user |
| Conversation list rows | `conv:{user}:{v}` | 60 s | any Message write for the user |
| Online Nearby strip | `pulse:{user}:{v}:…` | 20 s (`ONLINE_NEARBY_TTL_SEC`, 0 = off) | likes / blocks (Friendship writes) |
| For You pages | (existing) | — | — |

`{v}` is a per-user version bumped by `utils/cacheVersionPlugin` after writes
on Message / Notification / ConversationState / Friendship, so badges update
immediately; the TTL is only a backstop. Nearby is intentionally not cached
(rotation) — it only coalesces identical in-flight requests.

List caps: chat history `limit` ≤ 200; friends list / likes / requests /
blocked ≤ 500 (optional `?limit=`, `X-Has-More: 1` when cut).

## Media (`/api/media/:id`)

- Metadata first, bytes only when needed; `ETag` → 304 without loading the file.
- `HEAD` and `Range` (206) — voice notes stream/seek.
- Hot files kept in a per-process LRU (`MEDIA_MEM_CACHE_MB`, default 64;
  `MEDIA_MEM_ITEM_MAX_KB`, default 1536).
- Profile / cover / gallery photos: `public, max-age=1y, immutable` (CDN-friendly).
- **Chat photos + voice notes are private**: served only via signed links
  `?e=<expiry>&s=<sig>` (`MEDIA_URL_TTL_HOURS`, default 72; links stay
  valid 1–2 windows and keep the same URL inside a window so phones cache them).

```bash
MEDIA_URL_SECRET=<long random string>   # else JWT_SECRET is used
MEDIA_PRIVATE_ENFORCE=log               # off | log | on
```

### Private-media rollout

1. Deploy the backend (`MEDIA_PRIVATE_ENFORCE=log` — nothing is blocked yet).
2. `node scripts/markChatMediaPrivate.js` (dry run) → `--apply` to mark
   existing chat media private (DP / gallery photos are skipped).
3. Ship the new app build (it keeps the `e`/`s` query on media links).
4. Watch logs for `[media] … unsigned private-media request(s)`; once old
   builds are gone, set `MEDIA_PRIVATE_ENFORCE=on`.

## What “unlimited” still needs ops-wise

Code alone is not infinite capacity. For sustained millions of MAU also plan:

- Mongo indexes (already added for notifications / tokens / messages)
- Redis memory sizing for presence + BullMQ
- Separate **push worker** processes if API CPU is hot (same BullMQ queue)
- CDN / S3 for media (not local `uploads/`)
- Rate limits (already on notification routes)
- Regional FCM + multi-region Mongo only if latency requires it

Local `npm run dev` without Redis still works (single-node fallback).

Now chekc these are working or not and also my app not getting hacked anyhow 
