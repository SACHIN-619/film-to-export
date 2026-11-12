# Film-to-Export — Backend Architecture & Service Engine

> **Express 5 & Node.js Engine:** High-performance, strictly typed backend coordinating Google Gemini multimodal vision, live United States International Trade Commission (USITC) government tariff queries, Delivered Duty Paid (DDP) PayPal Orders v2 transactions, and automated PDF commercial invoice compilation.

---

## Technical Specifications & Backend Tech Stack

| Technology | Version | Purpose & Implementation Details |
|---|---|---|
| **Node.js** | `>= 22.13.0 LTS` | Server runtime leveraging native `fetch`, crypto utilities, and ESM module systems. |
| **Express** | `^5.3.0` | HTTP application framework handling REST routes, proxy trust, error middleware, and SSE streaming. |
| **TypeScript** | `^7.0.2` | Strict type checking (`tsconfig.server.json`) preventing null-pointer exceptions and typing database models. |
| **Zod** | `^4.6.7` | Contract-first schema validation for API payloads, model outputs, and seller profile schemas. |
| **node-postgres (`pg`)** | `^8.23.1` | Native PostgreSQL connection pool supporting SSL/TLS, auto-reconnect, and multi-statement transactions. |
| **Neon Serverless Postgres** | AWS Region Pooler | Serverless cloud PostgreSQL 16 database supporting connection pooling and automated schema migrations. |
| **Google Gemini 2.5 Flash** | `@google/genai` REST | Multimodal LLM ingesting video frames and audio files simultaneously for feature and attribute extraction. |
| **USITC HTS REST API** | Official Gov API | Live customs tariff search service (`https://hts.usitc.gov/reststop/search`) returning official legal rates and headings. |
| **PayPal Orders v2** | REST API v2 | PayPal checkout engine (`https://api-m.sandbox.paypal.com`) handling order creation, capture, and verification. |
| **PDFKit** | `^0.20.2` | Vector document generation engine creating international export Commercial Invoices. |
| **Multer** | `^2.5.0` | Streaming multipart/form-data middleware handling video uploads and voice recordings up to 150 MB. |
| **Vitest** | `^5.0.5` | Fast test runner executing 85+ offline unit and integration tests. |
| **pg-mem** | `^3.0.14` | Synchronous in-memory PostgreSQL emulator enabling comprehensive database testing without external connections. |

---

## Detailed Directory & Module Architecture

```
server/
├── src/
│   ├── ai/                           # Multimodal perception & AI adapters
│   │   ├── draftListings.ts          # Orchestrates Gemini inference, Hindi translation, and JSON schema validation
│   │   ├── fixtures.ts               # Pre-validated sample listings and vector SVG illustrations for simulation mode
│   │   ├── frames.ts                 # FFmpeg video frame extraction, duration calculation, and audio sampling
│   │   └── visionModel.ts            # Abstract VisionModel interface with retry logic, backoff, and fallback models
│   ├── broker/                       # Autonomous customs broker agent engine
│   │   ├── agent.ts                  # Event-driven SSE pipeline managing perception, tariffs, and pricing
│   │   ├── restricted.ts             # Rule-based CITES, endangered wildlife, and cultural antiquity compliance screen
│   │   └── tariff.ts                 # Live USITC HTS API client with hierarchical context assembly and local cache
│   ├── domain/                       # Core business invariants & mathematical foundations
│   │   ├── duty.ts                   # DDP calculation engine (MFN percentage + Section 301 / IEEPA surcharges)
│   │   ├── money.ts                  # Lossless integer-cent arithmetic for currency calculations ($1.00 = 100)
│   │   ├── orderState.ts             # Deterministic state machine governing order transitions (created → paid)
│   │   └── schemas.ts                # Zod schemas defining items, drafts, seller profiles, and orders
│   ├── payments/                     # Payment processing & reconciliation adapters
│   │   ├── paypalSandbox.ts          # PayPal Orders v2 integration (access tokens, order creation, capture, verify)
│   │   ├── provider.ts               # Abstract PaymentProvider interface decoupling business logic from PayPal SDK
│   │   ├── simulated.ts              # Offline payment simulator for testing without PayPal credentials
│   │   └── verifyCapture.ts          # Cryptographic server-to-server payment capture verification
│   ├── scripts/                      # Operational utilities
│   │   └── reset.ts                  # Database reset script re-seeding demo data and wiping test records
│   ├── services/                     # Application services & business operations
│   │   ├── errors.ts                 # Standardized HTTP error primitives (NotFound, Conflict, BadRequest)
│   │   ├── invoices.ts               # PDFKit document generator rendering compliant export Commercial Invoices
│   │   ├── listings.ts               # Database CRUD managing batches, items, and storefront publishing
│   │   └── orders.ts                 # Order lifecycle coordinator managing creation, captures, and reconciliations
│   ├── app.ts                        # Express application assembly, route controllers, and error boundaries
│   ├── config.ts                     # Environment variable validation, defaults, and multi-language configuration
│   ├── db.ts                         # PostgreSQL connection pool wrapper, retry handlers, and migration runner
│   └── index.ts                      # Server entrypoint initializing database connections and listening on PORT
├── data/
│   └── duty_rates.json               # Curated offline tariff table cited directly from USITC schedules
├── fixtures/                         # Vector SVG illustrations for simulation listings (scarf, bowl, diya, cushion)
├── migrations/                       # Sequential SQL migrations executed automatically on startup
│   ├── 001_init.sql                  # Primary tables: seller, batches, frames, items, orders, order_events, invoices
│   ├── 002_duty.sql                  # Tariff rate metadata columns (mfn_rate_pct, rate_source, hts_line)
│   ├── 003_broker.sql                # Broker execution log table for deterministic replay streaming
│   └── 004_media.sql                 # Binary media storage table (`BYTEA`) for cloud container persistence
└── README.md                         # Backend architectural documentation
```

