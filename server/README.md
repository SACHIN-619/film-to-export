# Film-to-Export — Backend Architecture & Services

This directory contains the Express TypeScript backend API for **Film-to-Export**, handling multimodal AI processing, official customs tariff verification, PayPal Orders v2 integration, and DDP commercial invoice PDF generation.

## Tech Stack

- **Runtime:** Node.js (>= 22.13) + TypeScript
- **Framework:** Express 5
- **Database:** PostgreSQL (Neon Serverless Postgres / Supabase) via `pg` connection pool
- **AI Models:** Google Gemini 2.5 Flash (`@google/genai` REST) with single-pass multimodal vision + audio analysis
- **External Government API:** Official USITC HTS REST API (`https://hts.usitc.gov/reststop/search`)
- **Payments:** PayPal Orders v2 REST API (`https://api-m.sandbox.paypal.com`)
- **PDF Generation:** `pdfkit`
- **Validation:** Zod schemas for strict contract verification
- **Testing:** Vitest with in-memory database simulation (`pg-mem`) and live Postgres integration tests

## Architecture & Directory Structure

```
server/
├── src/
│   ├── ai/               # Gemini multimodal integration & listing draft extraction
│   │   ├── draftListings.ts  # Video/photo analysis, Hindi transcription & translation
│   │   ├── fixtures.ts       # Validated fallback listings for simulation mode
│   │   ├── frames.ts         # FFmpeg video frame extraction & audio processing
│   │   └── visionModel.ts    # Model adapter with retry, backoff, and fallback models
│   ├── broker/           # Autonomous customs broker agent
│   │   ├── agent.ts          # SSE pipeline coordinating perception, tariffs, and pricing
│   │   ├── restricted.ts     # CITES, wildlife & export sanctions compliance screening
│   │   └── tariff.ts         # Live USITC HTS API client with hierarchical context
│   ├── domain/           # Core business logic & legal invariants
│   │   ├── duty.ts           # DDP duty calculations (MFN base rate + country surcharges)
│   │   ├── money.ts          # Safe integer-cent arithmetic for multi-currency handling
│   │   ├── orderState.ts     # State machine for cross-border order lifecycles
│   │   └── schemas.ts        # Zod validation schemas
│   ├── payments/         # Payment adapters
│   │   ├── paypalSandbox.ts  # PayPal Orders v2 creation, capture, and verification
│   │   ├── provider.ts       # Abstract PaymentProvider interface
│   │   ├── simulated.ts      # Offline sandbox simulator for testing
│   │   └── verifyCapture.ts  # Server-side cryptographic capture verification
│   ├── services/         # Persistence & application workflows
│   │   ├── invoices.ts       # Compliant DDP Commercial Invoice PDF generation
│   │   ├── listings.ts       # Database CRUD for batches and items
│   │   └── orders.ts         # Order management and capture reconciliation
│   ├── app.ts            # Express application setup, routes & SSE handlers
│   ├── config.ts         # Environment validation and configuration loader
│   ├── db.ts             # Postgres connection pool and migration runner
│   └── index.ts          # HTTP server entrypoint
├── data/
│   └── duty_rates.json   # Verified tariff fallback table cited directly from USITC
├── fixtures/             # Vector SVG illustrations for sample items
└── migrations/           # Automated SQL schema migrations
    ├── 001_init.sql      # Core tables (seller, batches, items, orders, invoices)
    ├── 002_duty.sql      # Tariff and customs metadata columns
    ├── 003_broker.sql    # Broker execution event logs for deterministic replays
    └── 004_media.sql     # Database-backed media persistence table (`BYTEA`)
```

## Core Backend Invariants

1. **PayPal Delivered Duty Paid (DDP) Allocation:** Because PayPal does not have a native duty field, customs duties are mapped to `amount.breakdown.tax_total` and line-item taxes. The backend enforces:
   `total = item_total + tax_total` (exact to the penny).
2. **Zero-Hallucination Tariff Grounding:** Gemini is never allowed to hallucinate tariff codes. It queries the live USITC API for the official 4-digit heading and is constrained to choose exclusively from official government lines.
3. **Persistent Media Storage:** To survive ephemeral hosting on platforms like Render, images are stored directly in PostgreSQL (`media_files.data` as `BYTEA`) with local disk caching.
4. **Server-Side Payment Verification:** Orders are only marked `paid` and commercial invoices generated after the server validates currency, recipient, and amounts directly against PayPal Sandbox servers.
