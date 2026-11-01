# Film-to-Export

**Ship duties-paid to the US from one phone video, paid through PayPal.**

Since the US ended duty-free entry for small parcels (Aug 29, 2025), every parcel owes duty, and buyers get surprise bills at the door. Film-to-Export estimates the US import duty from the seller-confirmed HS code and collects it at PayPal checkout (DDP), so the buyer pays one honest total. Duty figures are **estimates, not customs advice**; rates and sources are in [`server/data/duty_rates.json`](server/data/duty_rates.json).

A seller films their table (or snaps photos). Gemini vision drafts one honest, bilingual export listing per item, with a suggested USD price and a **suggested** HS customs code. The seller confirms every number and publishes a storefront. A foreign buyer pays with **PayPal Checkout (Sandbox)**. The server verifies the capture, and the paid order automatically gets an **export commercial invoice** (PDF).

Built for the PayPal AI Hackathon. Sandbox only: no real money moves.

> HS codes here are AI suggestions that the seller reviews and confirms. They are **not** customs or legal advice.

## Quick start (Windows, PowerShell)

Requires **Node.js ≥ 22.13** and a **hosted Postgres** connection string (free on [Neon](https://neon.tech); Supabase also works).

```powershell
npm install
Copy-Item .env.example .env   # DATABASE_URL is required; Gemini/PayPal keys are optional (SIMULATION without them)
npm run dev                   # http://localhost:8787; the migration runs automatically on startup
```

Step-by-step key setup (Neon or Supabase, Gemini, PayPal Sandbox): [`docs/COMMON_STEPS.md` → Getting your keys](docs/COMMON_STEPS.md#2-getting-your-keys). The app reads `.env` from the project root, falling back to `server/.env`. Both are gitignored.

macOS/Linux: same commands, with `cp .env.example .env`.

| Command | What it does |
|---------|--------------|
| `npm run dev` | API + Vite client in one process on `PORT` (default 8787) |
| `npm test` | Vitest suite, offline (in-memory Postgres via pg-mem); plus an opt-in integration test when `DATABASE_URL` is set |
| `npm run typecheck` | `tsc` for server and client |
| `npm run build` then `npm start` | Production build, served by the same Express process |
| `npm run demo:reset` | Empty the app's Postgres tables, re-seed the seller profile, clear local uploads |

## Keys and modes

Each half of the app runs **live** when its keys are present and in a clearly labelled **SIMULATION** mode when they aren't. A banner on every page shows which mode is active.

| `.env` | Live | Without it |
|--------|------|------------|
| `DATABASE_URL` (Postgres, TLS) | **Required**. Listings, orders and invoices live here | The app prints how to get one and exits (no local fallback) |
| `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`, default `gemini-2.5-flash`) | Uploads go to Gemini vision | Upload is disabled. A **fixture** batch (hand-written examples with illustrations, labelled "Fixture · not AI output") can be loaded instead |
| `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` (Sandbox app) | PayPal JS SDK buttons, Orders v2 against `https://api-m.sandbox.paypal.com` | A simulated checkout with `SIM-` order and capture ids and an invoice watermarked "SIMULATION" |
| `PAYPAL_CREATE_INVOICE=true` | Also creates a draft in PayPal Invoicing (stretch) | — |
| `BUYER_LANGUAGE` | Second listing language (`es` default) | — |

Video uploads need **ffmpeg** on the PATH (`winget install Gyan.FFmpeg`). Without it, upload photos instead.

Full setup (PayPal Sandbox accounts, Gemini key, recording the demo): [`docs/COMMON_STEPS.md`](docs/COMMON_STEPS.md).
Push to GitHub and deploy on Render (one web service, `render.yaml` Blueprint included): [`docs/DEPLOY.md`](docs/DEPLOY.md).

## How it works

```
React + Vite ──/api──► Express (TypeScript, one service)
                         ├─ ai/        VisionModel adapter → Gemini REST (JSON mode)
                         │             Zod validation + one repair retry; ffmpeg frames
                         ├─ payments/  PaymentProvider adapter → PayPal Sandbox Orders v2
                         │             (or the Simulated provider); verifyCapture()
                         ├─ domain/    order state machine, money in integer cents, Zod schemas
                         ├─ services/  listings, orders, commercial invoice + PDF (pdfkit)
                         └─ Postgres via `pg` pool (Neon/Supabase, TLS) + migration
                            server/migrations/001_init.sql on startup; uploads on disk in ./data
```

Payment integrity rules:

1. **The browser only names the item.** `POST /api/orders` accepts `{ itemId, quantity }`. The amount comes from the database price, and any amount the client sends is dropped.
2. **Approval isn't payment.** After the buyer approves, the server calls `capture`. If that errors (already captured, 5xx, timeout), it **reads the order back** from PayPal.
3. **`verifyCapture()`** checks the purchase-unit reference, capture status, amount (to the cent) and currency. `COMPLETED` → `paid`. `PENDING` → `payment_pending` (no invoice). Anything else → `failed`.
4. **State machine:** `created → paid | payment_pending | failed | cancelled`, and `payment_pending → paid | failed`. `paid` is terminal and reachable only with a verified capture.
5. Idempotency: `PayPal-Request-Id` on create and capture. Re-capturing a paid order is a no-op.

AI rules: one call with all frames, `responseMimeType: application/json`, a Zod schema (`AiDraftSchema`) and **exactly one** repair retry. Every field carries a confidence level. Nothing publishes until the seller has confirmed price, quantity, condition and HS code.

Details: [`docs/PLAN.md`](docs/PLAN.md). Demo: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

## Tests

`npm test` covers:

- the order state machine (every transition pair)
- the server never trusting a client-sent amount (supertest against the real routes)
- capture verification: amount, currency and reference mismatches; PENDING; readback after `ORDER_ALREADY_CAPTURED` and 5xx; declined instruments; idempotency
- AI output schema validation with one repair retry (valid, fenced, invalid → repaired, non-JSON → repaired, gives up after one retry)
- the seller confirmation gate, simulation end-to-end through to the PDF, and config safety (Gemini key sent in a header, no secrets in `/api/config`)

## Scope

In: one seller, a handful of items, USD, English plus one buyer language, PayPal Sandbox, commercial invoice.
Not yet: multi-seller onboarding (PayPal partner onboarding), auth, shipping labels and rates, duties and taxes, refunds, inventory reservations.

## License

[MIT](LICENSE)
