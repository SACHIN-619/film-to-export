import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, usd } from "../api";
import type { Order } from "../types";
import { Spinner, StatusPill } from "../components/bits";

/** Unpaid checkouts older than this are folded away as abandoned. */
const ABANDONED_AFTER_MS = 30 * 60 * 1000;

export default function Orders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Order[]>("/orders").then(setOrders).catch((e) => setError((e as Error).message));
  }, []);

  const replace = (o: Order) => setOrders((list) => list?.map((x) => (x.id === o.id ? o : x)) ?? null);
  const now = Date.now();
  const abandoned = (o: Order) => o.status === "created" && now - new Date(o.createdAt).getTime() > ABANDONED_AFTER_MS;
  const active = orders?.filter((o) => !abandoned(o)) ?? [];
  const stale = orders?.filter(abandoned) ?? [];

  return (
    <div className="page orders">
      <header className="page-head">
        <p className="kicker">Seller · orders</p>
        <h1 className="display">Orders &amp; invoices</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!orders && !error ? (
        <Spinner label="Loading…" />
      ) : orders && orders.length === 0 ? (
        <p className="muted">No orders yet. When a buyer pays, the order and its commercial invoice show up here.</p>
      ) : (
        <>
          <OrderTable orders={active} onUpdate={replace} />
          {stale.length > 0 && (
            <details className="abandoned">
              <summary>
                Abandoned checkouts ({stale.length}): opened PayPal but never paid. If a buyer says they did pay, use
                “Check with PayPal”.
              </summary>
              <OrderTable orders={stale} onUpdate={replace} />
            </details>
          )}
        </>
      )}
    </div>
  );
}

function OrderTable({ orders, onUpdate }: { orders: Order[]; onUpdate: (o: Order) => void }) {
  if (orders.length === 0) return null;
  return (
    <div className="table-scroll">
      <table className="ledger">
        <thead>
          <tr>
            <th>Order</th>
            <th>Piece</th>
            <th>Buyer</th>
            <th className="num">Amount</th>
            <th>Status</th>
            <th>Invoice</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <Link to={`/orders/${o.id}`} className="mono">
                  {o.id}
                </Link>
                <div className="small muted">{new Date(o.createdAt).toLocaleString()}</div>
              </td>
              <td>{o.item.title}</td>
              <td>{o.buyer.name ? `${o.buyer.name} (${o.buyer.country ?? "?"})` : <span className="muted">—</span>}</td>
              <td className="num">{usd(o.amountCents)}</td>
              <td>
                <StatusPill status={o.status} />
                {o.paymentsMode === "simulation" && <div className="small muted">simulation</div>}
                {(o.status === "created" || o.status === "payment_pending") && o.paypalOrderId && (
                  <CheckWithPayPal order={o} onUpdate={onUpdate} />
                )}
              </td>
              <td>
                {o.invoice ? (
                  <a href={`/api/invoices/${o.invoice.id}/pdf`} className="mono">
                    {o.invoice.number} ↓
                  </a>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Asks the server to capture + verify. PayPal only lets this succeed if the buyer
 * really approved the order; otherwise it answers ORDER_NOT_APPROVED and nothing changes.
 */
function CheckWithPayPal({ order, onUpdate }: { order: Order; onUpdate: (o: Order) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const check = async () => {
    setBusy(true);
    setNote(null);
    try {
      const updated = await api<Order>(`/orders/${order.id}/capture`, { method: "POST" });
      onUpdate(updated);
      if (updated.status === "created") setNote("Still unpaid.");
    } catch (e) {
      const msg = (e as Error).message;
      setNote(/ORDER_NOT_APPROVED/.test(msg) ? "Buyer never approved this one." : msg);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button className="btn link small" onClick={check} disabled={busy}>
        {busy ? "Checking…" : "Check with PayPal"}
      </button>
      {note && <div className="small muted">{note}</div>}
    </div>
  );
}
