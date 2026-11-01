# Film-to-Export — Plan

> Working name. Entry for the PayPal AI Hackathon (Devpost). Deadline: **Nov 12, 2026, 12:00pm PT**.
> Pitch (Nov 1): **An AI customs broker in your pocket.** Since the US ended duty-free entry for small parcels (Aug 29, 2025), every parcel owes duty. Buyers get surprise bills and refuse parcels. A solo maker sends one phone video and speaks in Hindi. An agent finds each piece, looks up the **official US tariff schedule live**, prices it **duties-included**, flags restricted materials, and hands back a **PayPal pay link** to paste into an Instagram or WhatsApp chat. When PayPal confirms payment, the DDP customs invoice writes itself.
> Target prizes: **Best Use of Agentic Commerce**, **Best Use of PayPal + AI**, Most Impactful.

## 00. The broker (Nov 1 pivot)

**Why not a storefront.** Indian artisans mostly sell through Instagram and WhatsApp messages, not websites. A storefront demo reads as "e-commerce site". The broker instead does the work a customs broker does, visibly, and ends in a PayPal link the maker can paste anywhere. The storefront stays as a minor secondary page.

**Flow (Broker desk, the new home page):**
1. **Input:** a short video or photos, plus an optional voice note (Hindi or English). Video frames and audio are pulled out in the browser, so no ffmpeg is needed.
2. **Agent run, streamed step by step** (Server-Sent Events over a streaming POST). Each step is visible with its tool, input, result and source:
   1. `perceive`: one Gemini call over the frames plus audio → transcript plus distinct items (Zod-validated, one repair).
   2. `classify` (per item): proposed HS code with reasoning.
   3. `tariff_lookup` (per item): a **live call to the official USITC HTS REST API** (`hts.usitc.gov/reststop/search`) confirms the General (MFN) rate. Results are cached. If the API fails or returns a non-ad-valorem rate, we fall back to `server/data/duty_rates.json`, and **the step says which source was used**.
   4. `duty`: MFN + India surcharge (flagged *uncertain*) → estimated duty.
   5. `restricted_check`: a small curated list (ivory, shahtoosh, red sanders, sandalwood, coral, wild-animal skins and feathers, antiques over 100 years, …). Labelled **"not legal advice"**.
   6. `price`: buyer total = piece + estimated duty (DDP).
3. **Seller confirms** each item (the confirm gate stays; an HS code edit triggers a new live lookup).
4. **Get pay link:** `/pay/:itemId` (PayPal buttons, server-priced, duties included). One click to copy share text, a WhatsApp share and a QR code.
5. **Buyer pays** with PayPal (Orders v2, duty in `tax_total`). The server verifies the capture, then issues the **DDP commercial invoice** (PDF).

**Demo reliability.** The agent's orchestration is deterministic code, and the AI is used at fixed steps. Every live run is recorded. **Replay** re-streams a recorded run with its original timings, and every replayed step carries a "REPLAY of run … recorded …" label. Without a Gemini key, the perceive step uses labelled fixtures.

**Milestones (Nov 1 → 12):**

| Date | Milestone |
|------|-----------|
| Sun Nov 1 | M1: Broker desk, streamed agent steps, live HTS lookup with cache and fallback, restricted check, confirm gate, recorded runs and replay |
| Mon Nov 2 | M2: `/pay/:id` page, share text, WhatsApp link, QR code; DDP invoice after verified capture; optional PayPal Invoicing payer link |
| Tue Nov 3 | M3: Hindi voice note (in-browser recording or upload) and video audio → a single Gemini call for transcript + items; tested with a fixture and then the user's real clip |
| Wed Nov 4 – Thu Nov 5 | Polish: the desk as hero, mobile pay page, error states; storefront demoted |
| Fri Nov 6 – Sat Nov 7 | Real artisan footage; full dry runs; record a replay-safe run |
| Sun Nov 8 – Mon Nov 9 | Video (<3:00), Devpost text |
| Tue Nov 10 – Wed Nov 11 | Public repo check, deploy (optional), buffer |
| **Thu Nov 12, 12:00pm PT** | **Deadline** |

