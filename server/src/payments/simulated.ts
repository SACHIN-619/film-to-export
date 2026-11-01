import { randomBytes } from "node:crypto";
import { centsToValue } from "../domain/money.js";
import { PaymentProviderError, type CreateOrderInput, type PaymentProvider, type PayPalOrder } from "./provider.js";

/**
 * SIMULATION payments. No money, no PayPal. Order ids start with SIM- so they can
 * never be mistaken for real PayPal ids. The response shape mirrors Orders v2 so the
 * exact same verifyCapture() path runs.
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly mode = "simulation" as const;
  private orders = new Map<string, PayPalOrder>();

  async createOrder(input: CreateOrderInput): Promise<{ id: string }> {
    const id = `SIM-${randomBytes(6).toString("hex").toUpperCase()}`;
    this.orders.set(id, {
      id,
      status: "CREATED",
      purchase_units: [
        {
          reference_id: input.orderId,
          custom_id: input.orderId,
          amount: { currency_code: input.currency, value: centsToValue(input.amountCents) },
        },
      ],
    });
    return { id };
  }

  async captureOrder(paypalOrderId: string): Promise<PayPalOrder> {
    const order = this.orders.get(paypalOrderId);
    if (!order) throw new PaymentProviderError("Simulated order not found", 404, "RESOURCE_NOT_FOUND");
    if (order.status === "COMPLETED") throw new PaymentProviderError("Already captured", 422, "ORDER_ALREADY_CAPTURED");
    const unit = order.purchase_units![0];
    order.status = "COMPLETED";
    order.payer = {
      email_address: "sim-buyer@example.com",
      name: { given_name: "Sim", surname: "Buyer" },
      address: { country_code: "US" },
    };
    unit.shipping = {
      name: { full_name: "Sim Buyer (SIMULATION)" },
      address: {
        address_line_1: "100 Example Street",
        admin_area_2: "Brooklyn",
        admin_area_1: "NY",
        postal_code: "11201",
        country_code: "US",
      },
    };
    unit.payments = {
      captures: [{ id: `SIM-CAP-${randomBytes(5).toString("hex").toUpperCase()}`, status: "COMPLETED", amount: unit.amount }],
    };
    return structuredClone(order);
  }

  async getOrder(paypalOrderId: string): Promise<PayPalOrder> {
    const order = this.orders.get(paypalOrderId);
    if (!order) throw new PaymentProviderError("Simulated order not found", 404, "RESOURCE_NOT_FOUND");
    return structuredClone(order);
  }

  async createInvoiceDraft(): Promise<string | null> {
    return null;
  }
}
