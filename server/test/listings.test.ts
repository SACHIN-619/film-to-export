import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { memoryDb } from "./helpers.js";
import { SimulatedPaymentProvider } from "../src/payments/simulated.js";
import { tempConfig } from "./helpers.js";
import { TableTariffLookup } from "../src/broker/tariff.js";
import { PAYPAL_API_BASE, loadConfig } from "../src/config.js";

async function freshApp() {
  return createApp({ db: await memoryDb(), config: tempConfig(), payments: new SimulatedPaymentProvider(), vision: null, tariff: new TableTariffLookup(), log: () => {} });
}

describe("seller confirmation gate", () => {
  it("fixture batch is labelled, and cannot publish until every item is confirmed", async () => {
    const app = await freshApp();
    const batch = (await request(app).post("/api/batches/fixture").expect(201)).body;
    expect(batch.aiMode).toBe("simulation");
    expect(batch.items.every((i: { origin: string }) => i.origin === "fixture")).toBe(true);

    const blocked = await request(app).post(`/api/batches/${batch.id}/publish`).expect(409);
    expect(blocked.body.details.unconfirmed).toHaveLength(4);

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
          price_usd: it.priceUsd + 4,
          quantity: 1,
          hs_code: it.hsCode,
          confirm: true,
        })
        .expect(200);
    }
    const published = await request(app).post(`/api/batches/${batch.id}/publish`).expect(200);
    expect(published.body.items.every((i: { status: string }) => i.status === "published")).toBe(true);
    const shop = await request(app).get("/api/shop").expect(200);
    expect(shop.body.items).toHaveLength(4);
    expect(shop.body.items.find((i: { titleEn: string }) => i.titleEn.includes("scarf")).priceUsd).toBe(42);
  });

  it("rejects an invalid HS code on confirm", async () => {
    const app = await freshApp();
    const batch = (await request(app).post("/api/batches/fixture").expect(201)).body;
    const it0 = batch.items[0];
    const res = await request(app)
      .put(`/api/items/${it0.id}`)
      .send({ ...it0, title_en: it0.titleEn, description_en: it0.descriptionEn, title_alt: it0.titleAlt, description_alt: it0.descriptionAlt, condition_grade: "new", condition_notes: "ok ok", price_usd: 10, quantity: 1, hs_code: "abc", confirm: true })
      .expect(400);
    expect(res.body.issues[0].path).toBe("hs_code");
  });

  it("refuses live uploads in AI SIMULATION mode", async () => {
    const app = await freshApp();
    await request(app).post("/api/batches").attach("media", Buffer.from("x"), { filename: "a.jpg", contentType: "image/jpeg" }).expect(409);
  });
});

describe("config", () => {
  it("only knows the PayPal sandbox base URL", () => {
    expect(PAYPAL_API_BASE).toBe("https://api-m.sandbox.paypal.com");
  });
  it("falls back to SIMULATION without keys and does not expose secrets", async () => {
    const cfg = loadConfig({ PAYPAL_CLIENT_ID: "id-only" } as NodeJS.ProcessEnv);
    expect(cfg.paymentsMode).toBe("simulation");
    expect(cfg.aiMode).toBe("simulation");
    const res = await request(await freshApp()).get("/api/config").expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
    expect(res.body.paypalClientId).toBeNull();
  });
});

describe("health check", () => {
  it("GET /api/health reports ok when the database answers", async () => {
    const res = await request(await freshApp()).get("/api/health").expect(200);
    expect(res.body).toEqual({ ok: true });
  });
});
