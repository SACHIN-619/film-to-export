import { useEffect, useState } from "react";
import { api, usd } from "../api";
import type { Item } from "../types";

interface Share {
  url: string;
  text: string;
  qrSvg: string;
  totalCents: number;
  localhost: boolean;
}

/** "Get pay link": publish one confirmed piece, then copy / WhatsApp / QR. */
export function PayLinkPanel({ item, onPublished }: { item: Item; onPublished: (i: Item) => void }) {
  const [share, setShare] = useState<Share | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const live = item.status === "published" || item.status === "sold_out";

  useEffect(() => {
    if (live && !share) api<Share>(`/items/${item.id}/share`).then(setShare).catch((e) => setError((e as Error).message));
  }, [live, item.id, share]);

  const getLink = async () => {
    setBusy(true);
    setError(null);
    try {
      onPublished(await api<Item>(`/items/${item.id}/publish`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: string, label: string) => {
    try {
      await navigator.clipboard.writeText(what);
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Copy failed; select the text and copy it manually.");
    }
  };

  if (item.status === "draft") {
    return (
      <button className="btn primary" disabled title="Confirm price, quantity, condition and HS code first">
        Get PayPal link
      </button>
    );
  }
  if (!live) {
    return (
      <>
        <button className="btn primary" onClick={getLink} disabled={busy}>
          {busy ? "Creating…" : "Get PayPal link"}
        </button>
        {error && <p className="error small">{error}</p>}
      </>
    );
  }
  if (!share) return error ? <p className="error small">{error}</p> : <span className="muted small">Preparing link…</span>;

  return (
    <div className="paylink">
      <div className="paylink-qr" dangerouslySetInnerHTML={{ __html: share.qrSvg }} aria-label="QR code for the PayPal pay link" />
      <div className="paylink-body">
        <p className="small">
          <strong>{item.status === "sold_out" ? "Sold." : `Buyer pays ${usd(share.totalCents)} with PayPal`}</strong>{" "}
          <a href={share.url} target="_blank" rel="noreferrer" className="mono">
            {share.url.replace(/^https?:\/\//, "")}
          </a>
        </p>
        <textarea className="share-text" readOnly value={share.text} rows={3} onFocus={(e) => e.currentTarget.select()} />
        <div className="row gap">
          <button className="btn primary" onClick={() => copy(share.text, "message")}>
            {copied === "message" ? "Copied ✓" : "Copy message"}
          </button>
          <a className="btn ghost" href={`https://wa.me/?text=${encodeURIComponent(share.text)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <button className="btn ghost" onClick={() => copy(share.url, "link")}>
            {copied === "link" ? "Copied ✓" : "Copy link only"}
          </button>
        </div>
        {share.localhost && (
          <p className="small muted">
            This link points at localhost, so it only opens on this computer. Set APP_PUBLIC_URL to a deployed address to share it for real.
          </p>
        )}
        {error && <p className="error small">{error}</p>}
      </div>
    </div>
  );
}
