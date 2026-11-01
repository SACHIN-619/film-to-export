import { describe, expect, it } from "vitest";
import { dutyBasis, estimateDuty, findHeading, loadRateTable } from "../src/domain/duty.js";
import { buildOrderPayload } from "../src/payments/paypalSandbox.js";
import request from "supertest";
import { testApp } from "./helpers.js";
import { SimulatedPaymentProvider } from "../src/payments/simulated.js";

const table = loadRateTable();

describe("duty rate table", () => {
  it("is dated, carries a disclaimer, and cites a source for every line", () => {
    expect(table.checked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(table.disclaimer).toMatch(/not customs advice/i);
    for (const h of table.headings) {
      expect(h.sources.length, h.hs).toBeGreaterThan(0);
      expect(h.mfn_rate_pct, h.hs).toBeGreaterThanOrEqual(0);
    }
    expect(table.origin_surcharges.IN.sources.length).toBeGreaterThan(0);
  });
});

describe("estimateDuty", () => {
  it("matches by longest prefix (6214.90, 6214.90.00, 6214.90.00.10)", () => {
    for (const hs of ["6214.90", "6214.90.00", "6214.90.00.10", "621490"]) expect(findHeading(table, hs)?.hs).toBe("6214.90");
  });

  it("adds the India surcharge to the MFN rate and rounds to the cent", () => {
    const e = estimateDuty("6214.90", 3800, "IN", table);
    if (e.status !== "estimated") throw new Error("expected estimate");
    expect(e.mfnPct).toBe(11.3);
    expect(e.surchargePct).toBe(10);
    expect(e.totalPct).toBe(21.3);
    expect(e.unitDutyCents).toBe(809); // 3800 × 21.3% = 809.4
    expect(dutyBasis(e)).toMatch(/HS 6214\.90.*11\.3% MFN.*10%.*\(uncertain\).*= 21\.3%/);
  });

  it("applies no surcharge for an origin without one", () => {
    const e = estimateDuty("6214.90", 10000, "VN", table);
    expect(e.status === "estimated" && e.totalPct).toBe(11.3);
  });

  it("returns 'unknown' (zero duty, honest reason) for an HS code with no rate on file", () => {
    const e = estimateDuty("4602.19", 5000, "IN", table);
    expect(e.status).toBe("unknown");
    expect(e.unitDutyCents).toBe(0);
    expect(dutyBasis(e)).toMatch(/No rate on file/);
  });

  it("every MFN rate is verified against the official USITC HTS; the India surcharge stays flagged uncertain", () => {
    expect(table.headings.every((h) => h.verified)).toBe(true);
    const e = estimateDuty("6304.92", 2600, "IN", table);
    expect(e.status === "estimated" && e.mfnVerified).toBe(true);
    expect(dutyBasis(e)).not.toMatch(/unverified/);
    expect(dutyBasis(e)).toMatch(/\(uncertain\)/);
  });

  it("brass articles: 7419.80.06/.09 'Other' = 3% (7419.80.50 'Free' is chain, not general brass)", () => {
    const e = estimateDuty("7419.80", 3500, "IN", table);
    if (e.status !== "estimated") throw new Error("expected estimate");
    expect(e.mfnPct).toBe(3);
    expect(e.unitDutyCents).toBe(455); // 13% of $35
  });

  it("handles a duty-free (Free) line from a live lookup as surcharge only", () => {
    const e = estimateDuty("7419.20", 3500, "IN", table, { mfnPct: 0, htsLine: "7419.20.00", source: "live" });
    if (e.status !== "estimated") throw new Error("expected estimate");
    expect(e.mfnPct).toBe(0);
    expect(e.rateSource).toBe("live");
    expect(e.unitDutyCents).toBe(350);
  });
});

describe("PayPal order payload with duty", () => {
  const base = { orderId: "FTE-1", itemId: "it_1", itemName: "Scarf", quantity: 2, unitCents: 3800, currency: "USD" as const };

  it("puts duty in tax_total and items[].tax; amount = item_total + tax_total", () => {
    const p = buildOrderPayload({ ...base, unitDutyCents: 809, amountCents: 2 * 3800 + 2 * 809 });
    const pu = p.purchase_units[0];
    expect(pu.amount.value).toBe("92.18");
    expect(pu.amount.breakdown.item_total.value).toBe("76.00");
    expect(pu.amount.breakdown.tax_total?.value).toBe("16.18");
    expect(pu.items[0].tax?.value).toBe("8.09");
    expect(Number(pu.amount.breakdown.item_total.value) + Number(pu.amount.breakdown.tax_total!.value)).toBeCloseTo(Number(pu.amount.value), 10);
    expect(pu.description).toMatch(/DDP/);
  });

  it("omits tax entirely when there is no duty", () => {
    const p = buildOrderPayload({ ...base, unitDutyCents: 0, amountCents: 7600 });
    expect(p.purchase_units[0].amount.breakdown.tax_total).toBeUndefined();
    expect(p.purchase_units[0].items[0].tax).toBeUndefined();
  });

  it("refuses an amount that is not goods + duty", () => {
    expect(() => buildOrderPayload({ ...base, unitDutyCents: 809, amountCents: 7600 })).toThrow(/goods \+ duty/);
  });
});

describe("DDP commercial invoice", () => {
  it("declares goods value, prepaid duty, its basis, and incoterm DDP", async () => {
    const { app, items } = await testApp(new SimulatedPaymentProvider());
    // Fixture item 2: $34 bowl, HS 6912.00 → 9.8% MFN (6912.00.48) + 10% IN = 19.8% → $6.73.
    const created = (await request(app).post("/api/orders").send({ itemId: items[2].id, quantity: 1 }).expect(201)).body;
    expect(created.dutyCents).toBe(673);
    const paid = (await request(app).post(`/api/orders/${created.orderId}/capture`).expect(200)).body;
    expect(paid.status).toBe("paid");
    const inv = (await request(app).get(`/api/invoices/${paid.invoice.id}`).expect(200)).body.snapshot;
    expect(inv.incoterm).toBe("DDP");
    expect(inv.goodsTotalCents).toBe(3400);
    expect(inv.dutyTotalCents).toBe(673);
    expect(inv.totalCents).toBe(4073);
    expect(inv.lines[0].totalCents).toBe(3400); // declared value excludes duty
    expect(inv.dutyBasis).toMatch(/HS 6912\.00/);
    expect(inv.terms).toMatch(/DDP/);
  });

  it("shop items carry the server's duty estimate and basis", async () => {
    const { app, items } = await testApp(new SimulatedPaymentProvider());
    const item = (await request(app).get(`/api/shop/${items[0].id}`).expect(200)).body;
    expect(item.duty.status).toBe("estimated");
    expect(item.duty.unitDutyCents).toBe(809);
    expect(item.duty.basis).toMatch(/21\.3%/);
  });
});
