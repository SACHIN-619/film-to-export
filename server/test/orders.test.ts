import { describe, expect, it } from "vitest";
import request from "supertest";
import { testApp } from "./helpers.js";
import { PaymentProviderError, type CreateOrderInput, type PaymentProvider, type PayPalOrder } from "../src/payments/provider.js";
import { SimulatedPaymentProvider } from "../src/payments/simulated.js";
import { centsToValue } from "../src/domain/money.js";

/** Scriptable PayPal stand-in that records what the server sent it. */
class FakePayPal implements PaymentProvider {
  readonly mode = "sandbox" as const;
  created: CreateOrderInput[] = [];
  captureCalls = 0;
  getCalls = 0;
  captureImpl: (input: CreateOrderInput) => PayPalOrder = (i) => completed(i);
  getImpl: (input: CreateOrderInput) => PayPalOrder = (i) => completed(i);

  async createOrder(input: CreateOrderInput) {
    this.created.push(input);
    return { id: `PP-${this.created.length}` };
  }
  async captureOrder() {
    this.captureCalls++;
    return this.captureImpl(this.created.at(-1)!);
  }
  async getOrder() {
    this.getCalls++;
    return this.getImpl(this.created.at(-1)!);
  }
}

function completed(i: CreateOrderInput, over: { status?: string; value?: string } = {}): PayPalOrder {
  return {
    id: "PP-1",
    status: "COMPLETED",
    payer: { email_address: "us-buyer@example.com", name: { given_name: "Jo", surname: "Doe" } },
    purchase_units: [
      {
        reference_id: i.orderId,
        shipping: { name: { full_name: "Jo Doe" }, address: { address_line_1: "1 A St", admin_area_2: "Boston", country_code: "US" } },
        payments: {
          captures: [{ id: "CAP-1", status: over.status ?? "COMPLETED", amount: { currency_code: "USD", value: over.value ?? centsToValue(i.amountCents) } }],
        },
      },
    ],
  };
}

describe("POST /api/orders never trusts a client-sent amount", () => {
  it("prices the order (goods + duty) from the database and ignores amount/duty fields in the body", async () => {
    const pp = new FakePayPal();
    const { app, items } = await testApp(pp);
    const res = await request(app)
      .post("/api/orders")
      .send({
        itemId: items[0].id,
        quantity: 2,
        amount: "0.01",
        amountCents: 1,
        price_usd: 0.01,
        currency: "INR",
        duty: 0,
        dutyCents: 0,
        unitDutyCents: 0,
        tax_total: { value: "0.00" },
        purchase_units: [{ amount: { value: "0.01" } }],
      })
      .expect(201);

    // Fixture item 0: $38.00 scarf, HS 6214.90 → 11.3% MFN + 10% India surcharge = 21.3% → $8.09/unit.
    const unitDuty = Math.round((items[0].price_cents * 21.3) / 100);
    expect(unitDuty).toBe(809);
    expect(res.body.goodsCents).toBe(items[0].price_cents * 2);
    expect(res.body.dutyCents).toBe(unitDuty * 2);
    expect(res.body.amountCents).toBe(items[0].price_cents * 2 + unitDuty * 2);
    expect(res.body.currency).toBe("USD");
    expect(pp.created).toHaveLength(1);
    expect(pp.created[0].amountCents).toBe(items[0].price_cents * 2 + unitDuty * 2);
    expect(pp.created[0].unitCents).toBe(items[0].price_cents);
    expect(pp.created[0].unitDutyCents).toBe(unitDuty);
    expect(pp.created[0].currency).toBe("USD");
  });

  it("an HS code with no rate on file means no duty line (goods-only, DAP)", async () => {
    const pp = new FakePayPal();
    const { app, db, items } = await testApp(pp);
    await db.run("UPDATE items SET hs_code = '4602.19' WHERE id = $1", [items[1].id]); // basketwork: not in our table
    const res = await request(app).post("/api/orders").send({ itemId: items[1].id, quantity: 1 }).expect(201);
    expect(res.body.dutyCents).toBe(0);
    expect(res.body.amountCents).toBe(items[1].price_cents);
  });

  it("verifies the capture against goods + duty: PayPal capturing only the goods amount fails the order", async () => {
    const pp = new FakePayPal();
    pp.captureImpl = (i) => completed(i, { value: centsToValue(i.unitCents * i.quantity) }); // duty missing
    const { app, items } = await testApp(pp);
    const created = (await request(app).post("/api/orders").send({ itemId: items[0].id, quantity: 1 }).expect(201)).body;
    const res = await request(app).post(`/api/orders/${created.orderId}/capture`).expect(200);
    expect(res.body.status).toBe("failed");
    expect(res.body.invoice).toBeNull();
  });

  it("rejects bad quantities and unknown items", async () => {
    const { app, items } = await testApp(new FakePayPal());
    await request(app).post("/api/orders").send({ itemId: items[0].id, quantity: 0 }).expect(400);
    await request(app).post("/api/orders").send({ itemId: items[0].id, quantity: 1.5 }).expect(400);
    await request(app).post("/api/orders").send({ itemId: "it_nope", quantity: 1 }).expect(404);
    await request(app).post("/api/orders").send({ itemId: items[0].id, quantity: 3 }).expect(409); // stock is 2
  });

  it("cannot buy an unpublished draft", async () => {
    const { app, db, items } = await testApp(new FakePayPal());
    await db.run("UPDATE items SET status = 'draft' WHERE id = $1", [items[1].id]);
    await request(app).post("/api/orders").send({ itemId: items[1].id, quantity: 1 }).expect(404);
  });
});

