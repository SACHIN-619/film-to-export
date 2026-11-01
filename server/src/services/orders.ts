import { randomBytes } from "node:crypto";
import { nowIso, type Db } from "../db.js";
import { assertTransition, type OrderStatus } from "../domain/orderState.js";
import { PaymentProviderError, type PaymentProvider, type PayPalOrder } from "../payments/provider.js";
import { verifyCapture, type VerifiedCapture } from "../payments/verifyCapture.js";
import { conflict, HttpError, notFound } from "./errors.js";
import { getItemForSale, rateOverride } from "./listings.js";
import { issueInvoice } from "./invoices.js";
import { dutyBasis, estimateDuty } from "../domain/duty.js";

interface OrderRow {
  id: string;
  item_id: string;
  quantity: number;
  amount_cents: number;
  goods_cents: number;
  duty_cents: number;
  duty_basis: string | null;
  currency: string;
  status: OrderStatus;
  payments_mode: string;
  paypal_order_id: string | null;
  capture_id: string | null;
  capture_status: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_address: string | null;
  buyer_country: string | null;
  created_at: string;
  paid_at: string | null;
}

/** Capture errors that mean "ask PayPal what actually happened" rather than "it failed". */
const READBACK_ISSUES = new Set(["ORDER_ALREADY_CAPTURED", "DUPLICATE_INVOICE_ID"]);

/** Columns transition() may set alongside status. Whitelisted because they are spliced into SQL. */
const SETTABLE = new Set(["capture_id", "capture_status", "buyer_name", "buyer_email", "buyer_address", "buyer_country", "paid_at"]);

