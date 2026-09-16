# Bug hunt memory

## Open

- **backend/routes/tokens.js + payment.js**: Free `POST /api/tokens/purchase` minted tokens with no payment; `POST /api/payment/verify` credited client `packId` instead of Razorpay `order.notes.packId` (cheap pack → large credit). Fix on branch `fix/token-purchase-security` (commit `49839bc`). Open PR: https://github.com/gone123456006-spec/luvstor-app/compare/main...fix/token-purchase-security?expand=1 — status: **pushed, awaiting PR create** (`gh` CLI not installed). Recorded: 2026-09-15.

## Rejected

_(none)_