describe("capture verification", () => {
  async function newOrder(pp: PaymentProvider) {
    const t = await testApp(pp);
    const res = await request(t.app).post("/api/orders").send({ itemId: t.items[0].id, quantity: 1 }).expect(201);
    return { ...t, orderId: res.body.orderId as string };
  }

  it("an order is NOT paid until the server captures, even if the browser 'returned' from PayPal", async () => {
    const pp = new FakePayPal();
    const { app, orderId } = await newOrder(pp);
    const res = await request(app).get(`/api/orders/${orderId}`).expect(200);
    expect(res.body.status).toBe("created");
    expect(res.body.invoice).toBeNull();
  });

  it("marks paid on a verified COMPLETED capture, decrements stock and issues an invoice", async () => {
    const pp = new FakePayPal();
    const { app, db, items, orderId } = await newOrder(pp);
    const res = await request(app).post(`/api/orders/${orderId}/capture`).expect(200);
    expect(res.body.status).toBe("paid");
    expect(res.body.captureId).toBe("CAP-1");
    expect(res.body.buyer.country).toBe("US");
    expect(res.body.invoice.number).toMatch(/^CI-\d{4}-0001$/);
    const stock = (await db.get<{ quantity: number }>("SELECT quantity FROM items WHERE id = $1", [items[0].id]))!;
    expect(stock.quantity).toBe(1);
  });

  it("fails the order (no invoice) when PayPal's captured amount differs from ours", async () => {
    const pp = new FakePayPal();
    pp.captureImpl = (i) => completed(i, { value: "0.01" });
    const { app, orderId } = await newOrder(pp);
    const res = await request(app).post(`/api/orders/${orderId}/capture`).expect(200);
    expect(res.body.status).toBe("failed");
    expect(res.body.invoice).toBeNull();
    expect(res.body.events.at(-1).note).toMatch(/Amount mismatch/);
  });

  it("reads the order back from PayPal when capture says ORDER_ALREADY_CAPTURED", async () => {
    const pp = new FakePayPal();
    pp.captureImpl = () => {
      throw new PaymentProviderError("already", 422, "ORDER_ALREADY_CAPTURED");
    };
    const { app, orderId } = await newOrder(pp);
    const res = await request(app).post(`/api/orders/${orderId}/capture`).expect(200);
    expect(pp.getCalls).toBe(1);
    expect(res.body.status).toBe("paid");
  });

  it("reads back after a 5xx/timeout and only marks paid if PayPal really completed", async () => {
    const pp = new FakePayPal();
    pp.captureImpl = () => {
      throw new PaymentProviderError("boom", 503);
    };
    pp.getImpl = (i) => ({ ...completed(i), status: "APPROVED", purchase_units: [{ reference_id: i.orderId }] });
    const { app, orderId } = await newOrder(pp);
    const res = await request(app).post(`/api/orders/${orderId}/capture`).expect(200);
    expect(pp.getCalls).toBe(1);
    expect(res.body.status).toBe("failed");
  });

  it("leaves the order open (422) when PayPal says the buyer hasn't approved / instrument declined", async () => {
    const pp = new FakePayPal();
    pp.captureImpl = () => {
      throw new PaymentProviderError("declined", 422, "INSTRUMENT_DECLINED");
    };
    const { app, orderId } = await newOrder(pp);
    const res = await request(app).post(`/api/orders/${orderId}/capture`).expect(422);
    expect(res.body.details.issue).toBe("INSTRUMENT_DECLINED");
    const after = await request(app).get(`/api/orders/${orderId}`);
    expect(after.body.status).toBe("created");
  });

  it("PENDING capture -> payment_pending without invoice; a later readback COMPLETED -> paid", async () => {
    const pp = new FakePayPal();
    pp.captureImpl = (i) => completed(i, { status: "PENDING" });
    const { app, orderId } = await newOrder(pp);
    const first = await request(app).post(`/api/orders/${orderId}/capture`).expect(200);
    expect(first.body.status).toBe("payment_pending");
    expect(first.body.invoice).toBeNull();

    const second = await request(app).post(`/api/orders/${orderId}/capture`).expect(200);
    expect(pp.captureCalls).toBe(1); // re-check uses GET, never a second capture
    expect(second.body.status).toBe("paid");
    expect(second.body.invoice).not.toBeNull();
  });

  it("is idempotent: capturing a paid order again does not call PayPal or issue a second invoice", async () => {
    const pp = new FakePayPal();
    const { app, db, orderId } = await newOrder(pp);
    await request(app).post(`/api/orders/${orderId}/capture`).expect(200);
    await request(app).post(`/api/orders/${orderId}/capture`).expect(200);
    expect(pp.captureCalls).toBe(1);
    expect((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM invoices"))!.n).toBe(1);
  });
});

describe("SIMULATION payments end to end", () => {
  it("uses SIM- ids, goes through the same verification, and yields a PDF invoice", async () => {
    const { app, items } = await testApp(new SimulatedPaymentProvider());
    const created = await request(app).post("/api/orders").send({ itemId: items[2].id, quantity: 1 }).expect(201);
    expect(created.body.paypalOrderId).toMatch(/^SIM-/);
    const paid = await request(app).post(`/api/orders/${created.body.orderId}/capture`).expect(200);
    expect(paid.body.status).toBe("paid");
    expect(paid.body.paymentsMode).toBe("simulation");
    expect(paid.body.captureId).toMatch(/^SIM-CAP-/);

    const inv = await request(app).get(`/api/invoices/${paid.body.invoice.id}`).expect(200);
    expect(inv.body.snapshot.simulation).toBe(true);
    expect(inv.body.snapshot.lines[0].hsCode).toBe("6912.00");
    expect(inv.body.snapshot.lines[0].origin).toBe("India");

    const pdf = await request(app)
      .get(`/api/invoices/${paid.body.invoice.id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("onApprove by PayPal order id", () => {
  it("captures the order PayPal approved, even if the browser opened checkout twice", async () => {
    const pp = new FakePayPal();
    const { app, items } = await testApp(pp);
    const first = (await request(app).post("/api/orders").send({ itemId: items[0].id, quantity: 1 }).expect(201)).body;
    await request(app).post("/api/orders").send({ itemId: items[0].id, quantity: 1 }).expect(201); // second click
    pp.captureImpl = () => completed(pp.created[0]); // PayPal approved the FIRST one
    const res = await request(app).post(`/api/orders/by-paypal/${first.paypalOrderId}/capture`).expect(200);
    expect(res.body.id).toBe(first.orderId);
    expect(res.body.status).toBe("paid");
  });

  it("404s for an unknown PayPal order id", async () => {
    const { app } = await testApp(new FakePayPal());
    await request(app).post("/api/orders/by-paypal/NOPE123/capture").expect(404);
  });
});
