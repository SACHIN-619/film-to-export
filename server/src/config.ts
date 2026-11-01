import dotenv from "dotenv";
import path from "node:path";

// Load ./.env, then ./server/.env as a fallback (both gitignored). Real env vars win; values are never logged.
dotenv.config({ path: [path.resolve(".env"), path.resolve("server/.env")], quiet: true });

/** The only PayPal API base this app will ever talk to. */
export const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";

export type AiMode = "live" | "simulation";
export type PaymentsMode = "sandbox" | "simulation";

export interface AppConfig {
  port: number;
  /** Uploaded photos/frames live here on disk; all records live in Postgres. */
  dataDir: string;
  databaseUrl: string | null;
  /** Verify the Postgres server certificate (default true). */
  dbVerifyCert: boolean;
  buyerLanguage: string;
  /** Public base URL for pay links/QR codes (e.g. a deployed URL). Defaults to the request's own host. */
  publicUrl: string | null;
  gemini: { apiKey: string; model: string; fallbackModel: string | null } | null;
  paypal: { clientId: string; clientSecret: string; createInvoice: boolean } | null;
  aiMode: AiMode;
  paymentsMode: PaymentsMode;
}

const clean = (v: string | undefined) => (v ?? "").trim();

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const geminiKey = clean(env.GEMINI_API_KEY);
  const ppId = clean(env.PAYPAL_CLIENT_ID);
  const ppSecret = clean(env.PAYPAL_CLIENT_SECRET);
  const gemini = geminiKey
    ? {
        apiKey: geminiKey,
        model: clean(env.GEMINI_MODEL) || "gemini-2.5-flash",
        // A lighter model with its own free-tier quota; "none" disables the fallback.
        fallbackModel:
          clean(env.GEMINI_FALLBACK_MODEL).toLowerCase() === "none" ? null : clean(env.GEMINI_FALLBACK_MODEL) || "gemini-3.5-flash-lite",
      }
    : null;
  const paypal =
    ppId && ppSecret
      ? { clientId: ppId, clientSecret: ppSecret, createInvoice: clean(env.PAYPAL_CREATE_INVOICE) === "true" }
      : null;
  return {
    port: Number(clean(env.PORT) || 8787),
    dataDir: path.resolve(clean(env.DATA_DIR) || "./data"),
    databaseUrl: clean(env.DATABASE_URL) || null,
    dbVerifyCert: clean(env.DATABASE_SSL_VERIFY) !== "false",
    buyerLanguage: (clean(env.BUYER_LANGUAGE) || "es").toLowerCase(),
    publicUrl: clean(env.APP_PUBLIC_URL).replace(/\/+$/, "") || null,
    gemini,
    paypal,
    aiMode: gemini ? "live" : "simulation",
    paymentsMode: paypal ? "sandbox" : "simulation",
  };
}

export const LANGUAGE_NAMES: Record<string, string> = {
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  nl: "Dutch",
  ar: "Arabic",
  zh: "Chinese",
};