---

## Core Invariants & Engineering Principles

### 1. Zero-Hallucination Government Grounding
- **The Failure Mode of Standard LLMs:** Language models frequently fabricate 6-digit and 8-digit HS customs codes, hallucinate non-existent tariff rates, or misapply Chapter 99 emergency surcharges.
- **The Solution:** Film-to-Export uses Gemini only for initial visual hypothesis. It immediately queries the official **USITC HTS REST API** (`https://hts.usitc.gov/reststop/search`), retrieves all legal lines under the 4-digit heading, reconstructs the parent-child indent tree, and constrains Gemini to select **strictly from verified government lines**.

### 2. Autonomous Agent Self-Correction
- **Real-World Execution:** When processing a hand-block printed cotton scarf, Gemini's initial visual guess was `6214.20` ("Of wool or fine animal hair", 8.4%).
- **Verification Loop:** In `server/src/broker/agent.ts`, the agent cross-references the artisan’s spoken statement (*"pure cotton"*) against the official USITC heading lines.
- **Self-Correction Event:** The agent identifies the mismatch, switches the classification to `6214.90.00` ("Of other textile materials: cotton", 7.2%), and logs the rationale:
  > *"Corrected 6214.20 → 6214.90.00 (General 7.2%). Reason: Artisan explicitly confirmed 100% cotton block printing; wool heading rejected."*

### 3. PayPal Delivered Duty Paid (DDP) Invariant
- **The Challenge:** PayPal Orders v2 contains fields for `item_total`, `tax_total`, `shipping`, and `handling`, but lacks a dedicated `customs_duty` field.
- **The Innovation:** We cleanly isolate import duties into `amount.breakdown.tax_total` and line-item `tax`.
- **Mathematical Invariant:** The backend enforces zero-loss integer cent arithmetic:
  $$\text{amount.value} = \text{item\_total.value} + \text{tax\_total.value}$$
  Any deviation of even \$0.01 causes PayPal's API to reject the checkout. Our integer cent engine guarantees mathematical parity.

### 4. Database-Backed Binary Media Persistence (`BYTEA`)
- **The Ephemeral Disk Problem:** Hosting providers like Render utilize ephemeral container filesystems that are wiped on redeployment or restart, destroying uploaded images stored on disk.
- **The Architecture:** In `server/migrations/004_media.sql`, we established the `media_files` table storing raw binary image data (`BYTEA`) directly in Neon PostgreSQL.
- **Fallback Stream:** The `/media/:batchId/:filename` route checks local disk cache first for sub-millisecond local serving; if absent (e.g., following a Render deployment), it seamlessly streams binary chunks from PostgreSQL with an HTTP `Cache-Control: public, max-age=3600` header.

### 5. Automated DDP Commercial Invoice PDF Generation
- In `server/src/services/invoices.ts`, when an order transitions to `paid`, `pdfkit` compiles a vector PDF commercial invoice formatted to United States Customs and Border Protection (CBP) standards.
- Includes Seller IEC credentials, Buyer Consignee address, 8-digit HTS lines, country of origin certification ("Made in India"), declared value, and prepaid DDP customs tax line.
