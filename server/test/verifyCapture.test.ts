import { describe, expect, it } from "vitest";
import { verifyCapture } from "../src/payments/verifyCapture.js";
import type { PayPalOrder } from "../src/payments/provider.js";

const expected = { orderId: "FTE-AAAA1111", amountCents: 3800, currency: "USD" };

function ppOrder(over: { orderStatus?: string; captureStatus?: string; value?: string; currency?: string; ref?: string; noCapture?: boolean } = {}): PayPalOrder {
  return {
    id: "5O190127TN364715T",
    status: over.orderStatus ?? "COMPLETED",
    payer: { email_address: "buyer@example.com", name: { given_name: "Ana", surname: "Ruiz" }, address: { country_code: "US" } },
    purchase_units: [
      {
        reference_id: over.ref ?? "FTE-AAAA1111",
        shipping: {
          name: { full_name: "Ana Ruiz" },
          address: { address_line_1: "1 Main St", admin_area_2: "Austin", admin_area_1: "TX", postal_code: "78701", country_code: "US" },
        },
        payments: over.noCapture
          ? undefined
          : {
              captures: [
                {
                  id: "3C679366HH908993F",
                  status: over.captureStatus ?? "COMPLETED",
                  status_details: over.captureStatus === "PENDING" ? { reason: "RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION" } : undefined,
                  amount: { currency_code: over.currency ?? "USD", value: over.value ?? "38.00" },
                },
              ],
            },
      },
    ],
  };
}

describe("verifyCapture", () => {
  it("accepts a COMPLETED capture with matching reference, amount and currency", () => {
    const r = verifyCapture(expected, ppOrder());
    expect(r.outcome).toBe("completed");
    if (r.outcome === "rejected") throw new Error("unreachable");
    expect(r.captureId).toBe("3C679366HH908993F");
    expect(r.buyer).toEqual({ name: "Ana Ruiz", email: "buyer@example.com", address: "1 Main St, Austin, TX, 78701", country: "US" });
  });

  it("accepts '38' as equal to 3800 cents", () => {
    expect(verifyCapture(expected, ppOrder({ value: "38" })).outcome).toBe("completed");
  });

  it("reports PENDING captures as pending (never paid)", () => {
    const r = verifyCapture(expected, ppOrder({ captureStatus: "PENDING" }));
    expect(r.outcome).toBe("pending");
    if (r.outcome === "rejected") throw new Error("unreachable");
    expect(r.pendingReason).toBe("RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION");
  });

  it.each([
    ["amount too low", { value: "0.01" }, /Amount mismatch/],
    ["amount too high", { value: "380.00" }, /Amount mismatch/],
    ["malformed amount", { value: "38.000" }, /Amount mismatch/],
    ["wrong currency", { currency: "INR" }, /Currency mismatch/],
    ["someone else's order", { ref: "FTE-OTHER" }, /reference/],
    ["approved but not captured", { orderStatus: "APPROVED", noCapture: true }, /No capture/],
    ["declined capture", { captureStatus: "DECLINED" }, /DECLINED/],
    ["capture completed but order not", { orderStatus: "APPROVED" }, /order status APPROVED/],
  ])("rejects %s", (_name, over, reason) => {
    const r = verifyCapture(expected, ppOrder(over));
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") throw new Error("unreachable");
    expect(r.reason).toMatch(reason);
  });

  it("rejects a missing response", () => {
    expect(verifyCapture(expected, null).outcome).toBe("rejected");
    expect(verifyCapture(expected, undefined).outcome).toBe("rejected");
  });
});
