/**
 * Order state machine.
 *
 *   created ──► paid               (verified capture COMPLETED)
 *      │  ├──► payment_pending ──► paid | failed
 *      │  ├──► failed
 *      │  └──► cancelled
 *
 * `paid` is only reachable with a VerifiedCapture (see payments/verifyCapture.ts),
 * never from anything the browser reports.
 */
export const ORDER_STATUSES = ["created", "payment_pending", "paid", "failed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  created: ["paid", "payment_pending", "failed", "cancelled"],
  payment_pending: ["paid", "failed"],
  paid: [],
  failed: [],
  cancelled: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Illegal order transition ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export function isTerminal(s: OrderStatus): boolean {
  return TRANSITIONS[s].length === 0;
}
