# Common steps (Windows)

All commands are for **PowerShell** in the project folder (`F:\intelLock`) unless noted.

## 1. Prerequisites

| Tool | Check | Install (system-wide; do this yourself) |
|------|-------|------------------------------------------|
| Node.js ≥ 22.13 (24 recommended) | `node -v` | `winget install OpenJS.NodeJS.LTS` |
| Git | `git --version` | `winget install Git.Git` |
| ffmpeg (optional, video uploads) | `ffmpeg -version` | `winget install Gyan.FFmpeg`, then open a new terminal |

Without ffmpeg the app still works: upload photos instead of a video.

## 2. Getting your keys

You need **one required value** (`DATABASE_URL`) and **two optional sets** (Gemini, PayPal). Without Gemini or PayPal keys, those halves run in a clearly labelled **SIMULATION** mode. The database is always required, even in SIMULATION, because listings, orders and invoices live there.

Start by creating your `.env`:

```powershell
Copy-Item .env.example .env
notepad .env
```

### 2a. Database: Neon (recommended, free)

1. Go to <https://neon.tech> → **Sign up** (GitHub or Google login is fine).
2. **Create project** → name it `film-to-export` → pick the region nearest to you (e.g. *AWS Asia Pacific (Mumbai)* or *US East*) → **Create**.
3. On the project dashboard click **Connect** (or **Connection string**).
4. Keep the defaults (branch `main`, database `neondb`, role `neondb_owner`) and copy the string. It looks like
   `postgresql://neondb_owner:abc123@ep-cool-name-123456.ap-south-1.aws.neon.tech/neondb?sslmode=require`
5. Paste it into `.env`: `DATABASE_URL=postgresql://...`
6. Start the app (section 3). The schema migration (`server/migrations/001_init.sql`) runs automatically on startup.

**Alternative: Supabase**

1. <https://supabase.com> → **New project** → set a database password (save it) → pick a region → **Create**.
2. **Project Settings → Database → Connection string** (or the **Connect** button at the top).
3. Choose **Transaction pooler** (port **6543**), copy the URI, and replace `[YOUR-PASSWORD]` with your password.
4. Paste it into `.env` as `DATABASE_URL=...`.
5. If startup fails with a certificate error such as `self-signed certificate in certificate chain`, add `DATABASE_SSL_VERIFY=false`. The connection stays encrypted; only certificate verification is skipped.

If `DATABASE_URL` is missing, the app prints how to get one and exits. There is no hidden local-database fallback.

### 2b. Gemini API key (live AI)

1. Open <https://aistudio.google.com> and sign in with a Google account.
2. Click **Get API key** (left sidebar or top right).
3. Click **Create API key** → choose or create a Google Cloud project → **Create**.
4. Copy the key and put it in `.env`: `GEMINI_API_KEY=...`
5. Optional: `GEMINI_MODEL=` any vision-capable model (default `gemini-2.5-flash`), and `GEMINI_FALLBACK_MODEL=` (default `gemini-3.5-flash-lite`; `none` disables it).

The key is server-only: it is sent to Google in a request header and never to the browser.

**Free-tier limits (seen Nov 1, 2026):** `gemini-2.5-flash` allowed only **20 requests per day** on the free tier. One broker run uses **2 requests** (perceive + one batched line refinement), so that's about 10 runs a day. When the daily quota is spent, the app switches to the fallback model and says so in the step. If a model is retired, Google's error names the replacement (on Nov 1, `gemini-3.8-flash` and `gemini-3.5-flash-lite` were current). Put it in `GEMINI_MODEL`. For demo day, consider enabling billing on the Google Cloud project (paid tier limits are much higher), and record a run the day before so **Replay last run** works.

### 2c. PayPal Sandbox (live checkout)

**Create the two test accounts first:**

1. Go to <https://developer.paypal.com> → **Log in to Dashboard** with your normal PayPal account.
2. Make sure the toggle at the top says **Sandbox**, not Live.
3. **Testing Tools → Sandbox Accounts → Create account**:
   - **Business**, country **India** → this is the seller (Kavya). Payments land here.
   - **Personal**, country **United States** → this is the buyer you log in as at checkout.
4. Click **⋯ → View/Edit account** on each to see its sandbox email and password. These are test-only logins.

**Then create the REST app:**

5. **Apps & Credentials** (Sandbox toggle still on) → **Create App**.
6. App name `film-to-export`, type **Merchant**, **Sandbox Business Account** = the **India business** account from step 3 → **Create App**.
7. Copy the **Client ID** → `.env` `PAYPAL_CLIENT_ID=...`
8. Click **Show** under **Secret key 1**, copy it → `.env` `PAYPAL_CLIENT_SECRET=...`
9. Restart the app. The banner should read **Payments · PayPal Sandbox**.

**What's public and what's secret:**

- **Client ID is public.** The server hands it to the browser, and the PayPal JS SDK uses it to draw the buttons. Seeing it in page source is normal.
- **Secret is server-only.** It lives only in `.env`. Never commit it, paste it into client code, or share it in chat or screenshots.
- **Never paste Live credentials.** This app only talks to `https://api-m.sandbox.paypal.com`, and Live keys don't belong in a hackathon repo. If the dashboard says **Live**, switch back to **Sandbox**.

