import { valueToCents } from "../domain/money.js";
import type { PayPalOrder } from "./provider.js";

export interface ExpectedPayment {
  orderId: string; // our id, sent as reference_id
  amountCents: number;
  currency: string;
}

export interface Buyer {
  name: string | null;
  email: string | null;
  address: string | null;
  country: string | null;
}

declare const verifiedBrand: unique symbol;

/** Only verifyCapture() can produce this; markPaid() requires it. */
export type VerifiedCapture = {
  readonly [verifiedBrand]: true;
  outcome: "completed" | "pending";
  captureId: string;
  captureStatus: string;
  pendingReason: string | null;
  buyer: Buyer;
};

export type VerifyResult = VerifiedCapture | { outcome: "rejected"; reason: string };

/**
 * Decide, from a PayPal order resource fetched by the SERVER (capture response
 * or GET readback), whether money for exactly this order was captured.
 */
export function verifyCapture(expected: ExpectedPayment, order: PayPalOrder | null | undefined): VerifyResult {
  const reject = (reason: string): VerifyResult => ({ outcome: "rejected", reason });
  if (!order || typeof order !== "object") return reject("No PayPal order in response");

  const units = order.purchase_units ?? [];
  const unit = units.find((u) => u.reference_id === expected.orderId) ?? null;
  if (!unit) return reject("Purchase unit reference does not match this order");

  const capture = unit.payments?.captures?.[0];
  if (!capture) return reject(`No capture on PayPal order (order status ${order.status})`);

  const amount = capture.amount ?? unit.amount;
  if (!amount) return reject("Capture has no amount");
  if (amount.currency_code !== expected.currency) {
    return reject(`Currency mismatch: expected ${expected.currency}, got ${amount.currency_code}`);
  }
  const cents = valueToCents(amount.value);
  if (cents === null || cents !== expected.amountCents) {
    return reject(`Amount mismatch: expected ${expected.amountCents} cents, got ${amount.value}`);
  }

  let outcome: "completed" | "pending";
  if (capture.status === "COMPLETED" && order.status === "COMPLETED") outcome = "completed";
  else if (capture.status === "PENDING") outcome = "pending";
  else return reject(`Capture status ${capture.status}, order status ${order.status}`);

  const addr = unit.shipping?.address;
  const addressLine = addr
    ? [addr.address_line_1, addr.address_line_2, addr.admin_area_2, addr.admin_area_1, addr.postal_code]
        .filter(Boolean)
        .join(", ")
    : null;
  const payerName = [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(" ");

  return {
    outcome,
    captureId: capture.id,
    captureStatus: capture.status,
    pendingReason: capture.status_details?.reason ?? null,
    buyer: {
      name: unit.shipping?.name?.full_name ?? (payerName || null),
      email: order.payer?.email_address ?? null,
      address: addressLine,
      country: addr?.country_code ?? order.payer?.address?.country_code ?? null,
    },
  } as VerifiedCapture;
}
