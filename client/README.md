# Film-to-Export — Frontend Architecture & Client Documentation

> **React 19 Single Page Application (SPA):** High-performance, editorial user interface engineered for artisans and international buyers, integrating AG Grid data grids, Server-Sent Events (SSE) streaming timelines, and official PayPal JS SDK checkout flows.

---

## Technical Specifications & UI Tech Stack

| Technology | Version | Purpose & Implementation Details |
|---|---|---|
| **React** | `^19.3.1` | Modern concurrent rendering, hooks (`useMemo`, `useState`, `useEffect`, `useCallback`), and strict component lifecycle management. |
| **Vite** | `^8.3.5` | Fast build tool offering Hot Module Replacement (HMR) and optimized Rollup tree-shaking for production assets. |
| **AG Grid React** | `^36.3.0` | Powers the enterprise seller ledger with sortable columns, text filters, custom badge renderers, and responsive grid layouts. |
| **AG Grid Community** | `^36.3.0` | Core grid engine providing client-side sorting, pagination, and data cell virtualization. |
| **React Router DOM** | `^7.18.5` | Client-side routing engine managing application views, dynamic URL parameters (`/shop/:id`, `/pay/:id`, `/orders/:id`), and browser history. |
| **PayPal JS SDK** | Official Script | Official PayPal client-side checkout wrapper rendering smart payment buttons directly in the DOM. |
| **QRCode** | `^1.5.4` | In-browser SVG matrix generation for instant mobile pay link sharing via WhatsApp and QR scanning. |
| **Typography & CSS** | Custom Design System | Modern typography-first aesthetic utilizing CSS Grid, Flexbox, responsive clamp sizing, and semantic color tokens. |

---

## Detailed Directory & Component Architecture

```
client/
├── src/
│   ├── components/               # Reusable presentation and interactive components
│   │   ├── bits.tsx              # UI primitives: Spinner, StatusPill, FixtureTag, StatusBadges
│   │   └── Checkout.tsx          # PayPal JS SDK checkout integration and payment lifecycle handler
│   ├── pages/                    # Core view controllers and application pages
│   │   ├── Desk.tsx              # Broker Desk: Multimodal media ingestion & live SSE streaming timeline
│   │   ├── Home.tsx              # Editorial homepage detailing the de minimis crisis & artisan mission
│   │   ├── OrderPage.tsx         # Detailed order confirmation receipt with commercial invoice preview
│   │   ├── Orders.tsx            # Enterprise Seller Ledger powered by AG Grid Community (v36)
│   │   ├── Product.tsx           # Product display & standalone DDP checkout page (`/pay/:itemId`)
│   │   ├── Shop.tsx              # Public storefront catalog with responsive artisan cards
│   │   └── Studio.tsx            # Legacy batch management portal
│   ├── api.ts                    # Type-safe API client wrapper (`fetch`) with error boundaries and currency helpers
│   ├── App.tsx                   # Top-level application shell, navigation header, and live mode strip
│   ├── main.tsx                  # Application bootstrap and React DOM mounting point
│   ├── styles.css                # Global stylesheet containing typography, CSS grid layouts, and color variables
│   └── types.ts                  # Shared TypeScript interfaces for items, orders, batches, and tariff events
├── index.html                    # Single-page application HTML entrypoint with viewport configurations
└── README.md                     # Frontend architectural documentation
```

---

## Route Map & UI Experience

| Route | View Component | Key Functionality & User Experience |
|---|---|---|
| `/` | `Home.tsx` | Landing presentation outlining the August 2025 de minimis repeal, why cross-border export is essential for Indian makers, and step-by-step workflow. |
| `/studio` | `Desk.tsx` | **The Customs Broker Desk:** The central artisan interface. Supports drag-and-drop video/photo upload, native audio recording, and a live SSE timeline displaying Gemini reasoning, USITC tariff queries, self-correction, and DDP pricing. |
| `/shop` | `Shop.tsx` | Clean, editorial storefront displaying published items, condition grades, USD pricing, and automated out-of-stock badges. |
| `/shop/:id` | `Product.tsx` | Focused piece view with bilingual descriptions (English/Spanish), defect notes, dimensions, and Delivered Duty Paid cost breakdowns. |
| `/pay/:id` | `Product.tsx` (variant="pay") | Chat-optimized, standalone buyer checkout view designed for WhatsApp / Instagram DM sharing with an integrated PayPal button. |
| `/orders` | `Orders.tsx` | **Seller Order Ledger (AG Grid):** Interactive financial data table with multi-column sorting, text search, payment verification buttons, and one-click DDP Commercial Invoice PDF downloads. |
| `/orders/:id` | `OrderPage.tsx` | Post-purchase confirmation page verifying settled PayPal transaction IDs, capture IDs, and invoice details. |
| `/about` | `Home.tsx` | Informational overview of the project's economic mission and technical foundations. |

---

## Deep Technical Innovations in the Client

### 1. Enterprise Seller Ledger Powered by AG Grid (v36)
In `client/src/pages/Orders.tsx`, we implemented **AG Grid Community**:
- **Module Architecture:** Configured using `AllCommunityModule` and `ModuleRegistry` for minimal bundle overhead.
- **Interactive Capabilities:** Provides instant column sorting (by Order Date, Price, Status) and filtering across buyer names, item titles, and transaction states.
- **Custom Cell Renderers:**
  - *Order ID Renderer:* Displays styled monospaced identifiers alongside localized timestamp captions.
  - *Status Renderer:* Renders real-time transaction badges (`paid`, `payment_pending`, `created`, `failed`) and includes an inline **"Check with PayPal"** button to reconcile pending authorizations against server records.
  - *Invoice Download Renderer:* Renders direct hyperlinked buttons downloading vector Commercial Invoice PDFs (`/api/invoices/:id/pdf`).

### 2. Real-Time Streaming Agent Timeline (Server-Sent Events)
In `client/src/pages/Desk.tsx`, the client establishes a persistent SSE connection with `/api/broker/run`:
- Real-time event dispatches (`perceive`, `tariff_lookup`, `hts_refine`, `duty`, `restricted_check`, `price`, `done`) update a live timeline.
- Micro-interactions communicate model reasoning, displaying tool icons, execution times in milliseconds, and badge highlights when the agent self-corrects tariff codes.

### 3. Transparent Delivered Duty Paid (DDP) Pricing
In `client/src/pages/Product.tsx`, the `DutyPrice` component breaks down the total cost:
- Displays base item price and estimated US import duty separately while presenting **one honest total** to the buyer.
- Prevents buyer hesitation by clearly displaying: *"No surprise bill at your door. Every parcel into the US owes duty. You pay it here, and the seller ships Delivered Duty Paid (DDP)."*

### 4. Resilient Image Handling & Dynamic Fallbacks
To handle cloud deployments gracefully:
- Images include `onError` handlers to suppress broken image icons if media is pending replication.
- Supports both SVG vector illustrations (for fixture simulations) and dynamically streamed binary images from the PostgreSQL backend.
