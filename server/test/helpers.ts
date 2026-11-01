import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { newDb } from "pg-mem";
import { Db, migrate, type PoolLike } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { insertDraftItems, createBatch, addFrames, publishBatch } from "../src/services/listings.js";
import { FIXTURE_DRAFT } from "../src/ai/fixtures.js";
import type { PaymentProvider } from "../src/payments/provider.js";
import type { VisionModel } from "../src/ai/visionModel.js";
import { TableTariffLookup } from "../src/broker/tariff.js";

export function tempConfig() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fte-test-"));
  return loadConfig({ DATA_DIR: dataDir } as NodeJS.ProcessEnv);
}

/** In-memory Postgres (pg-mem) with the real migration applied. No network needed. */
export async function memoryDb(): Promise<Db> {
  const { Pool } = newDb().adapters.createPg();
  const db = Db.fromPool(new Pool() as unknown as PoolLike);
  await migrate(db);
  return db;
}

/** In-memory DB with the 4 fixture items confirmed (stock 2 each) and published. */
export async function seededDb() {
  const db = await memoryDb();
  const batchId = await createBatch(db, { source: "fixture", aiMode: "simulation", model: null });
  await addFrames(db, batchId, [{ path: "/fixtures/scarf.svg", mime: "image/svg+xml" }]);
  await insertDraftItems(db, batchId, structuredClone(FIXTURE_DRAFT), {
    origin: "fixture",
    altLang: "es",
    framePaths: ["/fixtures/scarf.svg"],
    repaired: false,
  });
  await db.run("UPDATE items SET status = 'confirmed', confirmed_at = 'x', quantity = 2");
  await publishBatch(db, batchId);
  const items = await db.all<{ id: string; price_cents: number }>("SELECT id, price_cents FROM items ORDER BY sort_order");
  return { db, batchId, items };
}

export async function testApp(payments: PaymentProvider, vision: VisionModel | null = null) {
  const { db, items } = await seededDb();
  const app = createApp({ db, config: tempConfig(), payments, vision, tariff: new TableTariffLookup(), log: () => {} });
  return { app, db, items };
}
