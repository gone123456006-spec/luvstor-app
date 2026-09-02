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

## What “unlimited” still needs ops-wise

Code alone is not infinite capacity. For sustained millions of MAU also plan:

- Mongo indexes (already added for notifications / tokens / messages)
- Redis memory sizing for presence + BullMQ
- Separate **push worker** processes if API CPU is hot (same BullMQ queue)
- CDN / S3 for media (not local `uploads/`)
- Rate limits (already on notification routes)
- Regional FCM + multi-region Mongo only if latency requires it

Local `npm run dev` without Redis still works (single-node fallback).
