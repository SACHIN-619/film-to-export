import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { useConfig } from "../App";
import type { Item, Order } from "../types";
import { Spinner } from "./bits";

/* Minimal typings for the PayPal JS SDK Buttons component. */
interface PayPalButtonsInstance {
  render(el: HTMLElement): Promise<void>;
  close(): Promise<void>;
  isEligible(): boolean;
}
interface PayPalNamespace {
  Buttons(opts: {
    style?: Record<string, string | number>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }, actions: { restart: () => Promise<void> }) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }): PayPalButtonsInstance;
}
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let sdkPromise: Promise<PayPalNamespace> | null = null;
function loadPayPalSdk(clientId: string): Promise<PayPalNamespace> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    // A Sandbox client id makes the SDK talk to the PayPal Sandbox.
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
    s.async = true;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK loaded without window.paypal")));
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("Could not load the PayPal SDK"));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

interface CreatedOrder {
  orderId: string;
  paypalOrderId: string;
  amountCents: number;
}

export function Checkout({ item, onPaid }: { item: Item; onPaid: (orderId: string) => void }) {
  const config = useConfig();
  if (!config) return <Spinner />;
  return config.paymentsMode === "sandbox" && config.paypalClientId ? (
    <PayPalCheckout clientId={config.paypalClientId} item={item} onPaid={onPaid} />
  ) : (
    <SimulatedCheckout item={item} onPaid={onPaid} />
  );
}

function PayPalCheckout({ clientId, item, onPaid }: { clientId: string; item: Item; onPaid: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "capturing" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  // Keep the latest callback without re-rendering the PayPal buttons on every parent render.
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  useEffect(() => {
    let buttons: PayPalButtonsInstance | null = null;
    let cancelled = false;

    loadPayPalSdk(clientId)
      .then((paypal) => {
        if (cancelled || !ref.current) return;
        buttons = paypal.Buttons({
          style: { layout: "vertical", color: "black", shape: "rect", label: "pay", height: 48 },
          // The browser only names the item; the server prices it.
          createOrder: async () => {
            setMessage(null);
            const created = await api<CreatedOrder>("/orders", { method: "POST", json: { itemId: item.id, quantity: 1 } });
            return created.paypalOrderId;
          },
          // Approval is NOT payment. The server captures and verifies. Address the order by the id
          // PayPal hands back, so this works even if the user opened checkout twice.
          onApprove: async (data, actions) => {
            setState("capturing");
            try {
              const order = await api<Order>(`/orders/by-paypal/${encodeURIComponent(data.orderID)}/capture`, { method: "POST" });
              onPaidRef.current(order.id);
            } catch (e) {
              const issue = ((e as ApiError).body as { details?: { issue?: string } } | null)?.details?.issue;
              if (issue === "INSTRUMENT_DECLINED") {
                setState("ready");
                setMessage("That funding source was declined. Choose another one in PayPal.");
                return actions.restart();
              }
              setState("error");
              setMessage((e as Error).message);
            }
          },
          onCancel: () =>
            setMessage(
              "Checkout closed without paying. Nothing was charged. If PayPal showed “Things don't appear to be working”, " +
                "your Sandbox buyer is probably an India account: PayPal blocks India-to-India payments. " +
                "Log in with a United States Sandbox personal account instead.",
            ),
          onError: (err) => {
            setState("error");
            setMessage(err instanceof Error ? err.message : "PayPal reported an error");
          },
        });
        return buttons.render(ref.current).then(() => !cancelled && setState("ready"));
      })
      .catch((e: Error) => {
        setState("error");
        setMessage(e.message);
      });

    return () => {
      cancelled = true;
      buttons?.close().catch(() => {});
    };
  }, [clientId, item.id]);

  return (
    <div className="checkout">
      <p className="checkout-label">
        <span className="tag tag-live">PayPal Sandbox</span> Test money only. Log in with a Sandbox buyer account.
      </p>
      {state === "loading" && <Spinner label="Loading PayPal…" />}
      {state === "capturing" && <Spinner label="Verifying payment with PayPal…" />}
      <div ref={ref} className="paypal-slot" hidden={state === "capturing"} />
      {message && <p className={state === "error" ? "error" : "muted"}>{message}</p>}
    </div>
  );
}

function SimulatedCheckout({ item, onPaid }: { item: Item; onPaid: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api<CreatedOrder>("/orders", { method: "POST", json: { itemId: item.id, quantity: 1 } });
      const order = await api<Order>(`/orders/${created.orderId}/capture`, { method: "POST" });
      onPaid(order.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="checkout sim">
      <p className="checkout-label">
        <span className="tag tag-sim">SIMULATION</span> No PayPal keys configured. This button fakes a PayPal-shaped
        payment with a <span className="mono">SIM-</span> id. No money moves.
      </p>
      <button className="btn primary wide" onClick={pay} disabled={busy}>
        {busy ? "Simulating…" : "Simulated checkout"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