export class OrderService {
  constructor(
    private readonly db: Db,
    private readonly payments: PaymentProvider,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  private async row(id: string, db: Db = this.db): Promise<OrderRow> {
    const r = await db.get<OrderRow>("SELECT * FROM orders WHERE id = $1", [id]);
    if (!r) throw notFound("Order");
    return r;
  }

  private async event(db: Db, orderId: string, from: OrderStatus | null, to: OrderStatus, note: string) {
    await db.run("INSERT INTO order_events (order_id, from_status, to_status, note, created_at) VALUES ($1, $2, $3, $4, $5)", [
      orderId,
      from,
      to,
      note,
      nowIso(),
    ]);
  }

  private async transition(db: Db, order: OrderRow, to: OrderStatus, note: string, extra: Record<string, string | number | null> = {}) {
    assertTransition(order.status, to);
    const keys = Object.keys(extra);
    for (const k of keys) if (!SETTABLE.has(k)) throw new Error(`Column ${k} is not settable`);
    const sets = ["status = $1", ...keys.map((k, i) => `${k} = $${i + 2}`)].join(", ");
    const n = keys.length;
    const changed = await db.run(`UPDATE orders SET ${sets} WHERE id = $${n + 2} AND status = $${n + 3}`, [
      to,
      ...Object.values(extra),
      order.id,
      order.status,
    ]);
    // Someone else (a concurrent capture request) moved this order first.
    if (changed === 0) throw conflict(`Order ${order.id} changed concurrently`);
    await this.event(db, order.id, order.status, to, note);
  }

  /**
   * Create an order. The amount is computed here from the DB price; the browser
   * only names the item and quantity (any amount it sends was already stripped by Zod
   * and would be ignored anyway).
   */
  async create(input: { itemId: string; quantity: number }) {
    const item = await getItemForSale(this.db, input.itemId);
    if (item.quantity < input.quantity) throw conflict("Not enough stock");
    // Duty is estimated here from the seller-confirmed HS code and price, never taken from the client.
    const duty = estimateDuty(item.hs_code, item.price_cents, item.country_of_origin, undefined, rateOverride(item));
    const goodsCents = item.price_cents * input.quantity;
    const dutyCents = duty.unitDutyCents * input.quantity;
    const amountCents = goodsCents + dutyCents;
    const id = `FTE-${randomBytes(4).toString("hex").toUpperCase()}`;
    await this.db.run(
      `INSERT INTO orders (id, item_id, quantity, amount_cents, goods_cents, duty_cents, duty_basis, currency, status, payments_mode, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'USD', 'created', $8, $9)`,
      [id, item.id, input.quantity, amountCents, goodsCents, dutyCents, JSON.stringify({ text: dutyBasis(duty), estimate: duty }), this.payments.mode, nowIso()],
    );
    await this.event(
      this.db,
      id,
      null,
      "created",
      `Server priced ${input.quantity} × ${item.price_cents}c + est. duty ${dutyCents}c (${duty.status === "estimated" ? `${duty.totalPct}%` : "not estimated"})`,
    );

    try {
      const pp = await this.payments.createOrder({
        orderId: id,
        itemId: item.id,
        itemName: item.title_en,
        quantity: input.quantity,
        unitCents: item.price_cents,
        unitDutyCents: duty.unitDutyCents,
        amountCents,
        currency: "USD",
      });
      await this.db.run("UPDATE orders SET paypal_order_id = $1 WHERE id = $2", [pp.id, id]);
      return { orderId: id, paypalOrderId: pp.id, amountCents, goodsCents, dutyCents, currency: "USD" };
    } catch (err) {
      await this.transition(this.db, await this.row(id), "failed", `PayPal create failed: ${(err as Error).message}`);
      throw new HttpError(502, "Could not create the PayPal order");
    }
  }

  /** Same as capture(), addressed by the PayPal order id the JS SDK hands to onApprove. */
  async captureByPayPalId(paypalOrderId: string) {
    const r = await this.db.get<{ id: string }>("SELECT id FROM orders WHERE paypal_order_id = $1", [paypalOrderId]);
    if (!r) throw notFound("Order");
    return this.capture(r.id);
  }

  /** Capture, then verify with PayPal's own response (or a readback) before marking paid. */
  async capture(orderId: string) {
    let order = await this.row(orderId);
    if (order.status === "paid") return this.get(orderId); // idempotent
    if (order.status !== "created" && order.status !== "payment_pending") throw conflict(`Order is ${order.status}`);
    if (!order.paypal_order_id) throw conflict("Order has no PayPal order id");

    let ppOrder: PayPalOrder;
    if (order.status === "payment_pending") {
      ppOrder = await this.payments.getOrder(order.paypal_order_id);
    } else {
      try {
        ppOrder = await this.payments.captureOrder(order.paypal_order_id, order.id);
      } catch (err) {
        const pe = err instanceof PaymentProviderError ? err : null;
        const shouldReadBack = !pe || pe.status >= 500 || (pe.issue !== undefined && READBACK_ISSUES.has(pe.issue));
        if (!shouldReadBack) {
          // e.g. ORDER_NOT_APPROVED or INSTRUMENT_DECLINED: the buyer can retry; order stays `created`.
          throw new HttpError(422, `PayPal could not capture this order${pe?.issue ? ` (${pe.issue})` : ""}`, { issue: pe?.issue });
        }
        this.log(`capture ${order.id}: ${(err as Error).message}; reading order back from PayPal`);
        ppOrder = await this.payments.getOrder(order.paypal_order_id);
      }
    }

    const result = verifyCapture({ orderId: order.id, amountCents: order.amount_cents, currency: order.currency }, ppOrder);
    order = await this.row(orderId);
    if (order.status === "paid") return this.get(orderId); // a parallel request already finished
    if (result.outcome === "rejected") {
      await this.transition(this.db, order, "failed", `Verification rejected: ${result.reason}`);
    } else if (result.outcome === "pending") {
      if (order.status !== "payment_pending") {
        await this.transition(this.db, order, "payment_pending", `Capture PENDING${result.pendingReason ? ` (${result.pendingReason})` : ""}`, {
          capture_id: result.captureId,
          capture_status: result.captureStatus,
        });
      }
    } else {
      await this.markPaid(order, result);
    }
    return this.get(orderId);
  }

  /** The only path to `paid`. Requires a VerifiedCapture. */
  private async markPaid(order: OrderRow, v: VerifiedCapture) {
    const invoice = await this.db.tx(async (t) => {
      await this.transition(t, order, "paid", `Capture ${v.captureId} verified COMPLETED`, {
        capture_id: v.captureId,
        capture_status: v.captureStatus,
        buyer_name: v.buyer.name,
        buyer_email: v.buyer.email,
        buyer_address: v.buyer.address,
        buyer_country: v.buyer.country,
        paid_at: nowIso(),
      });
      // Decrement, then clamp + mark sold out. The explicit ::int cast matters: pg-mem (tests)
      // miscomputes arithmetic with an untyped parameter; real Postgres is fine either way.
      await t.run("UPDATE items SET quantity = quantity - $1::int WHERE id = $2", [order.quantity, order.item_id]);
      await t.run("UPDATE items SET quantity = 0, status = 'sold_out' WHERE id = $1 AND quantity <= 0", [order.item_id]);
      return issueInvoice(t, order.id);
    });

    // Stretch: mirror into PayPal Invoicing. Best-effort; never affects the paid state.
    if (this.payments.createInvoiceDraft) {
      try {
        const snap = invoice.snapshot;
        const ppId = await this.payments.createInvoiceDraft({
          number: snap.number,
          buyerEmail: v.buyer.email,
          buyerName: v.buyer.name,
          currency: snap.currency,
          lines: snap.lines.map((l) => ({ name: l.description, description: `HS ${l.hsCode} · Origin ${l.origin}`, quantity: l.quantity, unitCents: l.unitCents })),
          note: `Commercial invoice for order ${order.id}. Already paid via PayPal capture ${v.captureId}.`,
        });
        if (ppId) await this.db.run("UPDATE invoices SET paypal_invoice_id = $1 WHERE id = $2", [ppId, invoice.id]);
      } catch (err) {
        this.log(`PayPal invoice draft failed for ${order.id}: ${(err as Error).message}`);
      }
    }
  }

  async get(orderId: string) {
    const o = await this.row(orderId);
    const item = (await this.db.get<{ id: string; title_en: string; image_path: string | null; origin: string }>(
      "SELECT id, title_en, image_path, origin FROM items WHERE id = $1",
      [o.item_id],
    ))!;
    const events = await this.db.all<{ fromStatus: string | null; toStatus: string; note: string | null; at: string }>(
      `SELECT from_status AS "fromStatus", to_status AS "toStatus", note, created_at AS "at"
       FROM order_events WHERE order_id = $1 ORDER BY id`,
      [o.id],
    );
    const inv = await this.db.get<{ id: string; inv_number: string; paypal_invoice_id: string | null }>(
      "SELECT id, inv_number, paypal_invoice_id FROM invoices WHERE order_id = $1",
      [o.id],
    );
    return {
      id: o.id,
      status: o.status,
      quantity: o.quantity,
      amountCents: o.amount_cents,
      goodsCents: o.goods_cents || o.amount_cents - o.duty_cents,
      dutyCents: o.duty_cents,
      dutyBasis: o.duty_basis ? (JSON.parse(o.duty_basis) as { text: string }).text : null,
      currency: o.currency,
      paymentsMode: o.payments_mode,
      paypalOrderId: o.paypal_order_id,
      captureId: o.capture_id,
      captureStatus: o.capture_status,
      buyer: { name: o.buyer_name, email: o.buyer_email, address: o.buyer_address, country: o.buyer_country },
      createdAt: o.created_at,
      paidAt: o.paid_at,
      item: { id: item.id, title: item.title_en, imageUrl: item.image_path, origin: item.origin },
      invoice: inv ? { id: inv.id, number: inv.inv_number, paypalInvoiceId: inv.paypal_invoice_id } : null,
      events,
    };
  }

  async list() {
    const ids = await this.db.all<{ id: string }>("SELECT id FROM orders ORDER BY created_at DESC LIMIT 100");
    return Promise.all(ids.map((r) => this.get(r.id)));
  }
}
