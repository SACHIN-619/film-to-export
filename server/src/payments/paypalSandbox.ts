import { PAYPAL_API_BASE } from "../config.js";
import { centsToValue } from "../domain/money.js";
import {
  PaymentProviderError,
  type CreateOrderInput,
  type InvoiceDraftInput,
  type PaymentProvider,
  type PayPalOrder,
} from "./provider.js";

type FetchFn = typeof fetch;

/**
 * Orders v2 body. The estimated US import duty (DDP) goes in `tax_total`, with the
 * per-unit share in each item's `tax`. PayPal's breakdown has no "duty" field; `tax_total`
 * is the documented slot for government levies collected at checkout (`handling` is a
 * seller fee and would misstate it). PayPal requires amount = item_total + tax_total and
 * tax_total = Σ item.tax × quantity, which holds by construction here.
 */
export function buildOrderPayload(input: CreateOrderInput) {
  const money = (cents: number) => ({ currency_code: input.currency, value: centsToValue(cents) });
  const goodsCents = input.unitCents * input.quantity;
  const dutyCents = input.unitDutyCents * input.quantity;
  if (goodsCents + dutyCents !== input.amountCents) throw new Error("Order amount does not equal goods + duty");
  const breakdown: Record<string, ReturnType<typeof money>> = { item_total: money(goodsCents) };
  if (dutyCents > 0) breakdown.tax_total = money(dutyCents);
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: input.orderId,
        custom_id: input.orderId,
        description: (dutyCents > 0 ? `${input.itemName} (US import duty est. prepaid, DDP)` : input.itemName).slice(0, 127),
        amount: { ...money(input.amountCents), breakdown },
        items: [
          {
            name: input.itemName.slice(0, 127),
            sku: input.itemId,
            quantity: String(input.quantity),
            unit_amount: money(input.unitCents),
            ...(dutyCents > 0 ? { tax: money(input.unitDutyCents) } : {}),
            category: "PHYSICAL_GOODS",
          },
        ],
      },
    ],
  };
}

/** PayPal REST, Sandbox only. Secrets stay in this object and are never logged. */
export class PayPalSandboxProvider implements PaymentProvider {
  readonly mode = "sandbox" as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly opts: { createInvoice: boolean; fetchFn?: FetchFn } = { createInvoice: false },
  ) {}

  private get fetch(): FetchFn {
    return this.opts.fetchFn ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await this.fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PaymentProviderError(`PayPal OAuth failed (${res.status})`, res.status);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
    return json.access_token;
  }

  private async call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetch(`${PAYPAL_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const issue = json?.details?.[0]?.issue ?? json?.name;
      throw new PaymentProviderError(`PayPal ${method} ${path} failed (${res.status}${issue ? ` ${issue}` : ""})`, res.status, issue);
    }
    return json as T;
  }

  async createOrder(input: CreateOrderInput): Promise<{ id: string }> {
    const order = await this.call<PayPalOrder>("POST", "/v2/checkout/orders", buildOrderPayload(input), {
      "PayPal-Request-Id": `create-${input.orderId}`,
    });
    return { id: order.id };
  }

  captureOrder(paypalOrderId: string, idempotencyKey: string): Promise<PayPalOrder> {
    return this.call<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {}, {
      "PayPal-Request-Id": `capture-${idempotencyKey}`,
    });
  }

  getOrder(paypalOrderId: string): Promise<PayPalOrder> {
    return this.call<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
  }

  async createInvoiceDraft(input: InvoiceDraftInput): Promise<string | null> {
    if (!this.opts.createInvoice) return null;
    const res = await this.call<{ id?: string; href?: string }>("POST", "/v2/invoicing/invoices", {
      detail: {
        currency_code: input.currency,
        invoice_number: input.number,
        note: input.note.slice(0, 4000),
        payment_term: { term_type: "DUE_ON_RECEIPT" },
      },
      primary_recipients: input.buyerEmail
        ? [{ billing_info: { email_address: input.buyerEmail, name: { full_name: input.buyerName ?? undefined } } }]
        : [],
      items: input.lines.map((l) => ({
        name: l.name.slice(0, 200),
        description: l.description.slice(0, 1000),
        quantity: String(l.quantity),
        unit_amount: { currency_code: input.currency, value: centsToValue(l.unitCents) },
        unit_of_measure: "QUANTITY",
      })),
    });
    return res.id ?? res.href?.split("/").pop() ?? null;
  }
}
