import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, usd } from "../api";
import type { Invoice, Order } from "../types";
import { Spinner, StatusPill } from "../components/bits";
import { InvoiceDocument } from "../components/InvoiceDocument";

const HEADLINE: Record<string, string> = {
  paid: "Payment verified.",
  payment_pending: "Payment pending.",
  created: "Awaiting payment.",
  failed: "Payment not verified.",
  cancelled: "Order cancelled.",
};

export default function OrderPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Order>(`/orders/${id}`).then(setOrder).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => {
    if (order?.invoice) api<Invoice>(`/invoices/${order.invoice.id}`).then(setInvoice);
  }, [order?.invoice?.id]);

  const recheck = async () => {
    setRechecking(true);
    try {
      setOrder(await api<Order>(`/orders/${id}/capture`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRechecking(false);
    }
  };

  if (error && !order) return <div className="page narrow"><p className="error">{error}</p></div>;
  if (!order) return <div className="page"><Spinner label="Loading order…" /></div>;
  const sim = order.paymentsMode === "simulation";

  return (
    <div className="page order">
      <header className="page-head">
        <p className="kicker">
          Order <span className="mono">{order.id}</span> · <StatusPill status={order.status} />
        </p>
        <h1 className="display">{HEADLINE[order.status]}</h1>
      </header>

      <div className="order-grid">
        <aside className="receipt">
          {order.item.imageUrl && <img src={order.item.imageUrl} alt="" />}
          <h2>{order.item.title}</h2>
          <p className="price">{usd(order.amountCents)} <span className="muted small">{order.currency}</span></p>
          {order.dutyCents > 0 && (
            <dl className="duty-lines">
              <div><dt>Goods</dt><dd>{usd(order.goodsCents)}</dd></div>
              <div><dt>Est. US import duty (DDP)</dt><dd>{usd(order.dutyCents)}</dd></div>
            </dl>
          )}

          <dl className="specs tight">
            <div><dt>Payment</dt><dd>{sim ? "SIMULATION (no real payment)" : "PayPal Sandbox"}</dd></div>
            <div><dt>PayPal order</dt><dd className="mono">{order.paypalOrderId ?? "—"}</dd></div>
            <div><dt>Capture</dt><dd className="mono">{order.captureId ?? "—"} {order.captureStatus && `(${order.captureStatus})`}</dd></div>
            {order.buyer.name && <div><dt>Buyer</dt><dd>{order.buyer.name}{order.buyer.country && `, ${order.buyer.country}`}</dd></div>}
          </dl>

          {order.status === "payment_pending" && (
            <div className="notice">
              PayPal accepted the payment but holds it as <strong>PENDING</strong>. Some Sandbox business accounts need
              to accept foreign-currency payments by hand. No invoice is issued until the capture completes.
              <div>
                <button className="btn ghost" onClick={recheck} disabled={rechecking}>
                  {rechecking ? "Checking…" : "Re-check with PayPal"}
                </button>
              </div>
            </div>
          )}

          <h3 className="timeline-title">Server log</h3>
          <ol className="timeline">
            {order.events.map((e, i) => (
              <li key={i}>
                <span className="mono small">{new Date(e.at).toLocaleTimeString()}</span>
                <strong>{e.toStatus}</strong>
                {e.note && <span className="muted"> {e.note}</span>}
              </li>
            ))}
          </ol>
          <p className="small muted">
            The server marks an order paid only after PayPal's own capture response (or a readback) matches the amount,
            currency and reference. Coming back from PayPal in the browser doesn't count.
          </p>
          {error && <p className="error">{error}</p>}
        </aside>

        <section className="invoice-col">
          {invoice ? (
            <>
              <div className="row gap between">
                <h2 className="display sm">Commercial invoice</h2>
                <a className="btn primary" href={`/api/invoices/${invoice.id}/pdf`}>
                  Download PDF
                </a>
              </div>
              {invoice.paypalInvoiceId && (
                <p className="small muted">
                  Also created in PayPal Invoicing as a draft: <span className="mono">{invoice.paypalInvoiceId}</span>
                </p>
              )}
              <InvoiceDocument inv={invoice.snapshot} />
            </>
          ) : (
            <div className="invoice-placeholder">
              <p className="display sm">The commercial invoice appears here once payment is verified.</p>
              <Link to="/shop">Back to the shop</Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
