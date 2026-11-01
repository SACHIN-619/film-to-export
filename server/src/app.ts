import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { ZodError } from "zod";
import { LANGUAGE_NAMES, type AppConfig } from "./config.js";
import type { Db } from "./db.js";
import { ConfirmItemSchema, CreateOrderSchema, SellerSchema } from "./domain/schemas.js";
import { AiOutputError, draftListings } from "./ai/draftListings.js";
import { extractFrames, ffmpegAvailable } from "./ai/frames.js";
import { FIXTURE_ALT_LANG, FIXTURE_DRAFT, FIXTURE_IMAGES } from "./ai/fixtures.js";
import { AiProviderError, type VisionModel } from "./ai/visionModel.js";
import type { PaymentProvider } from "./payments/provider.js";
import { HttpError } from "./services/errors.js";
import {
  addFrames,
  createBatch,
  deleteItem,
  failBatch,
  getBatch,
  getShopItem,
  insertDraftItems,
  latestBatchId,
  listShop,
  publishBatch,
  publishItem,
  updateItem,
} from "./services/listings.js";
import QRCode from "qrcode";
import { OrderService } from "./services/orders.js";
import { getInvoice, renderInvoicePdf } from "./services/invoices.js";
import { prepareBatch, replayRun, runBroker, type BrokerEvent } from "./broker/agent.js";
import { LiveTariffLookup, type TariffLookup } from "./broker/tariff.js";

export interface AppDeps {
  db: Db;
  config: AppConfig;
  payments: PaymentProvider;
  vision: VisionModel | null;
  /** Official tariff lookup; defaults to the live USITC API (tests pass an offline one). */
  tariff?: TariffLookup;
  log?: (msg: string) => void;
}

const AUDIO_MIME = /^audio\/(webm|ogg|mpeg|mp3|mp4|m4a|x-m4a|aac|wav|x-wav|flac|aiff)/;

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTOS = 8;

