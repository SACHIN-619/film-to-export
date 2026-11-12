import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, usd } from "../api";
import type { Order } from "../types";
import { Spinner, StatusPill } from "../components/bits";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <p className="kicker">Seller · orders</p>
            <h1 className="display">Orders &amp; invoices</h1>
          </div>
          <span className="small muted" style={{ border: "1px solid var(--border, #e5e5e5)", padding: "4px 8px", borderRadius: 4 }}>
            Powered by <strong>AG Grid</strong>
          </span>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {!orders && !error ? (
        <Spinner label="Loading…" />
      ) : orders && orders.length === 0 ? (
        <p className="muted">No orders yet. When a buyer pays, the order and its commercial invoice show up here.</p>
      ) : (
        <>
          <OrderGrid orders={active} onUpdate={replace} />
          {stale.length > 0 && (
            <details className="abandoned" style={{ marginTop: "2rem" }}>
              <summary>
                Abandoned checkouts ({stale.length}): opened PayPal but never paid. If a buyer says they did pay, use
                “Check with PayPal”.
              </summary>
              <OrderGrid orders={stale} onUpdate={replace} />
            </details>
          )}
        </>
      )}
    </div>
  );
}

function OrderGrid({ orders, onUpdate }: { orders: Order[]; onUpdate: (o: Order) => void }) {
  const colDefs = useMemo<ColDef<Order>[]>(() => [
    {
      field: "id",
      headerName: "Order ID",
      flex: 1.2,
      minWidth: 160,
      cellRenderer: (params: ICellRendererParams<Order>) => {
        if (!params.data) return null;
        return (
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", lineHeight: "1.2" }}>
            <Link to={`/orders/${params.data.id}`} className="mono" style={{ fontWeight: 600 }}>
              {params.data.id}
            </Link>
            <span className="small muted">{new Date(params.data.createdAt).toLocaleDateString()}</span>
          </div>
        );
      },
    },
    {
      headerName: "Piece",
      field: "item.title",
      flex: 1.6,
      minWidth: 180,
      filter: true,
    },
    {
      headerName: "Buyer",
      flex: 1.2,
      minWidth: 140,
      filter: true,
      valueGetter: (params) => {
        const b = params.data?.buyer;
        return b?.name ? `${b.name} (${b.country ?? "US"})` : "—";
      },
    },
    {
      field: "amountCents",
      headerName: "Amount",
      width: 110,
      cellClass: "num",
      valueFormatter: (params) => usd(params.value ?? 0),
    },
    {
      field: "status",
      headerName: "Status",
      flex: 1.4,
      minWidth: 160,
      cellRenderer: (params: ICellRendererParams<Order>) => {
        if (!params.data) return null;
        const o = params.data;
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <StatusPill status={o.status} />
            {(o.status === "created" || o.status === "payment_pending") && o.paypalOrderId && (
              <CheckWithPayPal order={o} onUpdate={onUpdate} />
            )}
          </div>
        );
      },
    },
    {
      headerName: "Commercial Invoice",
      flex: 1.2,
      minWidth: 160,
      cellRenderer: (params: ICellRendererParams<Order>) => {
        const inv = params.data?.invoice;
        if (!inv) return <span className="muted">—</span>;
        return (
          <a href={`/api/invoices/${inv.id}/pdf`} className="mono" style={{ textDecoration: "underline" }}>
            {inv.number} ↓ (PDF)
          </a>
        );
      },
    },
  ], [onUpdate]);

  if (orders.length === 0) return null;

  return (
    <div className="ag-theme-quartz" style={{ height: Math.min(480, Math.max(220, (orders.length + 1) * 55)), width: "100%", borderRadius: 6, overflow: "hidden" }}>
      <AgGridReact
        rowData={orders}
        columnDefs={colDefs}
        defaultColDef={{ sortable: true, resizable: true }}
        pagination={orders.length > 8}
        paginationPageSize={10}
        domLayout="autoHeight"
      />
    </div>
  );
}

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
      <button className="btn link small" onClick={check} disabled={busy} style={{ fontSize: "12px", padding: 0 }}>
        {busy ? "Checking…" : "Check with PayPal"}
      </button>
      {note && <div className="small muted" style={{ fontSize: "10px" }}>{note}</div>}
    </div>
  );
}
