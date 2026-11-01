import type { PaymentsMode } from "../config.js";

/** Subset of the PayPal Orders v2 order resource that we read. */
export interface PayPalMoney {
  currency_code: string;
  value: string;
}

export interface PayPalCapture {
  id: string;
  status: string; // COMPLETED | PENDING | DECLINED | ...
  status_details?: { reason?: string };
  amount?: PayPalMoney;
}

export interface PayPalPurchaseUnit {
  reference_id?: string;
  custom_id?: string;
  amount?: PayPalMoney;
  shipping?: {
    name?: { full_name?: string };
    address?: {
      address_line_1?: string;
      address_line_2?: string;
      admin_area_2?: string;
      admin_area_1?: string;
      postal_code?: string;
      country_code?: string;
    };
  };
  payments?: { captures?: PayPalCapture[] };
}

export interface PayPalOrder {
  id: string;
  status: string; // CREATED | APPROVED | COMPLETED | ...
  purchase_units?: PayPalPurchaseUnit[];
  payer?: {
    email_address?: string;
    name?: { given_name?: string; surname?: string };
    address?: { country_code?: string };
  };
}

export interface CreateOrderInput {
  orderId: string; // our internal id, used as reference_id/custom_id and idempotency key
  itemId: string;
  itemName: string;
  quantity: number;
  unitCents: number;
  /** Estimated US import duty per unit (DDP), sent to PayPal as item tax. 0 if not estimated. */
  unitDutyCents: number;
  /** goods (unitCents × quantity) + duty (unitDutyCents × quantity). */
  amountCents: number;
  currency: "USD";
}

export interface InvoiceDraftInput {
  number: string;
  buyerEmail: string | null;
  buyerName: string | null;
  currency: string;
  lines: { name: string; description: string; quantity: number; unitCents: number }[];
  note: string;
}

export interface PaymentProvider {
  readonly mode: PaymentsMode;
  createOrder(input: CreateOrderInput): Promise<{ id: string }>;
  /** Capture an approved order. Throws PaymentProviderError on HTTP failure. */
  captureOrder(paypalOrderId: string, idempotencyKey: string): Promise<PayPalOrder>;
  /** Server-side readback of the order's real state. */
  getOrder(paypalOrderId: string): Promise<PayPalOrder>;
  /** Stretch: create a draft PayPal invoice. Returns null when unsupported/disabled. */
  createInvoiceDraft?(input: InvoiceDraftInput): Promise<string | null>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue?: string,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
