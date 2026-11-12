# Film-to-Export

> **An Autonomous AI Customs Broker & Cross-Border Payment Pipeline:** Empowers solo artisans in developing nations to film their workbench, speak in their native tongue (Hindi), and instantly receive a compliant, Delivered-Duty-Paid (DDP) PayPal checkout link for international buyers—grounded in real-time United States government tariff data and managed via an AG Grid enterprise ledger.

[![Live Demo on Render](https://img.shields.io/badge/Render-Live%20Hosted%20Application-brightgreen?logo=render)](https://film-to-export.onrender.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Payments: PayPal Orders v2](https://img.shields.io/badge/PayPal-Orders%20v2%20REST-003087?logo=paypal)](https://developer.paypal.com)
[![AI: Google Gemini 2.5 Flash](https://img.shields.io/badge/AI-Google%20Gemini%202.5%20Flash-4285F4?logo=google)](https://deepmind.google/technologies/gemini/)
[![Ledger: AG Grid Enterprise/Community](https://img.shields.io/badge/Ledger-AG%20Grid%20v36-red)](https://www.ag-grid.com)
[![API Testing: Postman](https://img.shields.io/badge/API-Postman%20Collection%20v2.1-FF6C37?logo=postman)](postman_collection.json)
[![Database: Neon Serverless Postgres](https://img.shields.io/badge/Database-Neon%20PostgreSQL-00E599?logo=postgresql)](https://neon.tech)
[![TypeScript: 100% Strict](https://img.shields.io/badge/TypeScript-Strict%20Typecheck-3178C6?logo=typescript)](tsconfig.server.json)

---

## Table of Contents

1. [Executive Summary & Macro Regulatory Problem](#executive-summary--macro-regulatory-problem)
2. [Complete Technical Architecture & Data Flow](#complete-technical-architecture--data-flow)
3. [Deep-Dive Workflow & State Lifecycle](#deep-dive-workflow--state-lifecycle)
4. [Exhaustive Full-Stack Technology Matrix](#exhaustive-full-stack-technology-matrix)
5. [Sponsor Technology Integrations](#sponsor-technology-integrations)
6. [Resilience, Fault-Tolerance & Engineering Innovations](#resilience-fault-tolerance--engineering-innovations)
7. [Enterprise Scalability, Multi-Tenancy & Future Roadmap](#enterprise-scalability-multi-tenancy--future-roadmap)
8. [Automated Testing Suite & Formal Verification](#automated-testing-suite--formal-verification)
9. [Local Development, Deployment & Quick Start](#local-development-deployment--quick-start)
10. [Honesty Notes for Hackathon Evaluators](#honesty-notes-for-hackathon-evaluators)

---

## Executive Summary & Macro Regulatory Problem

### The August 29, 2025 "De Minimis" Crisis
For decades, Section 321 of the US Tariff Act of 1930 permitted foreign shipments valued under \$800 to enter the United States entirely duty-free without formal customs declarations. 

On **August 29, 2025**, the United States implemented an emergency suspension of duty-free de minimis treatment across global import channels, backed by statutory sunset clauses finalizing permanent repeal by July 2027. **Today, virtually every parcel arriving into the United States from an overseas seller incurs federal import duties.**

### The Catastrophic Impact on Micro-Artisans
In artisanal manufacturing clusters across India (such as Jaipur block printers, Moradabad metal casters, and Kashmiri weavers):
- Solo makers generate global demand organically by sharing their craftsmanship on Instagram, TikTok, and WhatsApp.
- When an American consumer purchases a \$35 hand-printed cotton scarf, foreign delivery couriers (FedEx, DHL, UPS, USPS) arrive at the buyer's home demanding an unexpected \$12 to \$18 customs duty, clearance fee, and import surcharge.
- **The buyer refuses delivery at the door.**
- The parcel is marked "abandoned" or returned across the ocean. The artisan is billed up to \$50 in return freight, obliterating their capital and destroying foreign buyer trust.

### Why Existing Software Fails Solo Makers
- **Enterprise ERPs (Avalara, Pitney Bowes, Zonos):** Demand \$10,000+ annual subscriptions, complex REST API setups, and catalog classification software designed for multi-million-dollar retailers.
- **PayPal Regulatory Context in India:** In strict compliance with Reserve Bank of India (RBI) guidelines, domestic peer-to-peer or consumer transactions inside India cannot be processed via PayPal India accounts. **PayPal in India is licensed strictly for cross-border export transactions.** Exporting is not a side feature—it is their core economic lifeline.

**Film-to-Export** bridges this divide. It democratizes international trade compliance by combining Google Gemini multimodal intelligence, live US International Trade Commission (USITC) government tariffs, and PayPal Orders v2 into an instant, 60-second mobile experience.

---

## Complete Technical Architecture & Data Flow

```
                                  ┌────────────────────────────────────────────────────────┐
                                  │                  ARTISAN WORKBENCH                     │
                                  │   Films 10-30s phone video & speaks in native Hindi    │
                                  └───────────────────────────┬────────────────────────────┘
                                                              │ Video Frames (JPEG) + Audio (WebM)
                                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             EXPRESS 5 BACKEND PIPELINE (Render)                                         │
│                                                                                                                          │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 1. Multimodal Perception Engine                                                                                      │ │
│ │    • Client-side HTML5 Canvas frame extraction or server-side FFmpeg sampling (768px wide JPEG).                     │ │
│ │    • Single-pass Google Gemini 2.5 Flash call analyzes visual frames + raw audio simultaneously.                      │ │
│ │    • Transcribes Devanagari Hindi phonetics, translates to English, identifies distinct artisan pieces.              │ │
│ │    • Extracts condition grade, condition notes, dimensions, and initial 6-digit Harmonized System (HS) hypothesis.    │ │
│ └───────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┘ │
│                                                             │ Initial HS Proposal (e.g., 6214.20)                        │
│                                                             ▼                                                            │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 2. Live Government Tariff Grounding (Zero Hallucination)                                                             │ │
│ │    • Queries official USITC HTS REST API (`https://hts.usitc.gov/reststop/search?keyword={heading}`).                │ │
│ │    • Extracts full 4-digit heading tree, assembling hierarchical paths: Parent › Child › Specific Material Subheading│ │
│ │    • Discovers live General (MFN) ad-valorem percentages across all valid national legal lines.                      │ │
│ └───────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┘ │
│                                                             │ Official Lines + Descriptions                             │
│                                                             ▼                                                            │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 3. Autonomous Agent Line Refinement & Self-Correction                                                                │ │
│ │    • Batched Gemini prompt matches verified physical materials against legal government descriptions.                │ │
│ │    • Catches and corrects classification errors (e.g., Gemini initial guess: 6214.20 "wool" corrected to             │ │
│ │      6214.90.00 "cotton" based on observed material attributes and maker testimony).                                 │ │
│ └───────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┘ │
│                                                             │ Verified HS Code + Official MFN Rate                       │
│                                                             ▼                                                            │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 4. Regulatory Sanctions & Prohibited Materials Screen                                                                │ │
│ │    • Automated screening against CITES endangered species, wildlife derivatives, and cultural antiquity databases.    │ │
│ │    • Immediate hard block on illegal materials (Ivory, Shahtoosh, Red Sanders, Tibetan Antelope).                    │ │
│ └───────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┘ │
│                                                             │ Approved Listing Parameters                                │
│                                                             ▼                                                            │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 5. DDP Landed Cost Calculation & Safe Integer Cents Math                                                             │ │
│ │    • Formula: Unit Duty = Base Price × (USITC MFN % + Section 301 / IEEPA Surcharge).                                 │ │
│ │    • All transactions computed in integer cents to prevent IEEE-754 floating-point balance mismatches.               │ │
│ └───────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┘ │
│                                                             │ Atomic Storage                                             │
│                                                             ▼                                                            │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 6. Hybrid Database & Binary Media Storage                                                                            │ │
│ │    • Neon Serverless PostgreSQL stores transactional state (batches, items, orders, invoices).                       │ │
│ │    • Extracted visual frames saved as binary BYTEA payloads in `media_files` table, ensuring permanent survival      │ │
│ │      across stateless ephemeral cloud container recycles.                                                            │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────┘
                                                              │
                              ┌───────────────────────────────┴───────────────────────────────┐
                              │                                                               │
                              ▼                                                               ▼
┌───────────────────────────────────────────────────────────┐   ┌──────────────────────────────────────────────────────────┐
│                 BUYER CHECKOUT INTERFACE                  │   │                 ARTISAN COMMAND PORTAL                   │
│                                                           │   │                                                          │
│ • Chat-ready URL: `/pay/:itemId` with embedded QR code.   │   │ • Real-time Server-Sent Events (SSE) streaming timeline. │
│ • Clear Delivered Duty Paid breakdown (Price + US Duty).  │   │ • Human-in-the-loop confirmation gate before publishing. │
│ • PayPal Orders v2 Sandbox Checkout with official SDK.    │   │ • Enterprise Seller Ledger powered by AG Grid (v36).     │
│ • Invariant: total = item_total + tax_total (duty).       │   │ • Automated compliant DDP Commercial Invoice PDF export. │
└───────────────────────────────────────────────────────────┘   └──────────────────────────────────────────────────────────┘
```

---

## Deep-Dive Workflow & State Lifecycle

```
[Phone Video Recorded] ──► [Canvas / FFmpeg Extract] ──► [Gemini Multimodal Draft]
                                                                  │
                                                                  ▼
[DDP Commercial Invoice PDF] ◄── [Server Verified Capture] ◄── [PayPal Orders v2 Link]
             │                                                    │
             ▼                                                    ▼
   [AG Grid Seller Ledger]                                [Human Confirm Gate]
```

### Stage 1: Multimodal Ingestion & Audio Parsing
- **Input Flexibility:** Accepts a single continuous video pan (10-30 seconds, MP4/WebM/MOV) or 1 to 8 high-resolution still photographs, alongside an optional native microphone audio recording.
- **Client-Side Optimization:** In modern browser sessions, video frame sampling is executed via the HTML5 Canvas API and WebCodecs to extract representative frames prior to transfer, conserving cellular data bandwidth in rural artisan hubs.
- **Single-Pass Inference:** Frames and audio bytes are submitted in a unified, multi-part request to `gemini-2.5-flash`. The model extracts distinct product entities, evaluates physical quality, notes defects with extreme honesty, and transcribes spoken Hindi audio phonetically into Devanagari and natural English.

### Stage 2: Authoritative Government Tariff Grounding
- **Live Search Query:** The agent strips punctuation from the preliminary HS code and queries the official USITC REST API endpoint (`https://hts.usitc.gov/reststop/search?keyword=...`).
- **Context Tree Reconstruction:** Because raw government HTS rows represent hierarchical indentations (where a line's description may simply read *"Other"*), our custom tree-walker reconstructs the entire legal semantic path (e.g., *"Heading 6214: Shawls, scarves, mufflers › Of cotton › Not knitted or crocheted › Other"*).

### Stage 3: Autonomous Material Refinement & Self-Correction
- **Disambiguation Challenge:** Multiple legal tariff lines exist under a single 4-digit heading with widely diverging duties (ranging from 0% Free to 16.5%).
- **Agentic Decision Engine:** The agent prompts Gemini with the maker's actual physical materials alongside the verified official USITC legal lines.
- **Visible Correction:** If the initial heuristic guessed `6214.20` ("Of wool or fine animal hair", 8.4%), the agent observes the artisan's spoken confirmation of cotton block printing, catches the error, and self-corrects to `6214.90.00` ("Of other textile materials: cotton", 7.2%). This entire audit trail is logged and displayed transparently to the user.

### Stage 4: Regulatory Sanctions & CITES Screening
- **Automated Watchlist Audit:** Prior to pricing, all item descriptions, materials, and titles pass through a deterministic keyword screen checking international trade embargoes, CITES Appendix I & II listings, and wildlife protection treaties.
- **Hard Gate:** If terms matching prohibited animal or botanical materials (e.g., *shahtoosh, ivory, turtle shell, red sanders, tiger bone*) are detected, the item is tagged with a hard violation status, blocking pay link generation and warning the seller against illegal exportation.

### Stage 5: Delivered Duty Paid (DDP) Mathematical Isolation
- **Customs Valuation:** Computes the ad-valorem duty based on transaction value.
- **Penny-Perfect Integrity:** All monetary figures are converted into integer cents ($1.00 = 100 cents) using zero-loss arithmetic, preventing JavaScript floating-point errors (`0.1 + 0.2 !== 0.3`).
- **PayPal Tax Invariant:** In the PayPal Orders v2 payload, customs duty is allocated directly to `amount.breakdown.tax_total` and line-item `tax`. PayPal's verification engine strictly rejects orders where `item_total + tax_total !== total`. Film-to-Export mathematically guarantees exact parity.

### Stage 6: Human-in-the-Loop Confirmation Gate
- **Zero Accidental Publishing:** The system enforces an unyielding human gate. No product can be published, linked, or purchased until the artisan views the proposed title, price, condition notes, and HS classification, clicking **Confirm**.
- **Chat Commerce Generation:** Upon confirmation, the artisan receives a shareable short-link (`/pay/:itemId`), an instant SVG QR code, and a pre-formatted WhatsApp / Instagram direct message template:
  > *"Namaste! Here is your custom link for the Hand Block-Printed Scarf. Total: $35.00 piece + $2.52 prepaid US import duty. No surprise bills on delivery. Paid securely with PayPal: https://film-to-export.onrender.com/pay/it_xxx"*

### Stage 7: Server-Side Cryptographic Capture & Verification
- When the international buyer clicks the PayPal checkout button, the frontend invokes `/api/orders` to instantiate the order on PayPal Sandbox.
- Upon buyer approval, our backend executes `/v2/checkout/orders/{id}/capture`.
- **Anti-Fraud Integrity Check:** The backend inspects the capture response, cryptographically verifying that the captured currency is `USD`, the receiving merchant ID matches the seller, and the amount captured equals the exact goods price plus calculated duty to the penny.

### Stage 8: Automated Commercial Invoice Generation
- Once the order transitions to `paid`, the system invokes `pdfkit` to compile an export-compliant, vector **Commercial Invoice PDF**.
- Formatted with international standard customs disclosures: Exporter IEC credentials, Consignee full address, 6-digit and 8-digit HS classification, country of origin certification ("Made in India"), declared value, and prepaid DDP customs tax line. The maker prints this PDF and tapes it directly to the outer envelope.

---

## Exhaustive Full-Stack Technology Matrix

| Layer | Component | Version / Specification | Technical Role in Film-to-Export |
|---|---|---|---|
| **Frontend Framework** | React | `^19.3.1` | Ultra-performant reactive user interface leveraging React 19 hooks and compiler optimizations. |
| **Frontend Bundler** | Vite | `^8.3.5` | Next-generation ESM development server and Rollup-based production build tool. |
| **Enterprise Data Table** | AG Grid Community | `^36.3.0` | Powers the interactive seller orders ledger with client-side sorting, text filtering, and custom cell renderers. |
| **Client Routing** | React Router DOM | `^7.18.5` | Client-side SPA routing managing desk, storefront, product details, and buyer checkout paths. |
| **Payment SDK** | PayPal JS SDK | Official v2 Script | Embedded PayPal buttons with real-time intent capture and modal authentication. |
| **QR Code Engine** | qrcode | `^1.5.4` | Client-side dynamic SVG generation of scannable mobile pay links. |
| **Backend Runtime** | Node.js | `>= 22.13.0 LTS` | High-throughput asynchronous JavaScript runtime supporting native fetch and environment configs. |
| **Server Framework** | Express | `^5.3.0` | Core HTTP engine managing REST endpoints, error boundaries, and persistent Server-Sent Events (SSE). |
| **Type System** | TypeScript | `^7.0.2` | 100% strict-mode typing across both server and client configurations (`tsconfig.server.json`, `tsconfig.client.json`). |
| **Schema Validation** | Zod | `^4.6.7` | Strict runtime parsing and contract enforcement for API inputs and AI structured outputs. |
| **Document Generation** | PDFKit | `^0.20.2` | Programmatic vector PDF compilation creating international customs Commercial Invoices. |
| **File Handling** | Multer | `^2.5.0` | Streaming multipart/form-data handler for video footage and audio recordings. |
| **Database Driver** | node-postgres (`pg`) | `^8.23.1` | Robust PostgreSQL client managing connection pooling, TLS certificates, and retry logic. |
| **Cloud Database** | Neon Serverless Postgres | AWS Region Pooler | Auto-scaling PostgreSQL 16 database with zero-idle sleep and instant connection wakeups. |
| **AI Vision / Audio** | Google Gemini 2.5 Flash | REST API via `@google/genai` | Multimodal model processing visual frames, audio phonetics, and structured JSON listings. |
| **Tariff API** | USITC REST API | `hts.usitc.gov` | Official US government customs database accessed via live REST keyword endpoints. |
| **Hosting Platform** | Render | Native Web Service | Cloud container orchestration with automatic Git builds, custom domains, and TLS termination. |
| **Unit / Mock Testing** | Vitest | `^5.0.5` | Vite-native unit testing engine delivering sub-second test execution. |
| **In-Memory Mock DB** | pg-mem | `^3.0.14` | Synchronous in-memory PostgreSQL clone for offline test runs without external network dependencies. |

---

## Sponsor Technology Integrations

Film-to-Export intentionally leverages sponsor platforms to build an integrated commerce system:

### 1. PayPal (Core Platform Requirement)
- **Integration:** Implemented **PayPal Orders v2** REST API (`/v2/checkout/orders`) and the official **PayPal JavaScript SDK**.
- **Delivered Duty Paid (DDP) Innovation:** Solves the lack of a dedicated customs duty field by mapping calculated import tariffs into `amount.breakdown.tax_total` and individual line-item taxes.
- **Server Verification Engine:** `verifyCapture.ts` ensures that only transactions cryptographically confirmed by PayPal Sandbox servers can trigger commercial invoice compilation.

### 2. Google Gemini / DeepMind (Core AI Requirement)
- **Integration:** Utilizes **Gemini 2.5 Flash** with multimodal video and audio ingestion.
- **Single-Pass Efficiency:** Analyzes visual workbench video frames alongside maker speech in a single inference call, producing structured, schema-validated JSON listings.
- **Agentic Line Refinement:** Operates as a reasoning agent to cross-reference ambiguous physical materials against legal government tariff descriptions.

### 3. AG Grid (Sponsor Tool)
- **Integration:** Installed **AG Grid Community (v36)** via `ag-grid-react`.
- **Implementation:** Replaces standard HTML tables with an interactive financial ledger in `client/src/pages/Orders.tsx`. Features client-side multi-column sorting, text filtering, dynamic status badge rendering, and instant invoice downloads.

### 4. Postman (Sponsor Tool)
- **Integration:** Created a complete, production-ready **Postman Collection v2.1** (`postman_collection.json`) at the repository root.
- **Coverage:** Pre-configured with dynamic environment variables (`baseUrl`) to test Health, App Config, Broker Replay, Storefront Catalog, Order Creation, Capture Reconciliation, and PDF Invoice Generation.

### 5. Render (Sponsor Tool)
- **Integration:** Hosted live on Render as a unified full-stack web service (`render.yaml` Blueprint).
- **Execution:** Compiles the Vite React frontend into static assets served directly through the Express Node.js application under a single TLS origin (`https://film-to-export.onrender.com`).

---

## Resilience, Fault-Tolerance & Engineering Innovations

1. **Database-Backed Persistent Media (`BYTEA`):**
   - Cloud platforms like Render utilize ephemeral container disks that wipe local directories on deployment.
   - We engineered automated schema migration `004_media.sql` creating a `media_files` table. Extracted video frames are saved directly into Neon PostgreSQL as binary `BYTEA` data. The `/media/:batchId/:filename` route checks disk first, gracefully falling back to database streams.
2. **Deterministic Agent Replay Engine:**
   - Every live agent execution logs all SSE events, tool inputs, and millisecond timestamps into the `broker_runs` table.
   - The **"Replay last run"** capability re-streams these events with original timing cadences, allowing bulletproof live demonstrations even if cloud AI APIs encounter rate limits.
3. **Automated Quota Fallbacks & Backoff:**
   - If Gemini returns `503 High Demand` or hits daily rate limits, our `visionModel.ts` adapter executes exponential backoff and automatically falls back to secondary models.
4. **Offline Cited Fallback Tariff Table:**
   - If the USITC government API experiences downtime, the broker seamlessly falls back to `server/data/duty_rates.json`—a verified offline rate table cited directly from government schedules.

---

## Enterprise Scalability, Multi-Tenancy & Future Roadmap

Film-to-Export was architected as a prototype with an enterprise expansion roadmap:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               ENTERPRISE SCALING ROADMAP                               │
├─────────────────────────┬────────────────────────────┬─────────────────────────────────┤
│ PHASE 1: IMMEDIATE      │ PHASE 2: GLOBAL EXPANSION  │ PHASE 3: ENTERPRISE ECOSYSTEM   │
├─────────────────────────┼────────────────────────────┼─────────────────────────────────┤
│ • Multi-seller accounts │ • UK (HMRC) & EU (TARIC)   │ • Automated DHL / FedEx label   │
│   via PayPal Commerce   │   tariff integration.      │   and airway bill purchase.     │
│   Platform onboarding.  │ • Currency hedging and     │ • Export credit & factoring     │
│ • Custom subdomain      │   real-time forex locking  │   underwritten by verified      │
│   artisan storefronts.  │   at checkout.             │   PayPal order history.         │
│ • Webhook-based async   │ • Multi-language voice     │ • Native mobile app with        │
│   payment confirmations │   support (Tamil, Bengali, │   on-device edge frame          │
│   (instant webhooks).   │   Gujarati, Marathi).      │   extraction.                   │
└─────────────────────────┴────────────────────────────┴─────────────────────────────────┘
```

1. **PayPal Partner Onboarding:** Replacing single-merchant credentials with PayPal Commerce Platform OAuth, enabling millions of independent artisans to link their personal PayPal business accounts with a single click.
2. **Multi-Jurisdiction Customs APIs:** Integrating the European Union’s TARIC database, the United Kingdom’s Trade Tariff service, and Canada’s CBSA schedules.
3. **Integrated Logistics & Shipping Labels:** Direct API partnerships with India Post (Dak Ghar Niryat Kendra) and DHL Express to bundle the generated DDP Commercial Invoice directly with shipping label purchasing.

---

## Automated Testing Suite & Formal Verification

The project includes an automated test suite executed via **Vitest** (`npm test`), achieving comprehensive test coverage across critical boundaries:

- **Mathematical Invariants:** Verifies that duty percentages, surcharges, and total cents match PayPal Orders v2 invariants to the exact penny.
- **Cryptographic Capture Verification:** Validates that `verifyCapture()` rejects transactions missing tax allocations, mismatched currencies, or fraudulent amounts.
- **Agentic Line Refinement:** Tests the hierarchical context-builder and verifies that material mismatches (e.g., cotton under wool) are caught and corrected.
- **Prohibited Sanctions Screening:** Verifies that CITES-listed contraband items are blocked from checkout link generation.
- **Offline In-Memory Database:** Leverages `pg-mem` to simulate PostgreSQL schemas, transactions, and rollbacks in-memory without network requirements.

---

## Local Development, Deployment & Quick Start

### System Requirements
- **Node.js:** `>= 22.13.0 LTS`
- **Database:** Hosted PostgreSQL connection string (Free on [Neon](https://neon.tech) or Supabase)

### Setup & Execution
```bash
# 1. Clone repository
git clone https://github.com/SACHIN-619/film-to-export.git
cd film-to-export

# 2. Install dependencies
npm install

# 3. Environment configuration
# Copy .env.example to .env
# Set DATABASE_URL=postgresql://...
# (GEMINI_API_KEY and PayPal credentials optional; runs in labelled simulation mode without them)
cp .env.example .env

# 4. Start local development server (Client + Server concurrently)
npm run dev
```

Open `http://localhost:8787` in your browser. Database migrations execute automatically on server startup.

### Code Quality Verification
```bash
# Execute full Vitest suite
npm test

# Run strict TypeScript validation across server and client
npm run typecheck
```

---

## Honesty Notes for Hackathon Evaluators

- **Representative Footage:** Sample artisan videos located in `/demo-media/` feature representative artisanal craft items filmed under realistic workshop conditions.
- **Customs Legal Disclaimer:** Duty rates, classification suggestions, and restricted material evaluations are technical estimates derived from live USITC schedules and do not constitute formal legal customs advice.
- **Payments:** All live payment demonstrations operate strictly within the **PayPal Sandbox** environment (`api-m.sandbox.paypal.com`).
