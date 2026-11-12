# Devpost submission (draft)

**Project name:** Film-to-Export
**Tagline:** An AI customs broker in your pocket: a maker films her work, speaks in Hindi, and gets a duties-included PayPal link for her US buyer.
**Target prizes:** Best Use of Agentic Commerce · Best Use of PayPal + AI · Best Use of AG Grid · Most Impactful
**Built with:** PayPal Orders v2 (amount breakdown `item_total` + `tax_total`) · PayPal JS SDK · AG Grid Community · Google Gemini (video frames + audio, one call) · **USITC HTS REST API (official US tariff schedule)** · Postman · React · TypeScript · Vite · Node.js · Express · Server-Sent Events · PostgreSQL (Neon) · Render · Zod · Vitest · pdfkit · qrcode

## Inspiration

On **Aug 29, 2025** the US ended duty-free entry for small parcels (the $800 "de minimis" rule) for every country ([KPMG](https://kpmg.com/us/en/taxnewsflash/news/2025/08/us-cbp-implements-eo-suspending-duty-free-de-minimis-treatment.html)). The suspension survived the 2026 court fights ([Troutman Pepper Locke on *Axle of Dearborn*](https://www.troutman.com/insights/the-800-free-pass-is-gone-cit-confirms-president-can-eliminate-de-minimis-tariff-exemption/)), and a 2025 statute makes the repeal permanent from **July 1, 2027** ([Mondaq](https://www.mondaq.com/unitedstates/international-trade-investment/1649458/de-minimis-to-be-eliminated-july-2027-under-recently-enacted-megabill)).

Now every parcel owes duty. A US buyer of a $30 hand-printed scarf gets a bill at the door, refuses the parcel, and the maker in Jaipur pays for the return. Big marketplaces collect duty at checkout. A maker who sells through Instagram and WhatsApp chats has no customs broker, no tariff expert and no checkout. And for an Indian maker, PayPal is the export door: PayPal India takes international payments only.

## What it does

The **Broker desk** is one screen. The maker drops a phone video (or photos) and talks, in Hindi or English. An agent then works through visible steps, streamed live:

1. **Perceive:** one Gemini call watches the frames and listens to the audio. It transcribes the Hindi (Devanagari plus English translation), finds each distinct piece, and drafts a bilingual listing with honest defects, the price she said in rupees, a suggested USD price and a first-guess HS code.
2. **Tariff lookup:** a live call to the **official USITC HTS API** reads the whole tariff heading, with every line's full official description and rate.
3. **Line refinement:** Gemini matches the material to one line **from that official list only**. Any answer not on the list is rejected. When the first guess was wrong (a cotton scarf filed under "wool"), the step says **"Corrected 6214.20 → 6214.90.00"** and why.
4. **Duty:** the official base rate plus the current surcharge on Indian goods (flagged *uncertain*) gives an **estimated** duty, with its basis printed.
5. **Restricted screen:** a curated keyword screen (ivory, shahtoosh, red sanders, wildlife parts, antiques, …). It blocks a pay link for likely-prohibited items. Labelled *not legal advice*.
6. **Price:** buyer total = piece + estimated duty, Delivered Duty Paid.

Then the maker **confirms** each piece (nothing sells unconfirmed) and taps **Get PayPal link**: a QR code, a ready-to-paste chat message and a WhatsApp share. The US buyer opens a focused checkout, sees **one honest total with duty included**, and pays with **PayPal**. The server captures and **verifies** the payment (reference, currency, amount = goods + duty to the cent), and a **DDP commercial invoice** (official tariff line, origin India, declared value, prepaid duty and its basis) is generated as a PDF.

## How we built it

- **Agent orchestration** is deterministic TypeScript. The model is used at two fixed steps (perceive, line refinement), and every tool call is an event streamed over SSE. Pieces run in parallel, and line refinement for all pieces goes out as **one** batched call.
- **Grounding:** the duty depends on the government's own data (USITC HTS REST API), not model memory. A cited fallback table covers outages, and the UI says which source was used.
- **Resilience we needed in real runs:**
  - Gemini returned `503 high demand` → retries with backoff, visible in the step.
  - The free tier hit its **20 requests/day** limit → a daily-quota error switches straight to a lighter fallback model, and the step says so.
  - Browser-recorded WebM wouldn't seek → frame extraction verifies frames differ, then falls back to play-through capture.
- **Payments:** a `PaymentProvider` adapter (PayPal Sandbox, or a labelled simulator). The duty goes in `tax_total` and `items[].tax`: PayPal has no duty field, and `handling` would misstate a seller fee as a levy. The order state machine reaches `paid` only from a verified capture or a server readback.
- **Demo safety:** every run is recorded. **Replay** re-streams it, labelled "REPLAY … Not a live run" on every step.
- **Tests:** 85+ (Vitest), offline via in-memory Postgres. They cover:
  - the duty math and the PayPal payload invariant (amount = item_total + tax_total);
  - capture verification, including a capture missing the duty → failed;
  - tariff parsing, line matching and the wrong-subheading correction;
  - the restricted screen (shahtoosh blocked, pashmina allowed);
  - the agent stream, replay, pay links, and Gemini retry and fallback;
  - plus an opt-in integration test against real Postgres.

## Challenges

- **Models misclassify by material.** Live, Gemini filed a cotton scarf under "wool" and, with truncated descriptions, a blue-pottery bowl under brown-glazed earthenware. Fix: read the whole official heading, give the model the full hierarchical descriptions, and accept only listed lines.
- **We were wrong too.** An official-API check caught two rates we'd copied from secondary sites, and the full hierarchy later showed a "Free" brass line was actually *chain*. Every rate in the fallback table is now verified against hts.usitc.gov, with a dated note.
- **Tariffs moved under our feet.** The Supreme Court struck down the IEEPA tariffs in Feb 2026, but de minimis stayed suspended. The extra rate on Indian goods is still in flux, so it's a separate, flagged component.
- **PayPal Sandbox realities:** India-to-India payments are blocked (use a US buyer), and IN merchants can see `PENDING` captures, which we model as `payment_pending`.

## Accomplishments

- A live end-to-end agent: Hindi video → transcript → official US tariff lines → duties-included PayPal link → verified Sandbox payment → DDP invoice PDF.
- PayPal Sandbox accepted duties-included orders exactly as built (e.g. `item_total` 32.00 + `tax_total` 5.44 = 37.44).
- The agent catches and explains its own classification mistakes against government data.

## What we learned

- **Grounding AI agents in authoritative government data is essential:** Large models hallucinate tariff codes when relying solely on memory. By querying the live USITC REST API for the full heading and then having Gemini pick exclusively from the official lines, the agent eliminated hallucinated duties and successfully self-corrected classifications.
- **PayPal Orders v2 requires strict amount breakdowns:** Since PayPal lacks a dedicated duty field, packing duties into `tax_total` while matching line-item totals is the cleanest compliant way to present Delivered Duty Paid (DDP) pricing to international buyers without surprise fees.
- **Persistent storage for agent media:** In cloud environments like Render with ephemeral disks, storing multimodal perception outputs directly in managed PostgreSQL (`BYTEA`) guarantees that generated visual assets survive continuous deployments.
- **Enterprise data management with AG Grid:** Presenting real-time cross-border order states, payment statuses, and generated invoice links in an interactive AG Grid table gave the seller an instant, professional dashboard.

## What's next

Deployed pay links (APP_PUBLIC_URL), more destination countries, brokerage-fee estimates, certificate-dependent lines (for example "certified hand-loomed and folklore products" for carpets), multi-seller onboarding through PayPal partner onboarding, and PayPal webhooks as a second confirmation path.

## Honesty notes for judges

- **The demo clips are AI-generated sample footage**, not a real artisan. The maker persona is fictional.
- **Duty figures are estimates, not customs advice.** Base rates come live from hts.usitc.gov (checked Nov 1, 2026). The India surcharge is flagged uncertain.
- **Payments are PayPal Sandbox only.**

## Links

- **Hosted Live Demo:** https://film-to-export.onrender.com
- **Public GitHub Repository:** https://github.com/SACHIN-619/film-to-export (MIT Licensed)
- **Postman API Collection:** Included in repository root (`postman_collection.json`)
- **Demo Video (<3 min):** _TODO: Add your YouTube / Loom link here_

## Testing instructions for judges

```
npm install
copy .env.example .env    # DATABASE_URL (free Neon) required; GEMINI_API_KEY and PayPal Sandbox keys optional (labelled SIMULATION without them)
npm run dev               # http://localhost:8787 → Broker desk
```
Use a **US** PayPal Sandbox personal account to pay. The free Gemini tier allows few requests per day; the app falls back to a lighter model, and **Replay last run** shows a recorded run.
