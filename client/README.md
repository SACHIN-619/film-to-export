# Film-to-Export — Frontend Architecture & UI

This directory contains the single-page application (SPA) client for **Film-to-Export**, built with React 19, TypeScript, and Vite.

## Tech Stack

- **Framework:** React 19 + TypeScript
- **Bundler:** Vite
- **Data Table:** AG Grid Community (`ag-grid-react` v36)
- **Styling:** Custom typography-first CSS with editorial aesthetics, CSS grid, and responsive layouts
- **Routing:** React Router v7 (`react-router-dom`)
- **Payments:** Official PayPal JS SDK (`@paypal/react-paypal-js`)
- **QR Codes:** `qrcode` for one-tap WhatsApp / mobile pay link sharing

## Application Pages & Routes

| Route | Component | Purpose |
|---|---|---|
| `/` | `Home.tsx` | Overview of the cross-border challenge, value proposition for Indian artisans, and workflow summary. |
| `/studio` | `Desk.tsx` | **Broker Desk:** Multimodal workbench upload zone (video/photos), voice note recorder, and real-time streaming timeline of agent execution (perceive, live tariff lookup, self-correcting line refinement, restricted material screening, and DDP pricing). |
| `/shop` | `Shop.tsx` | Public artisan storefront for browsing pieces and viewing DDP pricing. |
| `/shop/:id` | `Product.tsx` | Focused piece view with bilingual descriptions, condition notes, and breakdown of US import duties. |
| `/pay/:id` | `Product.tsx` (variant="pay") | Chat-optimized, standalone buyer checkout page designed to be shared via WhatsApp / Instagram DM with instant PayPal button. |
| `/orders` | `Orders.tsx` | **Seller Ledger (Powered by AG Grid):** Interactive, sortable, filterable ledger showing order status, buyer details, PayPal verification, and instant Commercial Invoice PDF downloads. |
| `/orders/:id` | `OrderPage.tsx` | Dedicated order confirmation page showing verified payment breakdown and invoice preview. |
| `/about` | `Home.tsx` | Project background, regulatory context on US de minimis repeal, and PayPal cross-border architecture. |

## Key Frontend Features

1. **Real-Time Agent Stream via SSE:** `Desk.tsx` connects to `/api/broker/run` using Server-Sent Events to stream each step of Gemini multimodal reasoning, official USITC government queries, and price estimations.
2. **Enterprise Data Grid with AG Grid:** `Orders.tsx` leverages AG Grid Community modules (`AllCommunityModule`) for client-side sorting, filtering, and custom cell rendering for payment badges and invoice downloads.
3. **Transparent DDP Duty Display:** `Product.tsx` cleanly breaks down the base item price and the estimated import duty, ensuring international buyers never face surprise customs bills.
4. **Resilient Media Rendering:** Image components include graceful error handling to seamlessly display illustrations and database-persisted photos.
