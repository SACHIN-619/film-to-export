# Demo script (target 2:45): an AI customs broker in your pocket

**Honesty rules for the video**
- The Hindi clips in `demo-media/` are **AI-generated sample footage**, not a real artisan. Say so on screen: a caption at 0:20, "Sample footage (AI-generated). Real maker footage in production."
- Every duty figure is an **estimate, not customs advice**. Say "estimated" each time.
- Payments are **PayPal Sandbox** (test money). Show the banner.
- If a run is a replay, the app shows **"REPLAY … Not a live run."** Leave it visible, and don't call a replay "live".

**Setup**
- `npm.cmd run demo:reset`, then `npm.cmd run dev`. Chrome 1440×900, all keys in `.env`.
- The banner must read **AI · Gemini live** and **Payments · PayPal Sandbox**.
- The day before, do one full live run with `demo-media/Brass_lampt and scarf.mp4`, so a recorded run exists for **Replay**. The free Gemini tier allows only a few runs per day (see COMMON_STEPS §2b).
- Keep a second Chrome profile, logged out of PayPal, for the US buyer (Sandbox personal, **US** country).

| Time | Screen | Click / action | Voice-over |
|------|--------|----------------|------------|
| 0:00 | Title card: "Aug 29, 2025: the US ended duty-free entry for small parcels. From July 2027 it's law." | — | "Last year the US ended duty-free entry for small parcels from every country. Now every parcel owes import duty." |
| 0:10 | Title card: "Buyer gets a bill at the door → refuses → maker pays the return" | — | "Buyers get surprise bills at the door and refuse the parcel. Big platforms handle this. A maker selling on Instagram can't." |
| 0:18 | Broker desk | Point at the banner | "So we built her a customs broker that lives in her phone. Live Gemini, live US tariff schedule, PayPal Sandbox." |
| 0:24 | Desk, intake | Drop `Brass_lampt and scarf.mp4` (caption: *AI-generated sample footage*) → **Run the broker** | "She films her pieces and talks, in Hindi." |
| 0:30 | Timeline: perceive + transcript | Let the transcript step land; point at the Devanagari plus the English | "One Gemini call watches the video and listens: two pieces, and the price she said, 2,500 rupees." |
| 0:45 | Timeline: per piece | Point at **Reading heading 6214 of the official US tariff schedule** (LIVE · USITC chip) | "Now it works like a broker. It reads the official US tariff schedule live: not a guess, the government's own data." |
| 0:58 | Timeline: refine step | Point at **Picked / Corrected …** with its reason | "The exact line decides the duty, so it matches the material to the official line. When the first guess is wrong, cotton filed as wool, it corrects itself and says why." |
| 1:10 | Timeline: duty + restricted + price | Point at the three steps | "Estimated duty: base rate plus the current surcharge on Indian goods, flagged as uncertain. A restricted-materials screen. Then a duties-included price." |
| 1:22 | Result cards | **Review & confirm** on the scarf → **Confirm** | "She stays in charge. Nothing is sold until she confirms price, condition and code." |
| 1:30 | Pay link panel | **Get PayPal link** → show the QR + message → **Copy message** | "Then one tap gives her a PayPal link and a ready-to-send message. She pastes it into the Instagram DM." |
| 1:40 | Buyer profile: `/pay/…` | Show piece + est. US import duty = total, "No surprise bill at your door" | "The buyer in the US sees one honest total, duty included." |
| 1:50 | PayPal Sandbox popup | Log in as the **US** Sandbox buyer → **Complete Purchase** | "And pays with PayPal. The duty travels as its own tax line in the PayPal order." |
| 2:02 | Order page | "Payment verified", goods/duty lines, capture id | "Our server captures the payment and checks the amount with PayPal, duty included, before anything counts as paid." |
| 2:12 | Commercial invoice | Scroll: HS line, origin India, declared value, duty prepaid, **Incoterm DDP** | "And the paperwork writes itself: a commercial invoice, Delivered Duty Paid, with the official tariff line and the duty basis." |
| 2:25 | PDF | **Download PDF** | "Print it, tape it on, ship it." |
| 2:30 | Closing card | — | "A customs broker in your pocket. Gemini listens and reads, the US tariff schedule decides, PayPal gets her paid. Estimates, not customs advice, and the maker always confirms." |
| 2:45 | End | | |

**Fallbacks**
- **Gemini over quota or overloaded:** the app switches to the fallback model and says so in the step. If both fail, use **Replay last run** (labelled REPLAY) and say "this is a recorded run".
- **USITC API unreachable:** the step shows **FALLBACK · cited table**. Say so.
- **Buyer popup error:** you're probably logged in as an **India** Sandbox buyer. Use the US one.
