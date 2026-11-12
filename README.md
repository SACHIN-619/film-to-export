# Film-to-Export

> **An AI customs broker in your pocket:** a solo maker films her workbench, speaks in Hindi, and gets a Delivered-Duty-Paid PayPal link for US buyers, backed by live USITC government tariffs and an AG Grid seller ledger.

[![Live Demo on Render](https://img.shields.io/badge/Render-Live%20Demo-brightgreen?logo=render)](https://film-to-export.onrender.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with PayPal](https://img.shields.io/badge/Payments-PayPal%20Orders%20v2-003087?logo=paypal)](https://developer.paypal.com)
[![AI: Google Gemini](https://img.shields.io/badge/AI-Google%20Gemini%202.5%20Flash-4285F4?logo=google)](https://deepmind.google/technologies/gemini/)
[![Ledger: AG Grid](https://img.shields.io/badge/Ledger-AG%20Grid%20v36-red)](https://www.ag-grid.com)
[![API: Postman](https://img.shields.io/badge/API-Postman%20Collection-FF6C37?logo=postman)](postman_collection.json)

---

## The Real-World Regulatory Problem

On **August 29, 2025**, the United States suspended the \$800 duty-free *de minimis* exemption on international small parcels, with permanent statutory repeal enacted for all countries. Virtually overnight, every single parcel arriving in the United States from abroad owes customs import duty.

This created an acute crisis for millions of micro-artisans in the Global South:
- When a solo textile maker in Jaipur sells a handmade scarf to a buyer in New York over an Instagram direct message or WhatsApp chat, the buyer receives an unexpected \$12 customs duty bill at their door.
- The buyer refuses delivery, and the artisan must pay steep international return shipping costs, completely wiping out their margin.
- While multinational platforms possess enterprise compliance teams to calculate Delivered Duty Paid (DDP) logistics, solo artisans have no customs broker, no tariff software, and no integrated checkout.
- Under Reserve Bank of India (RBI) regulations, Indian PayPal accounts can only process **international export transactions**—making cross-border sales their primary economic gateway.

**Film-to-Export** gives every artisan an autonomous customs broker and compliant export pipeline on their phone.

---

## Architecture Overview

```
                      ┌──────────────────────────────────────────────┐
                      │             Artisan's Smartphone             │
                      │  Films workbench & speaks in Hindi/English   │
                      └──────────────────────┬───────────────────────┘
                                             │ Video frames + Audio
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Backend Service (Render)                               │
│                                                                                        │
│   1. Multimodal Perception ──────► Google Gemini 2.5 Flash                             │
│                                    Extracts items, condition, materials & translates   │
│                                                                                        │
│   2. Live Tariff Lookup    ──────► Official USITC HTS REST API                         │
│                                    Retrieves government heading & hierarchical lines   │
│                                                                                        │
│   3. Agentic Refinement    ──────► Gemini Autonomous Line Refinement                   │
│                                    Catches classification errors & self-corrects       │
│                                                                                        │
│   4. Compliance Screening  ──────► CITES, Wildlife & Sanctions Engine                 │
│                                    Screens prohibited materials before publishing      │
│                                                                                        │
│   5. DDP Calculation       ──────► Base price + Official US Import Duty                │
│                                    Maps duty cleanly to PayPal tax_total               │
│                                                                                        │
│   6. Database Persistence  ──────► Neon Serverless PostgreSQL                         │
│                                    Orders, batches & media persistence (BYTEA)         │
└────────────────────────────────────┬───────────────────────────────────────────────────┘
                                     │
                  ┌──────────────────┴──────────────────┐
                  ▼                                     ▼
┌────────────────────────────────────┐┌────────────────────────────────────┐
│      International Buyer (US)      ││           Artisan Portal           │
│                                    ││                                    │
│ • Shareable Pay Link (/pay/:id)    ││ • Streaming Broker Desk (SSE)      │
│ • Clean Delivered Duty Paid total  ││ • Seller Storefront (/shop)        │
│ • PayPal Orders v2 Sandbox Checkout││ • Orders Ledger (AG Grid v36)      │
│ • Verified payment capture         ││ • DDP Commercial Invoice PDF       │
└────────────────────────────────────┘└────────────────────────────────────┘
```

---

## Sponsor Technologies Used

| Sponsor / Platform | How It Is Meaningfully Integrated |
|---|---|
| **PayPal** | **PayPal Orders v2 REST API & JS SDK:** Cleanly isolates US import duties in `amount.breakdown.tax_total` and `items[].tax` for DDP compliance; verifies payments server-side before issuing commercial invoices. |
| **Google Gemini** | **Gemini 2.5 Flash:** Multimodal extraction of items from video frames, Devanagari Hindi audio transcription, English translation, and zero-hallucination HTS line refinement. |
| **AG Grid** | **AG Grid Community (v36):** Renders the seller order ledger with real-time sorting, filtering, transaction badges, and embedded PDF invoice downloads. |
| **Postman** | **Postman Collection v2.1:** Pre-configured suite (`postman_collection.json`) testing health, tariff lookups, PayPal orders, and invoice generation against the live deployment. |
| **Render** | **Cloud Deployment:** Houses the continuous single-service deployment with automated builds and TLS endpoints. |
| **Neon PostgreSQL** | **Database & Media Storage:** Serverless PostgreSQL database storing transactional records and persisting image data (`BYTEA`) across ephemeral container lifecycles. |

---

## Workflow: From Workbench to Export in 60 Seconds

1. **Multimodal Workbench Perception:** The maker uploads a phone pan of her workbench and speaks in Hindi or English (e.g., *"This is a pure cotton block-printed scarf from Jaipur, ₹2,500"*).
2. **Autonomous Broker Stream (SSE):** The backend streams progress events to the client over Server-Sent Events.
3. **Official USITC Tariff Grounding:** The agent queries the live **USITC HTS REST API** for the official tariff heading, retrieving legal definitions and duty percentages.
4. **Self-Correcting Line Refinement:** If Gemini initially proposes heading `6214.20` (wool), it cross-references official hierarchical descriptions against the maker's actual cotton materials and self-corrects to `6214.90.00`.
5. **Restricted Materials Screening:** Evaluates item attributes against CITES and wildlife watchlists, preventing pay links from being generated for prohibited goods (ivory, shahtoosh, red sanders).
6. **Delivered Duty Paid (DDP) Checkout:** Generates a shareable PayPal checkout link (`/pay/:itemId`) isolating import duties cleanly under `tax_total`.
7. **Server-Side Verification & Commercial Invoice:** Captures and cryptographically verifies the transaction against PayPal Sandbox, instantly producing a compliant DDP Commercial Invoice PDF ready to tape to the parcel.
8. **Seller Ledger (Powered by AG Grid):** Renders all verified transactions in an interactive AG Grid table with column filtering and invoice downloads.

---

## Live Links & Testing Resources

- **Hosted Application:** [https://film-to-export.onrender.com](https://film-to-export.onrender.com)
- **Public GitHub Repository:** [https://github.com/SACHIN-619/film-to-export](https://github.com/SACHIN-619/film-to-export)
- **Postman API Collection:** [`postman_collection.json`](postman_collection.json) (import directly into Postman)
- **Open Source License:** [MIT License](LICENSE)

---

## Local Development & Setup

### Prerequisites
- **Node.js** >= 22.13
- **PostgreSQL** (Free connection string from [Neon](https://neon.tech) or Supabase)

### Setup Instructions

```bash
# 1. Clone the repository
git clone https://github.com/SACHIN-619/film-to-export.git
cd film-to-export

# 2. Install dependencies
npm install

# 3. Configure environment variables
# Copy .env.example to .env and set your DATABASE_URL
# GEMINI_API_KEY and PayPal credentials are optional (runs in labelled simulation mode without them)
cp .env.example .env

# 4. Start the application
npm run dev
```

Visit `http://localhost:8787` in your browser. Database migrations run automatically on startup.

### Running Automated Tests

```bash
# Run full Vitest suite (85+ offline tests via in-memory Postgres)
npm test

# Run TypeScript typechecks across client and server
npm run typecheck
```

---

## Project Structure

- [`client/`](client/): React 19 single-page application, AG Grid ledger, and DDP checkout views ([Read Frontend Documentation](client/README.md)).
- [`server/`](server/): Express TypeScript API, Gemini vision integration, USITC tariff client, and PayPal Orders v2 service ([Read Backend Documentation](server/README.md)).
- [`postman_collection.json`](postman_collection.json): Complete Postman collection for testing API routes.
- [`LICENSE`](LICENSE): Standard OSI-approved MIT License.

---

## Honesty Notes for Hackathon Evaluators

- **Demo Media:** Test footage in `/demo-media/` consists of representative artisan goods for repeatable demonstration purposes.
- **Customs Advice Disclaimer:** Duty calculations reflect official USITC base rates and current import surcharges for India; they are technical estimates and do not constitute formal customs advisory.
- **Payments:** Transactions operate in PayPal Sandbox environment (`api-m.sandbox.paypal.com`).
