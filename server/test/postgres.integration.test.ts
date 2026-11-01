/**
 * Opt-in: runs only when DATABASE_URL is set (e.g. in .env). Everything happens in a
 * throwaway schema that is dropped afterwards, so your app tables are not touched.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createPool, Db, migrate, type PoolLike } from "../src/db.js";
import { createApp } from "../src/app.js";
import { SimulatedPaymentProvider } from "../src/payments/simulated.js";
import { tempConfig } from "./helpers.js";
import { TableTariffLookup } from "../src/broker/tariff.js";

const config = loadConfig();
const schema = `fte_it_${randomBytes(4).toString("hex")}`;

/**
 * A transaction-mode pooler (Neon "-pooler" hosts, Supabase port 6543) shares server
 * connections between clients, so a session-level SET search_path would leak to the app.
 * Use Neon's direct endpoint for this test and always reset search_path before closing.
 */
function directUrl(url: string): string {
  const u = new URL(url);
  u.hostname = u.hostname.replace(/-pooler(?=\.)/, "");
  return u.toString();
}

describe.skipIf(!config.databaseUrl)("Postgres integration (DATABASE_URL)", () => {
  // search_path is a connection startup option, so every connection the pool opens
  // (including replacements after an error) lands in the throwaway schema.
  const url = config.databaseUrl ? directUrl(config.databaseUrl) : null;
  const pool = url ? createPool(url, { verifyCert: config.dbVerifyCert, searchPath: schema }) : null;
  const db = pool ? Db.fromPool(pool as unknown as PoolLike) : null;

  afterAll(async () => {
    if (!db) return;
    try {
      await db.run(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await db.close();
    }
  });

  it("migrates, then runs fixture → confirm → publish → simulated pay → invoice against real Postgres", async () => {
    await db!.run(`CREATE SCHEMA ${schema}`);
    expect(await db!.get<{ s: string }>("SELECT current_schema() AS s")).toEqual({ s: schema });
    expect(await migrate(db!)).toEqual(["001_init.sql", "002_duty.sql", "003_broker.sql"]);

    const app = createApp({ db: db!, config: tempConfig(), payments: new SimulatedPaymentProvider(), vision: null, tariff: new TableTariffLookup(), log: () => {} });
    const batch = (await request(app).post("/api/batches/fixture").expect(201)).body;
    for (const it of batch.items) {
      await request(app)
        .put(`/api/items/${it.id}`)
        .send({
          title_en: it.titleEn,
          description_en: it.descriptionEn,
          title_alt: it.titleAlt,
          description_alt: it.descriptionAlt,
          materials: it.materials,
          dimensions: it.dimensions,
          condition_grade: it.conditionGrade,
          condition_notes: it.conditionNotes,
          price_usd: it.priceUsd,
          quantity: 1,
          hs_code: it.hsCode,
          confirm: true,
        })
        .expect(200);
    }
    await request(app).post(`/api/batches/${batch.id}/publish`).expect(200);
    const created = (await request(app).post("/api/orders").send({ itemId: batch.items[0].id, quantity: 1, amount: "0.01" }).expect(201)).body;
    expect(created.amountCents).toBe(3800 + 809); // goods + 21.3% est. duty (6214.90 11.3% + IN 10%)
    const paid = (await request(app).post(`/api/orders/${created.orderId}/capture`).expect(200)).body;
    expect(paid.status).toBe("paid");
    expect(paid.invoice.number).toMatch(/^CI-\d{4}-0001$/);
    const item = (await request(app).get(`/api/shop/${batch.items[0].id}`).expect(200)).body;
    expect(item.status).toBe("sold_out");
  }, 60_000);

  it("rolls back a failed transaction (real Postgres semantics)", async () => {
    await expect(
      db!.tx(async (t) => {
        await t.run("UPDATE seller SET name = 'ROLLED BACK' WHERE id = 1");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const s = await db!.get<{ name: string }>("SELECT name FROM seller WHERE id = 1");
    expect(s?.name).not.toBe("ROLLED BACK");
  });
});
