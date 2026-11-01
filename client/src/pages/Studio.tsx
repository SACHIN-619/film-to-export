import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, resizeImage } from "../api";
import { useConfig } from "../App";
import type { Batch, Item, Seller } from "../types";
import { ItemReviewCard } from "../components/ItemReviewCard";
import { Spinner } from "../components/bits";

export default function Studio() {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [startNew, setStartNew] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Batch | null>("/batches/latest")
      .then((b) => setBatch(b))
      .finally(() => setLoaded(true));
  }, []);

  const onItemChange = (item: Item) =>
    setBatch((b) => (b ? { ...b, items: b.items.map((i) => (i.id === item.id ? item : i)) } : b));
  const onItemRemove = (id: string) => setBatch((b) => (b ? { ...b, items: b.items.filter((i) => i.id !== id) } : b));

  const publish = async () => {
    if (!batch) return;
    setPublishing(true);
    setError(null);
    try {
      setBatch(await api<Batch>(`/batches/${batch.id}/publish`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  const showUpload = !batch || startNew;
  const confirmed = batch?.items.filter((i) => i.status !== "draft").length ?? 0;
  const total = batch?.items.length ?? 0;

  return (
    <div className="page studio">
      <header className="page-head">
        <p className="kicker">Seller studio</p>
        <h1 className="display">From workbench to export listing</h1>
      </header>

      <SellerProfile />

      {!loaded ? (
        <Spinner label="Loading…" />
      ) : showUpload ? (
        <UploadSection
          onDone={(b) => {
            setBatch(b);
            setStartNew(false);
          }}
          onCancel={batch ? () => setStartNew(false) : undefined}
        />
      ) : (
        batch && (
          <>
            <section className="section">
              <div className="section-head">
                <span className="section-no">No. 02</span>
                <h2>Review &amp; confirm</h2>
                <button className="btn link" onClick={() => setStartNew(true)}>
                  Start a new batch
                </button>
              </div>
              <p className="batch-meta">
                {batch.aiMode === "live" ? (
                  <>
                    Drafted by <span className="mono">{batch.model}</span> from {batch.frameCount}{" "}
                    {batch.source === "video" ? "video frames" : "photos"}
                    {batch.repaired && <> · output repaired once after schema validation</>}
                  </>
                ) : (
                  <>
                    <strong>SIMULATION batch.</strong> These are hand-written fixture listings with illustrations, not AI
                    output.
                  </>
                )}
              </p>
              {batch.items.length === 0 && <p className="muted">No items left in this batch.</p>}
              <div className="review-list">
                {batch.items.map((item, n) => (
                  <ItemReviewCard
                    key={item.id}
                    n={n + 1}
                    item={item}
                    locked={batch.status === "published"}
                    onChange={onItemChange}
                    onRemove={onItemRemove}
                  />
                ))}
              </div>
            </section>

            <section className="section publish-bar">
              <span className="section-no">No. 03</span>
              {batch.status === "published" ? (
                <div className="publish-row">
                  <h2>Your storefront is live.</h2>
                  <Link to="/shop" className="btn primary">
                    Open the storefront →
                  </Link>
                </div>
              ) : (
                <div className="publish-row">
                  <div>
                    <h2>Publish storefront</h2>
                    <p className="muted">
                      {confirmed} of {total} confirmed. Every item needs your confirmation of price, quantity, condition
                      and HS code before it goes live.
                    </p>
                  </div>
                  <button className="btn primary" disabled={publishing || total === 0 || confirmed < total} onClick={publish}>
                    {publishing ? "Publishing…" : "Publish storefront"}
                  </button>
                </div>
              )}
              {error && <p className="error">{error}</p>}
            </section>
          </>
        )
      )}
    </div>
  );
}

function UploadSection({ onDone, onCancel }: { onDone: (b: Batch) => void; onCancel?: () => void }) {
  const config = useConfig();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const live = config?.aiMode === "live";

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);

  const accept = (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    setFiles(arr.slice(0, 8));
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) {
        if (f.type.startsWith("image/")) form.append("media", await resizeImage(f), f.name.replace(/\.\w+$/, ".jpg"));
        else form.append("media", f, f.name);
      }
      const res = await fetch("/api/batches", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(body?.error ?? `Upload failed (${res.status})`, res.status, body);
      onDone(body as Batch);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadFixtures = async () => {
    setBusy(true);
    try {
      onDone(await api<Batch>("/batches/fixture", { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hasVideo = files.some((f) => f.type.startsWith("video/"));

  return (
    <section className="section">
      <div className="section-head">
        <span className="section-no">No. 01</span>
        <h2>Film or photograph your pieces</h2>
        {onCancel && (
          <button className="btn link" onClick={onCancel}>
            Back to current batch
          </button>
        )}
      </div>

      {!live && (
        <div className="notice sim">
          <strong>AI is in SIMULATION mode.</strong> No <span className="mono">GEMINI_API_KEY</span> is set, so uploads
          can't be analysed. You can load a labelled fixture batch to try the rest of the flow. Those listings are
          hand-written examples, not AI output.
          <div>
            <button className="btn primary" onClick={loadFixtures} disabled={busy}>
              Load fixture batch (SIMULATION)
            </button>
          </div>
        </div>
      )}

      {live && (
        <>
          <div
            className={`dropzone${drag ? " drag" : ""}${busy ? " busy" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              accept(e.dataTransfer.files);
            }}
            onClick={() => !busy && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept={config?.ffmpeg ? "image/*,video/*" : "image/*"}
              multiple
              hidden
              onChange={(e) => accept(e.target.files)}
            />
            {busy ? (
              <div className="drafting">
                <Spinner />
                <p className="display sm">Gemini is looking at your {hasVideo ? "video" : `${files.length} photos`}…</p>
                <p className="muted">
                  Finding each piece, writing two languages, checking condition, suggesting price and HS code. Usually
                  20–40 seconds. <span className="mono">{elapsed}s</span>
                </p>
              </div>
            ) : files.length ? (
              <div className="thumbs">
                {files.map((f, i) => (
                  <figure key={i}>
                    {f.type.startsWith("image/") ? <img src={URL.createObjectURL(f)} alt="" /> : <div className="video-thumb">▶ video</div>}
                    <figcaption>{f.name}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="drop-copy">
                <p className="display sm">Drop {config?.ffmpeg ? "a short video or " : ""}1–8 photos here</p>
                <p className="muted">
                  {config?.ffmpeg
                    ? "A 10–30 second pan across your table works best."
                    : "Video needs ffmpeg on the server, which isn't installed, so use photos."}{" "}
                  Photos are resized in your browser before upload.
                </p>
              </div>
            )}
          </div>
          <div className="row gap">
            <button className="btn primary" disabled={!files.length || busy} onClick={submit}>
              {busy ? "Drafting…" : "Draft my listings"}
            </button>
            {files.length > 0 && !busy && (
              <button className="btn ghost" onClick={() => setFiles([])}>
                Clear
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function SellerProfile() {
  const [open, setOpen] = useState(false);
  const [seller, setSeller] = useState<Seller | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Seller>("/seller").then(setSeller);
  }, []);
  if (!seller) return null;

  const set = (k: keyof Seller) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSeller({ ...seller, [k]: e.target.value });
    setSaved(false);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setSeller(await api<Seller>("/seller", { method: "PUT", json: seller }));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <details className="profile" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span className="kicker">Exporter on invoices</span> {seller.business_name} · {seller.city}, India
      </summary>
      <form className="grid-form" onSubmit={save}>
        <label>
          Name<input value={seller.name} onChange={set("name")} />
        </label>
        <label>
          Business name<input value={seller.business_name} onChange={set("business_name")} />
        </label>
        <label>
          Address<input value={seller.address} onChange={set("address")} />
        </label>
        <label>
          City, state, PIN<input value={seller.city} onChange={set("city")} />
        </label>
        <label>
          Email<input value={seller.email} onChange={set("email")} type="email" />
        </label>
        <label>
          IEC (Importer-Exporter Code)<input value={seller.iec} onChange={set("iec")} placeholder="optional for the demo" />
        </label>
        <div className="row gap">
          <button className="btn ghost" type="submit">
            Save profile
          </button>
          {saved && <span className="muted">Saved.</span>}
          {error && <span className="error">{error}</span>}
        </div>
      </form>
    </details>
  );
}