## 0. Why duties-included (the edge)

- **The change.** Executive Order 14324 suspended duty-free de minimis treatment (the $800 rule) for **all countries** from **Aug 29, 2025** ([KPMG on CBP's implementation](https://kpmg.com/us/en/taxnewsflash/news/2025/08/us-cbp-implements-eo-suspending-duty-free-de-minimis-treatment.html); [Thompson Hine](https://www.thompsonhinesmartrade.com/2025/07/president-suspends-duty-free-de-minimis-imports-for-all-countries-and-imposes-new-tariffs-on-low-value-shipments/)).
- **It stuck.** The Supreme Court's Feb 20, 2026 ruling struck down IEEPA *tariffs*. It did not restore de minimis: the suspension was kept by EO 14388, written into CBP regulations (June/July 2026), and upheld by the Court of International Trade in *Axle of Dearborn* on Aug 13, 2026 ([Troutman Pepper Locke](https://www.troutman.com/insights/the-800-free-pass-is-gone-cit-confirms-president-can-eliminate-de-minimis-tariff-exemption/); [DutyLane status page](https://dutylane.com/tariff/policy/de-minimis)).
- **It becomes permanent.** The One Big Beautiful Bill Act repeals commercial de minimis by statute from **July 1, 2027** ([Mondaq](https://www.mondaq.com/unitedstates/international-trade-investment/1649458/de-minimis-to-be-eliminated-july-2027-under-recently-enacted-megabill)).
- **Who it hurts.** A US buyer of a $30 scarf from Jaipur now gets a duty bill at the door, refuses the parcel, and the solo seller eats the return. Big platforms can collect duty at checkout (DDP); a solo maker can't.
- **What we do.** The AI-suggested, seller-confirmed HS code drives a **server-side duty estimate** from a small, cited rate table (`server/data/duty_rates.json`). The buyer sees **piece + estimated US import duty = one total** before paying. PayPal collects it in the same order: the duty goes in `tax_total` and `items[].tax`. The commercial invoice declares the goods value and the prepaid duty under **Incoterm DDP**.
- **Honesty rules.** Every figure is labelled "estimate, not customs advice", with the rate basis (HS → MFN rate + origin surcharge) and sources. Unverified or uncertain rate components are flagged in the studio. An HS code with no rate on file gets no duty line: the checkout is goods-only (DAP), and the buyer is told they may owe duty on delivery.
- **Known uncertainty (Oct 31, 2026).** The extra US tariff on India-origin goods is in flux after the IEEPA ruling. Secondary sources mostly say about 10%, but they conflict. It's a separate, flagged component of the rate, so it can change in one line.

## 1. Problem

Millions of small makers in India (weavers, block-printers, potters, metalworkers) make one-of-a-kind goods that sell for 3–10× more abroad than at home. Three things stop them from selling across borders:

1. **Listing cost.** Writing good English listings, photographing items one by one, describing condition honestly and pricing in USD takes hours per item.
2. **Export paperwork.** Every international parcel needs a commercial invoice with HS (customs) codes, country of origin and declared value. Most makers have never seen one.
3. **Getting paid.** PayPal India accounts cannot take domestic payments, only international ones. Cross-border selling is the honest use case for PayPal in India, and it is exactly the use case small sellers find hardest to start.

Existing "video-to-store" tools (for example Cartrix) target domestic UPI and cash-on-delivery sellers. None of them does the **export** work.

## 2. User

- **Primary: the seller.** A solo artisan or a two-person workshop, phone-first, comfortable with WhatsApp, not comfortable writing English copy or customs forms. Demo persona: *Kavya*, a hand block-printer in Jaipur (fictional).
- **Secondary: the foreign buyer.** A US shopper who wants a story-rich, honest listing and a familiar, trusted checkout (PayPal).

## 3. Solution

1. The seller films a short pan across their table (or takes photos).
2. AI (Gemini, vision) finds each distinct physical item and drafts **one listing per item**:
   - title and description in English, plus one buyer language (e.g. Spanish)
   - honest condition grade and defect notes ("slight colour bleed on the left border")
   - a suggested USD price with rationale
   - a **suggested** HS code with rationale
   - a confidence level (high/medium/low) on each field
3. The seller **must review and confirm** price, quantity, condition and HS code. Nothing is published unconfirmed.
4. One click publishes a small editorial storefront.
5. A buyer pays with **PayPal Sandbox Checkout** (Orders v2, `CAPTURE` intent, JS SDK buttons).
6. The server captures the order and **verifies the capture itself** (status, amount, currency, reference). Only then is the order marked paid.
7. A paid order automatically gets an **export commercial invoice** (seller, buyer, items, HS codes, value, currency, country of origin): shown in the app and downloadable as a PDF. Stretch: the same invoice is also created as a draft in PayPal Invoicing.

AI HS codes are **never** presented as customs or legal advice. The UI labels them "Suggested — you confirm", and the invoice says the seller confirmed them.

## 4. Demo story (about 2:45)

Kavya films four pieces on her workbench → 40 seconds later she has four bilingual listings with condition notes and HS suggestions → she fixes one price and confirms the HS codes → publishes → a US buyer opens the shop and pays with PayPal Sandbox → the server verifies the capture → a commercial invoice appears, PDF in hand. See `docs/DEMO_SCRIPT.md`.

## 5. Features

| # | Feature | Priority |
|---|---------|----------|
| F1 | Upload a video (ffmpeg frame extraction) or 1–8 photos (resized in the browser) | Must |
| F2 | AI drafting: one listing per item, bilingual, condition and defects, USD price, HS code, confidence per field | Must |
| F3 | Schema validation of AI output (Zod) with one automatic repair retry | Must |
| F4 | Seller review: edit and confirm each item; publishing blocked until every item is confirmed | Must |
| F5 | Storefront and product pages (editorial design) | Must |
| F6 | PayPal Sandbox checkout (JS SDK → server create → server capture → verify) | Must |
| F7 | Order state machine; paid only on a verified capture or readback | Must |
| F8 | Commercial invoice: in-app view + PDF | Must |
| F9 | SIMULATION mode without keys: fixture items, `SIM-` order IDs, labelled everywhere | Must |
| F10 | Seller exporter profile (name, address, IEC) used on invoices | Should |
| F11 | PayPal Invoicing API draft invoice | Stretch |
| F12 | Webhook (`PAYMENT.CAPTURE.COMPLETED`) as a second confirmation path | Stretch |
| F13 | **Duties-included checkout (DDP):** server-side duty estimate from the confirmed HS code and price, shown to the buyer as one total, collected via PayPal `tax_total` | **Must (Oct 31)** |
| F14 | Studio "why": per item, what the US buyer pays and why (HS → rate → source, with unverified/uncertain flags) | **Must (Oct 31)** |
| F15 | Invoice: Incoterm DDP, declared goods value, prepaid duty line and its basis | **Must (Oct 31)** |
| F16 | Seller speaks Hindi (video or voice note) → English listings | Stretch |

## 6. Scope

**In:** one seller, 3–5 items, one verified Sandbox purchase, USD only, English plus one buyer language, commercial invoice PDF.

**Out (documented as future work):** multi-seller onboarding and PayPal partner onboarding, auth and accounts, shipping labels and rates, tax and duty calculation, refunds, inventory reservations, multi-currency, legal customs classification.

## 7. Architecture

```
 Browser (React + TS + Vite)
   │  photos resized client-side          PayPal JS SDK (Buttons)
   │  /api/*  ─────────────────────────┐        │ approve
   ▼                                   ▼        ▼
 Express + TS (one service, also serves the built client)
   ├── ai/      VisionModel adapter ──► Gemini REST (generateContent, JSON)
   │            frames.ts ──► ffmpeg (optional)
   │            draftListings.ts: prompt → Zod validate → one repair retry
   ├── payments/ PaymentProvider adapter ──► api-m.sandbox.paypal.com
   │            (OAuth2 → Orders v2 create/capture/get; Invoicing v2)
   │            Simulated provider (SIM- ids) when keys are missing
   │            verifyCapture.ts: status, amount, currency, reference
   ├── domain/   orderState.ts (state machine), schemas.ts (Zod), money.ts
   ├── services/ listings, orders, invoices (+ PDF via pdfkit)
   └── Postgres (Neon recommended, Supabase works) via `pg` pool over TLS;
       server/migrations/*.sql applied on startup; uploads on disk under ./data
```

Design rules:
- **Adapters.** `VisionModel` (Gemini or none) and `PaymentProvider` (PayPal Sandbox or Simulated) are injected into `createApp()`, so tests run without network access.
- **The server owns money.** The client sends only `itemId` and `quantity`. The amount always comes from the database price, in integer cents.
- **Mode is visible.** `/api/config` reports `ai: live|simulation` and `payments: sandbox|simulation`. A banner shows both on every page.

## 8. Data model (Postgres)

One migration, `server/migrations/001_init.sql`, runs automatically on startup and is tracked in `schema_migrations`. `DATABASE_URL` is required, even in SIMULATION mode. Tests use pg-mem (in-memory Postgres), so `npm test` runs offline. An opt-in integration test runs against the real database in a throwaway schema when `DATABASE_URL` is set.

| Table | Key columns |
|-------|-------------|
| `seller` | id, name, business_name, address, city, country (IN), email, iec |
| `batches` | id, source (`video`/`photos`/`fixture`), ai_mode (`live`/`simulation`), model, status, frame_count, error, created_at |
| `frames` | id, batch_id, idx, path, mime |
| `items` | id, batch_id, status (`draft`/`confirmed`/`published`/`sold_out`), origin (`ai`/`fixture`), title_en, description_en, alt_lang, title_alt, description_alt, materials, dimensions, condition_grade, condition_notes, defects (JSON), suggested_price_cents, price_rationale, price_cents, quantity, hs_suggested, hs_description, hs_rationale, hs_code, confidence (JSON), image_path, country_of_origin, confirmed_at |
| `orders` | id, item_id, quantity, amount_cents, currency, status, payments_mode, paypal_order_id, capture_id, capture_status, buyer_* fields, created_at, paid_at |
| `order_events` | order_id, from_status, to_status, note, at (audit trail) |
| `invoices` | id, number (`CI-2026-0001`), order_id, issued_at, snapshot (JSON), paypal_invoice_id |

## 9. API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/config` | modes, PayPal client ID (public), ffmpeg availability, buyer languages |
| GET/PUT | `/api/seller` | exporter profile |
| POST | `/api/batches` | multipart upload (video or photos) → frames → AI draft (live mode) |
| POST | `/api/batches/fixture` | load the fixture batch (SIMULATION, labelled) |
| GET | `/api/batches/:id` | batch with items |
| PUT | `/api/items/:id` | edit and confirm a draft (Zod) |
| DELETE | `/api/items/:id` | drop a draft |
| POST | `/api/batches/:id/publish` | publish; 409 if any item is unconfirmed |
| GET | `/api/shop` and `/api/shop/:itemId` | storefront |
| POST | `/api/orders` | `{itemId, quantity}` → server-priced PayPal order |
| POST | `/api/orders/:id/capture` | capture → verify → paid → invoice |
| GET | `/api/orders`, `/api/orders/:id` | seller list, receipt |
| GET | `/api/invoices/:id`, `/api/invoices/:id/pdf` | commercial invoice |

## 10. PayPal flow

1. The browser loads the JS SDK with the **public** client ID from `/api/config` (`intent=capture&currency=USD`).
2. `createOrder` → `POST /api/orders {itemId, quantity}`. The server looks up the price and the confirmed HS code, estimates the US import duty (`server/src/domain/duty.ts`), and computes `amount_cents = goods + duty`. In the PayPal body, the goods go in `item_total` and the duty in `tax_total` / `items[].tax` (DDP), stores order `created`, then calls `POST /v2/checkout/orders` (intent `CAPTURE`, `reference_id` and `custom_id` = our order id, item breakdown, `PayPal-Request-Id` for idempotency). It returns the PayPal order id.
3. The buyer approves in the PayPal popup (Sandbox personal US account).
4. `onApprove` → `POST /api/orders/:id/capture`. The server calls `POST /v2/checkout/orders/{id}/capture`. If that errors (`ORDER_ALREADY_CAPTURED`, a timeout, a 5xx), it **reads back** `GET /v2/checkout/orders/{id}`.
5. `verifyCapture()` checks: order status `COMPLETED`, matching purchase unit `reference_id`, capture status, amount equal to the stored `amount_cents`, currency `USD`. Results:
   - capture `COMPLETED` → `paid` (inventory decremented, invoice issued)
   - capture `PENDING` → `payment_pending` (no invoice; shown honestly)
   - anything else → `failed`
6. The browser returning from PayPal **never** marks an order paid by itself.

Base URL is fixed to `https://api-m.sandbox.paypal.com`.

## 11. AI pipeline

1. **Ingest.** Video → `ffprobe`/`ffmpeg` sample up to 8 evenly spaced frames, scaled to 768px. Photos → resized in the browser to ≤1600px JPEG, up to 8.
2. **Draft.** One Gemini `generateContent` call with all frames inline and `responseMimeType: application/json`. The prompt asks for distinct physical items, frame indices, bilingual copy, honest condition, a USD price and an HS-6 suggestion with rationale, plus per-field confidence. It forbids invented provenance claims.
3. **Validate.** Zod schema `AiDraftSchema`. If JSON parsing or validation fails, make **one repair call** with the bad output and the exact issues. If that also fails, the batch fails with a readable error.
4. **Persist.** Each item gets a hero frame and status `draft`, with origin `ai`.
5. **Human gate.** The seller confirms price, quantity, condition and HS code. `confirmed_at` is required to publish.

## 12. Milestones

| Date | Milestone |
|------|-----------|
| Thu Oct 29 | ✅ Docs; scaffold; SIMULATION end-to-end; tests green; Postgres (Neon); live Gemini and PayPal Sandbox order creation |
| Sat Oct 31 | ✅ First live Sandbox purchase verified (US buyer → IN merchant). ✅ **Pivot to duties-included checkout (DDP)**: cited rate table, server-side estimate, PayPal `tax_total`, DDP invoice, studio "why" |
| Sun Nov 1 – Mon Nov 2 | Live DDP purchase in Sandbox; verify the HS rates marked "unverified" against hts.usitc.gov; real photos of 4–5 real pieces; prompt tuning |
| Tue Nov 3 – Thu Nov 5 | Design polish (DDP price block, mobile); stretch: Hindi voice note → English listings; stretch: PayPal Invoicing draft |
| Fri Nov 6 – Sat Nov 7 | Film real artisan footage; full dry runs; bug fixes; README screenshots |
| Sun Nov 8 – Mon Nov 9 | Record and edit the demo video (<3:00); write the Devpost page |
| Tue Nov 10 | Public repo final check (license, setup steps, no secrets); submit an early draft |
| Wed Nov 11 | Buffer and final submit |
| **Thu Nov 12, 12:00pm PT** | **Deadline** |

## 13. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| A Sandbox **IN business account** returns `PENDING` captures (receiving-currency preference) | Handled as `payment_pending`, not paid. In Sandbox account settings, accept USD automatically or use the account's "Accept" step; fallback: a US business account for the video, disclosed. |
| Gemini merges or splits items, or hallucinates | Frame indices per item; the seller can delete drafts; per-field confidence; human confirm gate. |
| Malformed AI JSON | `responseMimeType: application/json` + Zod + one repair retry + a readable failure. |
| HS codes are wrong | Always labelled as suggestions; the seller must confirm; invoice footer disclaimer; never called customs advice. |
| ffmpeg not installed on the judge's machine | Photos path works without it; `/api/config` reports availability; setup docs explain `winget install ffmpeg`. |
| Keys not available to judges | SIMULATION mode runs end-to-end, labelled on every screen, with `SIM-` ids. |
| Secrets leak | `.env` gitignored, `.env.example` only; the server never logs keys; the client ID is the only value sent to the browser. |
| Default Gemini model renamed or retired | `GEMINI_MODEL` env var. |
| Video over 3 minutes | `DEMO_SCRIPT.md` timed at about 2:45 with cuts. |
