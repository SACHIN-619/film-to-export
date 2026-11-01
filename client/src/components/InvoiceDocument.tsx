import { usd } from "../api";
import type { InvoiceSnapshot } from "../types";

export function InvoiceDocument({ inv }: { inv: InvoiceSnapshot }) {
  const s = inv.seller;
  const b = inv.buyer;
  return (
    <article className="invoice-doc">
      {inv.simulation && <div className="watermark">SIMULATION · NOT A REAL SALE</div>}
      <header>
        <h3>Commercial Invoice</h3>
        <p className="mono small">
          No. {inv.number} · Issued {inv.issuedAt.slice(0, 10)} · Order {inv.orderId}
        </p>
      </header>
      <div className="parties">
        <div>
          <h4>Exporter / Seller</h4>
          <p>
            <strong>{s.businessName}</strong>
            <br />
            {s.name}
            <br />
            {s.address}
            <br />
            {s.city}, {s.country}
            <br />
            {s.email}
            <br />
            {s.iec ? `IEC ${s.iec}` : <span className="muted">IEC: to be provided by seller</span>}
          </p>
        </div>
        <div>
          <h4>Consignee / Buyer</h4>
          <p>
            <strong>{b.name}</strong>
            <br />
            {b.address}
            <br />
            {b.country}
            <br />
            {b.email}
          </p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>HS code</th>
              <th>Origin</th>
              <th className="num">Qty</th>
              <th className="num">Unit</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <td>
                  {l.description}
                  <div className="muted small">{l.materials}</div>
                </td>
                <td className="mono">{l.hsCode}</td>
                <td>{l.origin}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">{usd(l.unitCents)}</td>
                <td className="num">{usd(l.totalCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {inv.dutyTotalCents ? (
              <>
                <tr className="sub">
                  <td colSpan={5}>Goods: declared customs value</td>
                  <td className="num">{usd(inv.goodsTotalCents ?? inv.totalCents - inv.dutyTotalCents)}</td>
                </tr>
                <tr className="sub">
                  <td colSpan={5}>Est. US import duty, prepaid by seller (DDP)</td>
                  <td className="num">{usd(inv.dutyTotalCents)}</td>
                </tr>
              </>
            ) : null}
            <tr>
              <td colSpan={5}>Total paid ({inv.currency}){inv.incoterm ? ` · Incoterm ${inv.incoterm}` : ""}</td>
              <td className="num">{usd(inv.totalCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="inv-foot">
        <p>
          <strong>Payment:</strong> {inv.payment.provider} · PayPal order <span className="mono">{inv.payment.paypalOrderId}</span> ·
          Capture <span className="mono">{inv.payment.captureId}</span>
        </p>
        <p>{inv.terms}</p>
        {inv.dutyBasis && (
          <p className="small">
            <strong>Duty basis:</strong> {inv.dutyBasis} Estimate, not customs advice.
          </p>
        )}
        {inv.declarations.map((d) => (
          <p key={d} className="small muted">
            {d}
          </p>
        ))}
      </div>
    </article>
  );
}