**If a capture comes back `PENDING`:** some IN Sandbox business accounts hold USD payments for manual acceptance. The app shows *Payment pending* and issues no invoice. Log in to <https://www.sandbox.paypal.com> as the IN business account and accept the payment (or set it to auto-accept and convert foreign currency), then click **Re-check with PayPal** on the order page. Last resort: create a **US business** Sandbox account for the app and say so in the video.

### 2d. Keeping keys safe

- The app reads `.env` in the project root first, then `server/.env` as a fallback. Both are **gitignored**. Only `.env.example` (blank placeholders) is committed. Check with `git status` before every commit: `.env` must never appear.
- Before pushing, run `git grep -n "PAYPAL_CLIENT_SECRET=." ; git grep -n "AIza" ; git grep -n "postgresql://.*:.*@"`. Each must print nothing (apart from the placeholder examples in `.env.example` and the docs).
- **If a key leaks** (committed, pasted, shown on screen), rotate it immediately:
  - **PayPal:** Apps & Credentials → your app → generate a new secret, then delete the old one.
  - **Gemini:** AI Studio → API keys → delete the key → create a new one.
  - **Neon:** project → Roles → `neondb_owner` → **Reset password** (gives a new connection string). **Supabase:** Project Settings → Database → **Reset database password**.
  - Update `.env`, then restart. Removing the key from git history is not enough; rotating is what protects you.

## 3. Install and run

Run everything from the **project root** (`F:\intelLock`), not from `server\` or `client\`. It's one app: a single command starts the API and the frontend together.

```powershell
npm install
npm run dev                      # http://localhost:8787  (API + Vite in one process)
```

**`npm.ps1 cannot be loaded because running scripts is disabled`?** That's Windows PowerShell's script policy, not the app. Pick one:

- Use `npm.cmd` instead of `npm` (no settings change): `npm.cmd install`, `npm.cmd run dev`.
- Or use **Command Prompt** (`cmd`) instead of PowerShell; `npm` works there as-is.
- Or allow local scripts for your user only (a security setting; your call): `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

The first start after Neon has been idle can take a few seconds while the database wakes up; the app retries automatically.

The startup banner shows the AI mode, the payments mode and the database host (never the password).

Production-style run:

```powershell
npm run build
npm start                        # serves dist/client + API on PORT (default 8787)
```

## 4. Test, typecheck, build

```powershell
npm run typecheck
npm test                         # offline: uses an in-memory Postgres (pg-mem)
npm run build
```

`npm test` never needs the cloud. If `DATABASE_URL` is set (e.g. in `.env`), one extra **integration test** also runs against your real database. It works inside a throwaway schema (`fte_it_xxxx`) that it drops afterwards, so your app's tables aren't touched.

## 5. Environment variables (`.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | **yes** | Postgres connection string (Neon or Supabase); TLS for remote hosts |
| `DATABASE_SSL_VERIFY` | no | `false` skips certificate verification (still encrypted) |
| `PORT` | no | default `8787` |
| `GEMINI_API_KEY` | for live AI | blank → AI SIMULATION (fixture items, labelled) |
| `GEMINI_MODEL` | no | default `gemini-2.5-flash` |
| `PAYPAL_CLIENT_ID` | for live payments | Sandbox app client ID (public) |
| `PAYPAL_CLIENT_SECRET` | for live payments | **secret**, server-only |
| `PAYPAL_CREATE_INVOICE` | no | `true` also creates a PayPal Invoicing draft (stretch) |
| `BUYER_LANGUAGE` | no | second listing language: `es`, `fr`, `de`, `ja`, … (default `es`) |
| `DATA_DIR` | no | local folder for uploaded photos and frames (default `./data`) |

## 6. Reset the demo

```powershell
npm run demo:reset               # empties the app's Postgres tables, re-seeds the seller, clears ./data/uploads
```

## 7. Record the demo video

1. `npm run demo:reset`, then `npm run dev`. Use Chrome at 1440×900 and 100% zoom, and hide bookmarks (Ctrl+Shift+B).
2. Keep the photos or video for the 4 items ready in one folder.
3. Use a fresh Chrome profile so no real PayPal session is logged in.
4. Record with **Win+Alt+R** (Xbox Game Bar) or OBS (1080p, 30 fps).
5. Follow `docs/DEMO_SCRIPT.md`. Keep it under 3:00 and cut the AI wait if needed (say "sped up" on screen).
6. Don't show `.env` or the PayPal dashboard's secret on screen.
7. Upload to YouTube as **Unlisted** or Public and paste the link into Devpost.

## 8. Push to GitHub

```powershell
git status                        # .env and data/ must NOT be listed
git add .
git commit -m "Film-to-Export: hackathon build"
gh repo create film-to-export --public --source . --push
# or: create an empty public repo on github.com, then
# git remote add origin https://github.com/<you>/film-to-export.git
# git push -u origin main
```

Run the secret check from 2d before the first push.