export function createApp(deps: AppDeps) {
  const { db, config, payments, vision } = deps;
  const log = deps.log ?? ((m: string) => console.log(`[fte] ${m}`));
  const orders = new OrderService(db, payments, log);
  const uploadsDir = path.join(config.dataDir, "uploads");
  const incomingDir = path.join(config.dataDir, "incoming");
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(incomingDir, { recursive: true });

  const upload = multer({
    dest: incomingDir,
    limits: { files: MAX_PHOTOS, fileSize: 150 * 1024 * 1024 },
    fileFilter: (_req, file, cb) =>
      cb(null, IMAGE_MIME.has(file.mimetype) || file.mimetype.startsWith("video/") || AUDIO_MIME.test(file.mimetype)),
  });
  const tariff = deps.tariff ?? new LiveTariffLookup();

  const app = express();
  app.disable("x-powered-by");
  // Behind Render/other proxies: honour X-Forwarded-Proto so pay links are https://.
  app.set("trust proxy", true);
  app.use(express.json({ limit: "200kb" }));
  app.use("/media", express.static(uploadsDir, { fallthrough: false, maxAge: "1h" }));
  app.use("/fixtures", express.static(path.resolve("server/fixtures"), { fallthrough: false }));

  const api = express.Router();

  // Health check for hosting platforms (Render): the process is up and Postgres answers.
  api.get("/health", async (_req, res) => {
    try {
      await db.get("SELECT 1 AS ok");
      res.json({ ok: true });
    } catch (err) {
      res.status(503).json({ ok: false, error: (err as Error).message });
    }
  });

  api.get("/config", async (_req, res) => {
    res.json({
      aiMode: config.aiMode,
      aiModel: config.gemini?.model ?? null,
      paymentsMode: payments.mode,
      paypalClientId: payments.mode === "sandbox" ? config.paypal?.clientId : null,
      paypalInvoicing: !!config.paypal?.createInvoice,
      ffmpeg: await ffmpegAvailable(),
      buyerLanguage: config.buyerLanguage,
      buyerLanguageName: LANGUAGE_NAMES[config.buyerLanguage] ?? config.buyerLanguage,
    });
  });

  // ── Seller profile ──────────────────────────────────────────────
  const SELLER_COLS = "SELECT name, business_name, address, city, country, email, iec FROM seller WHERE id = 1";
  api.get("/seller", async (_req, res) => {
    res.json(await db.get(SELLER_COLS));
  });
  api.put("/seller", async (req, res) => {
    const s = SellerSchema.parse(req.body);
    await db.run("UPDATE seller SET name = $1, business_name = $2, address = $3, city = $4, email = $5, iec = $6 WHERE id = 1", [
      s.name,
      s.business_name,
      s.address,
      s.city,
      s.email,
      s.iec,
    ]);
    res.json(await db.get(SELLER_COLS));
  });

  // ── Batches (upload → AI draft) ─────────────────────────────────
  api.post("/batches", upload.array("media", MAX_PHOTOS), async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const cleanup = () => files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
    if (!vision || config.aiMode !== "live") {
      cleanup();
      throw new HttpError(409, "AI is in SIMULATION mode (no GEMINI_API_KEY). Load the labelled fixture batch instead.");
    }
    const videos = files.filter((f) => f.mimetype.startsWith("video/"));
    const photos = files.filter((f) => IMAGE_MIME.has(f.mimetype));
    if (files.length === 0) throw new HttpError(400, "Upload one video or 1–8 photos (JPEG, PNG or WebP).");
    if (videos.length > 1 || (videos.length && photos.length)) {
      cleanup();
      throw new HttpError(400, "Upload either one video or photos, not both.");
    }
    if (videos.length && !(await ffmpegAvailable())) {
      cleanup();
      throw new HttpError(422, "ffmpeg is not installed on this machine, so videos can't be read. Upload photos instead.");
    }
    if (photos.some((p) => p.size > 8 * 1024 * 1024)) {
      cleanup();
      throw new HttpError(413, "Each photo must be under 8 MB.");
    }

    const batchId = await createBatch(db, { source: videos.length ? "video" : "photos", aiMode: "live", model: vision.name });
    const batchDir = path.join(uploadsDir, batchId);
    fs.mkdirSync(batchDir, { recursive: true });
    try {
      let framePaths: string[];
      if (videos.length) {
        const src = path.join(batchDir, "source" + (path.extname(videos[0].originalname) || ".mp4"));
        fs.renameSync(videos[0].path, src);
        framePaths = await extractFrames(src, batchDir);
        if (framePaths.length === 0) throw new HttpError(422, "No frames could be read from that video.");
      } else {
        framePaths = photos.map((p, i) => {
          const ext = p.mimetype === "image/png" ? ".png" : p.mimetype === "image/webp" ? ".webp" : ".jpg";
          const dest = path.join(batchDir, `photo_${String(i).padStart(2, "0")}${ext}`);
          fs.renameSync(p.path, dest);
          return dest;
        });
      }
      const mimeOf = (f: string) => (f.endsWith(".png") ? "image/png" : f.endsWith(".webp") ? "image/webp" : "image/jpeg");
      const publicPaths = framePaths.map((f) => `/media/${batchId}/${path.basename(f)}`);
      await addFrames(db, batchId, publicPaths.map((p, i) => ({ path: p, mime: mimeOf(framePaths[i]) })));

      const images = framePaths.map((f) => ({ mime: mimeOf(f), data: fs.readFileSync(f) }));
      const altName = LANGUAGE_NAMES[config.buyerLanguage] ?? config.buyerLanguage;
      const { draft, repaired } = await draftListings(vision, images, altName);
      await insertDraftItems(db, batchId, draft, { origin: "ai", altLang: config.buyerLanguage, framePaths: publicPaths, repaired });
      log(`batch ${batchId}: ${draft.items.length} items drafted from ${images.length} frames${repaired ? " (after repair)" : ""}`);
      res.status(201).json(await getBatch(db, batchId));
    } catch (err) {
      cleanup();
      const msg =
        err instanceof AiOutputError
          ? `${err.message}: ${err.issues.slice(0, 5).join("; ")}`
          : err instanceof AiProviderError || err instanceof HttpError
            ? err.message
            : `Drafting failed: ${(err as Error).message}`;
      await failBatch(db, batchId, msg);
      log(`batch ${batchId} failed: ${msg}`);
      throw err instanceof HttpError ? err : new HttpError(502, msg, { batchId });
    }
  });

  api.post("/batches/fixture", async (_req, res) => {
    const batchId = await createBatch(db, { source: "fixture", aiMode: "simulation", model: null });
    const paths = FIXTURE_IMAGES.map((f) => `/fixtures/${f}`);
    await addFrames(db, batchId, paths.map((p) => ({ path: p, mime: "image/svg+xml" })));
    await insertDraftItems(db, batchId, structuredClone(FIXTURE_DRAFT), { origin: "fixture", altLang: FIXTURE_ALT_LANG, framePaths: paths, repaired: false });
    res.status(201).json(await getBatch(db, batchId));
  });

  api.get("/batches/latest", async (_req, res) => {
    const id = await latestBatchId(db);
    res.json(id ? await getBatch(db, id) : null);
  });
  api.get("/batches/:id", async (req, res) => res.json(await getBatch(db, req.params.id)));
  api.post("/batches/:id/publish", async (req, res) => res.json(await publishBatch(db, req.params.id)));

  api.put("/items/:id", async (req, res) =>
    res.json(await updateItem(db, req.params.id, ConfirmItemSchema.parse(req.body), (hs) => tariff.lookup(hs))),
  );

  // ── Pay links ───────────────────────────────────────────────────
  api.post("/items/:id/publish", async (req, res) => res.json(await publishItem(db, req.params.id)));

  /** Shareable pay link: absolute URL, ready-to-paste chat message, and a QR code (SVG). */
  api.get("/items/:id/share", async (req, res) => {
    const item = await getShopItem(db, req.params.id);
    const base = config.publicUrl ?? `${req.protocol}://${req.get("host")}`;
    const url = `${base}/pay/${item.id}`;
    const total = item.priceCents + item.duty.unitDutyCents;
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    const text =
      item.duty.status === "estimated"
        ? `Hi! Here's your secure PayPal checkout for "${item.titleEn}", handmade in India: ${money(total)} total, including ${money(item.duty.unitDutyCents)} estimated US import duty. It ships Delivered Duty Paid, so no customs bill at your door. ${url}`
        : `Hi! Here's your secure PayPal checkout for "${item.titleEn}", handmade in India: ${money(total)}. Import duty, if any, is payable on delivery. ${url}`;
    const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#1b1a17", light: "#fffdf8" } });
    res.json({ url, text, qrSvg, totalCents: total, localhost: /localhost|127\.0\.0\.1/.test(base) });
  });

  // ── Broker desk (agent, streamed as SSE over a POST) ────────────
  const sse = (res: Response) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    return (e: BrokerEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  api.post(
    "/broker/run",
    upload.fields([
      { name: "media", maxCount: MAX_PHOTOS },
      { name: "voice", maxCount: 1 },
    ]),
    async (req, res) => {
      const files = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
      const photos = (files.media ?? []).filter((f) => IMAGE_MIME.has(f.mimetype));
      const voice = (files.voice ?? []).find((f) => AUDIO_MIME.test(f.mimetype)) ?? null;
      const all = [...(files.media ?? []), ...(files.voice ?? [])];
      const cleanup = () => all.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
      if (photos.length === 0) {
        cleanup();
        throw new HttpError(400, "Add 1–8 photos (or a video: the browser turns it into photos).");
      }
      if (photos.some((p) => p.size > 8 * 1024 * 1024) || (voice && voice.size > 12 * 1024 * 1024)) {
        cleanup();
        throw new HttpError(413, "Photos must be under 8 MB each and the voice note under 12 MB.");
      }

      const batchId = await prepareBatch(db, vision?.name ?? null, !!vision);
      const batchDir = path.join(uploadsDir, batchId);
      fs.mkdirSync(batchDir, { recursive: true });
      const images = photos.map((p, i) => {
        const ext = p.mimetype === "image/png" ? ".png" : p.mimetype === "image/webp" ? ".webp" : ".jpg";
        const name = `photo_${String(i).padStart(2, "0")}${ext}`;
        fs.renameSync(p.path, path.join(batchDir, name));
        return { mime: p.mimetype, data: fs.readFileSync(path.join(batchDir, name)), publicPath: `/media/${batchId}/${name}` };
      });
      await addFrames(db, batchId, images.map((i) => ({ path: i.publicPath, mime: i.mime })));
      let audio: { mime: string; data: Buffer } | null = null;
      if (voice) {
        const dest = path.join(batchDir, `voice${path.extname(voice.originalname) || ".webm"}`);
        fs.renameSync(voice.path, dest);
        // Gemini wants a bare MIME type ("audio/webm", not "audio/webm;codecs=opus").
        audio = { mime: voice.mimetype.split(";")[0], data: fs.readFileSync(dest) };
      }

      const emit = sse(res);
      await runBroker(
        {
          db,
          vision,
          tariff,
          altLanguage: { code: config.buyerLanguage, name: LANGUAGE_NAMES[config.buyerLanguage] ?? config.buyerLanguage },
          log,
        },
        { images, audio, batchId },
        emit,
      );
      res.end();
    },
  );

  api.post("/broker/replay", async (req, res) => {
    const runId = typeof req.body?.runId === "string" ? req.body.runId : null;
    const exists = runId
      ? await db.get("SELECT id FROM broker_runs WHERE id = $1", [runId])
      : await db.get("SELECT id FROM broker_runs WHERE events LIKE '%\"kind\":\"done\"%' LIMIT 1");
    if (!exists) throw new HttpError(404, "No recorded broker run to replay yet. Do one live run first.");
    const emit = sse(res);
    await replayRun(db, runId, emit);
    res.end();
  });

  api.get("/broker/runs", async (_req, res) => {
    res.json(
      await db.all(
        `SELECT id, batch_id AS "batchId", mode, created_at AS "createdAt" FROM broker_runs ORDER BY created_at DESC LIMIT 20`,
      ),
    );
  });
  api.delete("/items/:id", async (req, res) => {
    await deleteItem(db, req.params.id);
    res.status(204).end();
  });

  // ── Storefront ──────────────────────────────────────────────────
  api.get("/shop", async (_req, res) => {
    const seller = await db.get("SELECT name, business_name, city, country FROM seller WHERE id = 1");
    res.json({ seller, items: await listShop(db) });
  });
  api.get("/shop/:id", async (req, res) => res.json(await getShopItem(db, req.params.id)));

  // ── Orders ──────────────────────────────────────────────────────
  api.post("/orders", async (req, res) => {
    // Only itemId + quantity survive parsing. Price comes from the DB.
    const input = CreateOrderSchema.parse(req.body);
    res.status(201).json(await orders.create(input));
  });
  api.post("/orders/:id/capture", async (req, res) => res.json(await orders.capture(req.params.id)));
  // onApprove uses PayPal's own order id, so a re-rendered button or a second click can't lose track of the order.
  api.post("/orders/by-paypal/:paypalOrderId/capture", async (req, res) =>
    res.json(await orders.captureByPayPalId(req.params.paypalOrderId)),
  );
  api.get("/orders", async (_req, res) => res.json(await orders.list()));
  api.get("/orders/:id", async (req, res) => res.json(await orders.get(req.params.id)));

  // ── Invoices ────────────────────────────────────────────────────
  api.get("/invoices/:id", async (req, res) => res.json(await getInvoice(db, req.params.id)));
  api.get("/invoices/:id/pdf", async (req, res) => {
    const inv = await getInvoice(db, req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${inv.number}.pdf"`);
    renderInvoicePdf(inv.snapshot).pipe(res);
  });

  app.use("/api", api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Invalid input", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: `Upload error: ${err.message}` });
      return;
    }
    const status = (err as { status?: unknown })?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ error: status === 404 ? "Not found" : "Bad request" });
      return;
    }
    log(`unhandled: ${(err as Error)?.stack ?? String(err)}`);
    res.status(500).json({ error: "Something went wrong on the server" });
  });

  return app;
}
