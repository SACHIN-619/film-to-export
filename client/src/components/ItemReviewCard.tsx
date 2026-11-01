import { useState } from "react";
import { api, GRADE_LABEL, usd } from "../api";
import type { Item } from "../types";
import { ConfidenceChip, FixtureTag, StatusPill } from "./bits";

interface Props {
  n: number;
  item: Item;
  locked: boolean;
  onChange: (item: Item) => void;
  onRemove: (id: string) => void;
}

/**
 * What a US buyer will pay for one unit, and why (HS → rate → source). The rate comes from
 * the server's estimate for the saved HS code; checkout recomputes it on the server.
 */
function BuyerDuty({ item, priceUsd, hsEdited }: { item: Item; priceUsd: number; hsEdited: boolean }) {
  const d = item.duty;
  if (hsEdited) return <p className="duty-why">Save to recalculate the US import duty for the new HS code.</p>;
  if (d.status !== "estimated") {
    return (
      <p className="duty-why">
        <strong>No duty estimate:</strong> {d.reason} Checkout will be goods-only (DAP).
      </p>
    );
  }
  const cents = Math.round(priceUsd * 100);
  const duty = Number.isFinite(cents) ? Math.round((cents * d.totalPct) / 100) : 0;
  return (
    <div className="duty-why">
      <strong>US buyer pays:</strong> {usd(cents)} + {usd(duty)} est. import duty = {usd(cents + duty)} (DDP)
      <div>Why: {d.basis}</div>
      {(!d.mfnVerified || d.surchargeStatus === "uncertain") && (
        <div>⚠ Part of this rate is unverified or uncertain; check hts.usitc.gov before shipping.</div>
      )}
      <div>
        Sources:{" "}
        {d.sources.map((s, i) => (
          <span key={s}>
            {i > 0 && " · "}
            <a href={s} target="_blank" rel="noreferrer">{new URL(s).hostname}</a>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ItemReviewCard({ n, item, locked, onChange, onRemove }: Props) {
  const [f, setF] = useState({
    title_en: item.titleEn,
    description_en: item.descriptionEn,
    title_alt: item.titleAlt,
    description_alt: item.descriptionAlt,
    materials: item.materials,
    dimensions: item.dimensions ?? "",
    condition_grade: item.conditionGrade,
    condition_notes: item.conditionNotes,
    price_usd: String(item.priceUsd),
    quantity: String(item.quantity),
    hs_code: item.hsCode,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = item.status !== "draft";
  const readOnly = confirmed || locked || busy;
  const c = item.confidence;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  const save = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Item>(`/items/${item.id}`, {
        method: "PUT",
        json: {
          ...f,
          dimensions: f.dimensions || null,
          price_usd: Number(f.price_usd),
          quantity: Number(f.quantity),
          confirm,
        },
      });
      onChange(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Remove this draft? Use this when the AI split one piece into two or picked up something that isn't for sale.")) return;
    await api(`/items/${item.id}`, { method: "DELETE" });
    onRemove(item.id);
  };

  const priceChanged = Number(f.price_usd) !== item.suggestedPriceUsd;
  const hsChanged = f.hs_code.trim() !== item.hsSuggested;

  return (
    <article className={`review-card${confirmed ? " is-confirmed" : ""}`}>
      <div className="review-media">
        <span className="plate-no">Pl. {String(n).padStart(2, "0")}</span>
        {item.imageUrl && <img src={item.imageUrl} alt={item.titleEn} />}
        <div className="review-status">
          <StatusPill status={item.status} />
          {item.origin === "fixture" && <FixtureTag />}
        </div>
      </div>

      <div className="review-body">
        <div className="field-group">
          <div className="field-head">
            <h3>Listing</h3>
            <ConfidenceChip level={c.title} label="title" />
          </div>
          <label className="lang">
            <span>EN</span>
            <input className="title-input" value={f.title_en} onChange={set("title_en")} disabled={readOnly} />
          </label>
          <textarea rows={3} value={f.description_en} onChange={set("description_en")} disabled={readOnly} />
          <label className="lang">
            <span>{item.altLang.toUpperCase()}</span>
            <input value={f.title_alt} onChange={set("title_alt")} disabled={readOnly} />
          </label>
          <textarea rows={3} value={f.description_alt} onChange={set("description_alt")} disabled={readOnly} />
        </div>

        <div className="field-cols">
          <div className="field-group">
            <div className="field-head">
              <h3>Materials</h3>
              <ConfidenceChip level={c.materials} />
            </div>
            <input value={f.materials} onChange={set("materials")} disabled={readOnly} />
            <input value={f.dimensions} onChange={set("dimensions")} disabled={readOnly} placeholder="Dimensions (optional)" />
          </div>

          <div className="field-group">
            <div className="field-head">
              <h3>Condition</h3>
              <ConfidenceChip level={c.condition} />
            </div>
            <select value={f.condition_grade} onChange={set("condition_grade")} disabled={readOnly}>
              {Object.entries(GRADE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <textarea rows={2} value={f.condition_notes} onChange={set("condition_notes")} disabled={readOnly} />
            {item.defects.length > 0 && (
              <ul className="defects">
                {item.defects.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="field-cols">
          <div className="field-group">
            <div className="field-head">
              <h3>Price (USD)</h3>
              <ConfidenceChip level={c.price} />
            </div>
            <div className="row gap">
              <label className="prefix">
                <span>$</span>
                <input type="number" min={1} step="0.01" value={f.price_usd} onChange={set("price_usd")} disabled={readOnly} />
              </label>
              <label className="prefix">
                <span>Qty</span>
                <input type="number" min={1} max={99} value={f.quantity} onChange={set("quantity")} disabled={readOnly} />
              </label>
            </div>
            <p className="hint">
              Suggested ${item.suggestedPriceUsd.toFixed(2)}{priceChanged && " · you changed it"}. {item.priceRationale}
            </p>
          </div>

          <div className="field-group hs">
            <div className="field-head">
              <h3>HS code</h3>
              <ConfidenceChip level={c.hs_code} />
            </div>
            <input className="mono" value={f.hs_code} onChange={set("hs_code")} disabled={readOnly} />
            <p className="hint">
              <strong>Suggested {item.hsSuggested}</strong>: {item.hsDescription}
              {hsChanged && " · you changed it"}
            </p>
            <p className="hint">{item.hsRationale}</p>
            <p className="disclaimer">A suggestion, not customs advice. You confirm the code that goes on the invoice.</p>
            <BuyerDuty item={item} priceUsd={Number(f.price_usd)} hsEdited={f.hs_code.trim() !== item.hsCode} />
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        {!locked && (
          <div className="review-actions">
            {confirmed ? (
              <button className="btn ghost" onClick={() => save(false)} disabled={busy}>
                Edit again
              </button>
            ) : (
              <>
                <button className="btn primary" onClick={() => save(true)} disabled={busy}>
                  {busy ? "Saving…" : "Confirm price, qty, condition & HS code"}
                </button>
                <button className="btn link danger" onClick={remove} disabled={busy}>
                  Remove draft
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
