# Deploy: GitHub → Render (Windows)

Film-to-Export is **one Node app**: Express serves the API and the built React frontend. You deploy **one** Render Web Service, not two.

All commands are for **PowerShell** in `F:\intelLock`. Use `npm.cmd` (plain `npm` is blocked by PowerShell's script policy on this PC), or use Command Prompt, where `npm` works as-is.

---

## 1. Pre-push safety check (2 minutes)

```powershell
cd F:\intelLock
git status
```

These must **not** appear in the list. They're gitignored, and you can verify with the next command:

```powershell
git check-ignore .env server/.env data demo-media dist node_modules
```

Every path you typed should be printed back (`.env` may not exist; that's fine). If a path is *not* printed, stop and tell me.

**Secret scan.** Each command should print nothing:

```powershell
git add -A --dry-run | Select-String -Pattern "\.env$|server/\.env|demo-media|data/"
git grep --untracked -n -I -E -e "AIza" -e "PAYPAL_CLIENT_SECRET=." -e "postgres(ql)?://[^:/ ]*:[^@ ]{8,}@" -- . ":!docs" ":!.env.example" | Select-String -NotMatch "USER:PASSWORD@"
```

(It looks for Google keys, a filled-in PayPal secret, and database URLs with a real-length password. The docs and `.env.example` contain *placeholders* like `postgresql://USER:PASSWORD@…`, which is why they're excluded. The tests use dummy `u:p@` URLs, which don't match.)

Then run the checks the project ships with:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

All three must pass.

## 2. Push to a new public GitHub repo

1. Open <https://github.com/new>.
2. **Repository name:** `film-to-export` (or your choice). **Public.**
3. **Do NOT** tick "Add a README", ".gitignore" or "license": the project already has them.
4. Click **Create repository** and copy the URL it shows, e.g. `https://github.com/YOUR-USERNAME/film-to-export.git`.

Back in PowerShell:

```powershell
cd F:\intelLock
git add -A
git status                                  # last look: no .env, no data/, no demo-media/
git commit -m "Film-to-Export: AI customs broker for makers (PayPal AI Hackathon)"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/film-to-export.git
git push -u origin main
```

**If git asks you to log in:**
- A browser window may open ("Git Credential Manager"). Sign in to GitHub and approve. Done.
- If it asks for a *password* in the terminal: GitHub no longer accepts account passwords. Create a token at <https://github.com/settings/tokens?type=beta> (**Fine-grained**, repository access: *only* `film-to-export`, permission **Contents: Read and write**) and paste the **token** as the password.
- Easiest alternative: install **GitHub Desktop** (<https://desktop.github.com>), then **File → Add local repository → `F:\intelLock` → Publish repository**, untick "Keep this code private".

If you see `remote origin already exists`: `git remote set-url origin https://github.com/YOUR-USERNAME/film-to-export.git`, then push again.

## 3. Deploy on Render (one Web Service)

### Option A: Blueprint (uses `render.yaml`, fewest clicks)
1. <https://dashboard.render.com> → sign up or log in with **GitHub**.
2. **New + → Blueprint** → connect your GitHub → pick `film-to-export` → **Apply**.
3. Render asks for every variable marked `sync: false` (section 4). Paste the values and click **Apply**/**Create**.

### Option B: by hand
1. **New + → Web Service** → **Build and deploy from a Git repository** → pick `film-to-export`.
2. Fill in:

| Field | Value |
|-------|-------|
| Name | `film-to-export` |
| Region | **Singapore** (your Neon DB is in `ap-southeast-1`; pick the region nearest your database) |
| Branch | `main` |
| Runtime | **Node** |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Instance type | **Free** (fine for the demo) |
| Health Check Path (Advanced) | `/api/health` |

3. **Environment** → add the variables from section 4 → **Create Web Service**.

**Node version:** the repo has `.node-version` = `24`, and the Blueprint also sets `NODE_VERSION=24`. Doing it by hand, add `NODE_VERSION` = `24` too.

**Why `--include=dev`:** the build needs Vite and TypeScript, which are dev dependencies.

**What happens on start:** `npm start` runs `node dist/server/index.js`. A log line `.env not found. Continuing without it.` is normal on Render: the variables come from the dashboard. It listens on Render's `PORT`, connects to Postgres, and **applies database migrations automatically**. The build takes about 2–4 minutes.

**Free instance note:** it sleeps after about 15 minutes idle. The first request after that takes **30–60 seconds** to wake. Open the site a minute before you demo.

## 4. Environment variables (Render dashboard → your service → Environment)

Copy the values from your local `server\.env` (or `.env`). **Never paste them into the repo, the docs, chat or screenshots.**

| Key | What it is | Required |
|-----|------------|----------|
| `DATABASE_URL` | Neon (or Supabase) Postgres connection string, `postgresql://…?sslmode=require` | **yes** |
| `GEMINI_API_KEY` | Google AI Studio API key (secret) | yes for live AI |
| `GEMINI_MODEL` | e.g. `gemini-2.5-flash` (or a newer one Google names, such as `gemini-3.8-flash`) | no |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.5-flash-lite` (used when the main model is busy or over quota; `none` to disable) | no |
| `PAYPAL_CLIENT_ID` | PayPal **Sandbox** app Client ID (public; the browser uses it) | yes for live checkout |
| `PAYPAL_CLIENT_SECRET` | PayPal **Sandbox** app Secret (server-only) | yes for live checkout |
| `PAYPAL_CREATE_INVOICE` | `false` (stretch feature) | no |
| `BUYER_LANGUAGE` | second listing language, `es` | no |
| `APP_PUBLIC_URL` | your Render URL, e.g. `https://film-to-export.onrender.com`. Pay links and QR codes use it. | recommended |
| `NODE_VERSION` | `24` | recommended |
| `DATABASE_SSL_VERIFY` | leave unset; `false` only for some Supabase poolers | no |

Not needed on Render: `PORT` (Render sets it) and `DATA_DIR` (defaults to `./data`).

**`APP_PUBLIC_URL` two-step:** after the first deploy, copy the URL at the top of the service page (`https://film-to-export-xxxx.onrender.com`), add it as `APP_PUBLIC_URL` (no trailing slash), then **Manual Deploy → Deploy latest commit**. Even without it, links use the address the page was opened from.

**Never use PayPal Live credentials.** This app only talks to `api-m.sandbox.paypal.com`.

## 5. After deploy: smoke test (5 minutes)

1. Open `https://YOUR-SERVICE.onrender.com/api/health`. It should show `{"ok":true}`.
2. Open the site. The banner should read **AI · Gemini live** and **Payments · PayPal Sandbox**. If it says SIMULATION, a key is missing; check section 4.
3. **Broker desk:** drop `demo-media/Brass_lampt and scarf.mp4` from your PC → **Run the broker**. Steps should stream; the tariff steps show **LIVE · USITC**.
4. Open a piece → **Review & confirm** → **Get PayPal link**.
5. **On your phone:** scan the QR code. The pay page should open with *piece + est. US import duty = total*.
6. Pay with the **US** Sandbox personal account (John Doe) → **Complete Purchase** → you land on **Payment verified** with the DDP invoice → **Download PDF**.
7. **Orders** page: the order shows **Paid · verified** with invoice `CI-2026-…`.

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| **Build fails: `vite: not found` / `tsc: not found`** | The Build Command must be `npm ci --include=dev && npm run build`. |
| **Build fails: `npm ci` lockfile error** | On your PC: `npm.cmd install`, commit `package-lock.json`, push. |
| **Build fails: unsupported Node** | Set `NODE_VERSION` = `24` and redeploy. |
| **Deploy fails: "DATABASE_URL is not set"** | Add `DATABASE_URL` in Environment, then redeploy. |
| **Neon timeouts / "Could not connect to Postgres"** | Neon's free tier sleeps; the app retries 4 times. Check the connection string has `?sslmode=require`, and the Neon project isn't paused or deleted. Redeploy. |
| **Gemini "quota" or "high demand"** | The step says it's switching to the fallback model. If both fail: wait (free daily limits reset), enable billing on the Google Cloud project, or use **Replay last run** (labelled REPLAY). |
| **PayPal popup doesn't open** | Allow pop-ups for the site (address-bar icon), or use a normal (not private) window. |
| **PayPal: "Things don't appear to be working"** | You're logged in as an **India** Sandbox buyer; India-to-India payments are blocked. Log out in the popup and use the **US** personal Sandbox account. |
| **"Payment pending"** | The IN business account must accept USD: log in at <https://www.sandbox.paypal.com> as the business account and accept the payment, then **Check with PayPal** on the Orders page. |
| **Photos disappear after a while** | Render's free disk is temporary. Uploaded photos reset on redeploy or restart; listings, orders and invoices (in Postgres) stay. For a permanent setup, add a Render Disk mounted at `/opt/render/project/src/data`. |
| **First load is very slow** | Free instance waking up (30–60 s). Open the site a minute before demoing. |

## 7. Copy-paste prompt (if you get stuck)

Paste this into Claude Code (or another assistant) opened in `F:\intelLock`:

```
I'm deploying the Film-to-Export app in this folder (F:\intelLock) on Windows. It's ONE Node app:
Express serves the API and the built React frontend. Please help me deploy it, step by step, and
don't print or commit any secrets.

Facts:
- Scripts (package.json): build = "vite build && tsc -p tsconfig.server.json",
  start = "node --env-file-if-exists=.env dist/server/index.js", test = "vitest run".
- Use npm.cmd in PowerShell (npm.ps1 is blocked by execution policy).
- Required env: DATABASE_URL (Neon Postgres, TLS). Optional: GEMINI_API_KEY, GEMINI_MODEL,
  GEMINI_FALLBACK_MODEL, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET (PayPal SANDBOX only),
  PAYPAL_CREATE_INVOICE, BUYER_LANGUAGE, APP_PUBLIC_URL. Local secrets are in server/.env (gitignored).
- Render: one Web Service, Build "npm ci --include=dev && npm run build", Start "npm start",
  Node 24, health check /api/health. A render.yaml Blueprint is in the repo.
- Follow docs/DEPLOY.md.

Where I'm stuck: <paste the exact error or the step number here>
```

---

**Honesty reminders for the submission:** payments are PayPal **Sandbox**, duty numbers are **estimates, not customs advice**, and the demo clips are **AI-generated sample footage**.
