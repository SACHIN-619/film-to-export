import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, GRADE_LABEL, usd } from "../api";
import type { Item } from "../types";
import { FixtureTag, Spinner } from "../components/bits";
import { Checkout } from "../components/Checkout";

/** Buyer-facing total: item + estimated US import duty, before they pay. Numbers come from the server. */
function DutyPrice({ item }: { item: Item }) {
  const d = item.duty;
  if (d.status !== "estimated") {
    return (
      <div className="duty-price">
        <p className="price">{usd(item.priceCents)} <span className="muted small">USD · before shipping</span></p>
        <p className="small muted">Import duty isn't estimated for this piece; your carrier may bill duty on delivery.</p>
      </div>
    );
  }
  return (
    <div className="duty-price">
      <p className="price">
        {usd(item.priceCents + d.unitDutyCents)} <span className="muted small">USD · duties included · before shipping</span>
      </p>
      <dl className="duty-lines">
        <div><dt>Piece</dt><dd>{usd(item.priceCents)}</dd></div>
        <div>
          <dt>Est. US import duty ({d.totalPct}%)</dt>
          <dd>{usd(d.unitDutyCents)}</dd>
        </div>
      </dl>
      <p className="duty-note">
        <strong>No surprise bill at your door.</strong> Since Aug 29, 2025 every parcel into the US owes duty. You pay it
        here, and the seller ships Delivered Duty Paid (DDP). Estimate, not customs advice.
      </p>
    </div>
  );
}

/** `variant="pay"` is the page behind a shared pay link: no shop navigation, checkout first. */
export default function Product({ variant = "shop" }: { variant?: "shop" | "pay" }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"en" | "alt">("en");

  useEffect(() => {
    api<Item>(`/shop/${id}`).then(setItem).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="page narrow"><p className="error">{error}</p></div>;
  if (!item) return <div className="page"><Spinner label="Loading…" /></div>;

  const title = lang === "en" ? item.titleEn : item.titleAlt;
  const description = lang === "en" ? item.descriptionEn : item.descriptionAlt;

  return (
    <div className={`page product${variant === "pay" ? " pay" : ""}`}>
      {variant === "pay" ? (
        <p className="kicker">Secure checkout · handmade in India · paid with PayPal · duties included</p>
      ) : (
        <Link to="/shop" className="back">← All pieces</Link>
      )}
      <div className="product-grid">
        <figure className="product-img">
          {item.imageUrl && <img src={item.imageUrl} alt={item.titleEn} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
          {item.origin === "fixture" && <figcaption><FixtureTag /> Illustration</figcaption>}
        </figure>

        <div className="product-info">
          <div className="lang-toggle" role="tablist">
            <button role="tab" aria-selected={lang === "en"} onClick={() => setLang("en")}>EN</button>
            <button role="tab" aria-selected={lang === "alt"} onClick={() => setLang("alt")}>{item.altLang.toUpperCase()}</button>
          </div>
          <h1 className="display">{title}</h1>
          <DutyPrice item={item} />
          <p className="description">{description}</p>

          <dl className="specs">
            <div><dt>Materials</dt><dd>{item.materials}</dd></div>
            {item.dimensions && <div><dt>Size</dt><dd>{item.dimensions}</dd></div>}
            <div><dt>Made in</dt><dd>India</dd></div>
            <div><dt>Condition</dt><dd>{GRADE_LABEL[item.conditionGrade]}</dd></div>
          </dl>

          <div className="honest">
            <h3>Honest notes</h3>
            <p>{item.conditionNotes}</p>
            {item.defects.length > 0 && (
              <ul>{item.defects.map((d) => <li key={d}>{d}</li>)}</ul>
            )}
          </div>

          {item.status === "sold_out" || item.quantity < 1 ? (
            <p className="sold-note">This piece has found its home.</p>
          ) : (
            <Checkout item={item} onPaid={(orderId) => navigate(`/orders/${orderId}`)} />
          )}
          <p className="small muted">
            Ships with a commercial invoice listing HS code {item.hsCode}, country of origin India
            {item.duty.status === "estimated" ? ", and the import duty you prepaid (DDP)." : "."}
          </p>
        </div>
      </div>
    </div>
  );
}
