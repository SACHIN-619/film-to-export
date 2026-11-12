import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, GRADE_LABEL, usd } from "../api";
import type { Item } from "../types";
import { FixtureTag, Spinner } from "../components/bits";

interface ShopData {
  seller: { name: string; business_name: string; city: string; country: string };
  items: Item[];
}

export default function Shop() {
  const [data, setData] = useState<ShopData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ShopData>("/shop").then(setData).catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page"><Spinner label="Loading the shop…" /></div>;

  return (
    <div className="page shop">
      <header className="shop-head">
        <p className="kicker">Made by hand in {data.seller.city.split(",")[0]}, India · Ships worldwide</p>
        <h1 className="display xl">{data.seller.business_name}</h1>
        <p className="lede">
          One-of-a-kind pieces by {data.seller.name}. Each listing comes with honest condition notes, and every order
          ships with a commercial invoice.
        </p>
      </header>

      {data.items.length === 0 ? (
        <div className="empty">
          <p className="display sm">Nothing on the shelf yet.</p>
          <p className="muted">
            Publish a batch from the <Link to="/studio">studio</Link> first.
          </p>
        </div>
      ) : (
        <div className="catalogue">
          {data.items.map((it, i) => (
            <Link to={`/shop/${it.id}`} key={it.id} className={`cat-card${it.status === "sold_out" ? " sold" : ""}`}>
              <div className="cat-img">
                {it.imageUrl && <img src={it.imageUrl} alt={it.titleEn} loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                {it.status === "sold_out" && <span className="sold-stamp">Sold</span>}
              </div>
              <div className="cat-meta">
                <span className="cat-no">{String(i + 1).padStart(2, "0")}</span>
                <h2>{it.titleEn}</h2>
                <div className="cat-line">
                  <span>{usd(it.priceCents)}</span>
                  <span className="muted">{GRADE_LABEL[it.conditionGrade]}</span>
                </div>
                {it.origin === "fixture" && <FixtureTag />}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
