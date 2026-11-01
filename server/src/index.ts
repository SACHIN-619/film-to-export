import express from "express";
import path from "node:path";
import fs from "node:fs";
import { loadConfig } from "./config.js";
import { connectDb, MissingDatabaseUrlError, type Db } from "./db.js";
import { createApp } from "./app.js";
import { GeminiVisionModel } from "./ai/visionModel.js";
import { PayPalSandboxProvider } from "./payments/paypalSandbox.js";
import { SimulatedPaymentProvider } from "./payments/simulated.js";
import type { PaymentProvider } from "./payments/provider.js";

const config = loadConfig();

let db: Db;
try {
  db = await connectDb(config.databaseUrl, { verifyCert: config.dbVerifyCert });
} catch (err) {
  if (err instanceof MissingDatabaseUrlError) {
    console.error(`\n  ${err.message.split("\n").join("\n  ")}\n`);
  } else {
    // Never print the URL itself: it contains the database password.
    const e = err as Error & { code?: string; errors?: Error[] };
    const detail = [e.message, e.code, ...(e.errors ?? []).map((x) => x.message)].filter(Boolean).join(" | ") || String(err);
    console.error(`\n  Could not connect to Postgres: ${detail}`);
    console.error("  Check DATABASE_URL in .env (see docs/COMMON_STEPS.md → Getting your keys).\n");
  }
  process.exit(1);
}

const payments: PaymentProvider = config.paypal
  ? new PayPalSandboxProvider(config.paypal.clientId, config.paypal.clientSecret, { createInvoice: config.paypal.createInvoice })
  : new SimulatedPaymentProvider();
const vision = config.gemini
  ? new GeminiVisionModel(config.gemini.apiKey, config.gemini.model, fetch, { fallbackModel: config.gemini.fallbackModel })
  : null;

const app = createApp({ db, config, payments, vision });
const isProd = process.env.NODE_ENV === "production" || import.meta.url.includes("/dist/");

if (isProd) {
  const clientDir = path.resolve("dist/client");
  app.use(express.static(clientDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ configFile: path.resolve("vite.config.ts"), server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

const dbHost = new URL(config.databaseUrl!).hostname;
app.listen(config.port, () => {
  console.log("");
  console.log(`  Film-to-Export  at  http://localhost:${config.port}`);
  console.log(`  AI:        ${config.aiMode === "live" ? `LIVE (${config.gemini!.model})` : "SIMULATION (no GEMINI_API_KEY): fixture items only"}`);
  console.log(`  Payments:  ${payments.mode === "sandbox" ? "PayPal SANDBOX (api-m.sandbox.paypal.com)" : "SIMULATION (no PayPal keys): SIM- order ids"}`);
  console.log(`  Database:  Postgres at ${dbHost}`);
  const envFound = fs.existsSync(path.resolve(".env")) || fs.existsSync(path.resolve("server/.env"));
  // On a host like Render the variables come from the dashboard, so a missing .env is normal there.
  console.log(`  Uploads:   ${config.dataDir}${envFound || isProd ? "" : "   (no .env found; copy .env.example)"}`);
  console.log("");
});
