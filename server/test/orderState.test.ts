import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, assertTransition, canTransition, isTerminal, IllegalTransitionError, type OrderStatus } from "../src/domain/orderState.js";

describe("order state machine", () => {
  const allowed: [OrderStatus, OrderStatus][] = [
    ["created", "paid"],
    ["created", "payment_pending"],
    ["created", "failed"],
    ["created", "cancelled"],
    ["payment_pending", "paid"],
    ["payment_pending", "failed"],
  ];

  it("allows exactly the documented transitions", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it("treats paid, failed and cancelled as terminal", () => {
    expect(isTerminal("paid")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("created")).toBe(false);
    expect(isTerminal("payment_pending")).toBe(false);
  });

  it("throws on an illegal transition such as paid -> created or failed -> paid", () => {
    expect(() => assertTransition("paid", "created")).toThrow(IllegalTransitionError);
    expect(() => assertTransition("failed", "paid")).toThrow(IllegalTransitionError);
    expect(() => assertTransition("cancelled", "paid")).toThrow(/cancelled -> paid/);
  });
});
