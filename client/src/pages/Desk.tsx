import { useEffect, useRef, useState } from "react";
import { api, resizeImage, usd } from "../api";
import { useConfig } from "../App";
import { streamBroker, toSpeechWav, videoToFrames } from "../broker";
import type { Batch, BrokerEvent, Item } from "../types";
import { ItemReviewCard } from "../components/ItemReviewCard";
import { PayLinkPanel } from "../components/PayLinkPanel";
import { FixtureTag, Spinner, StatusPill } from "../components/bits";

const KIND_ICON: Record<BrokerEvent["kind"], string> = {
  run: "◎",
  perceive: "◉",
  transcript: "❝",
  classify: "§",
  tariff_lookup: "⚖",
  hts_refine: "⌖",
  duty: "%",
  restricted_check: "⛨",
  price: "$",
  done: "✓",
  error: "!",
};

export default function Desk() {
  const config = useConfig();
  const [events, setEvents] = useState<BrokerEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);

  const onEvent = (e: BrokerEvent) =>
    setEvents((list) => {
      const i = list.findIndex((x) => x.id === e.id);
      if (i < 0) return [...list, e];
      const next = list.slice();
      next[i] = e;
      return next;
    });

  useEffect(() => {
    const done = events.find((e) => e.kind === "done");
    const batchId = done?.data?.batchId as string | undefined;
    if (batchId && batch?.id !== batchId) api<Batch>(`/batches/${batchId}`).then(setBatch).catch(() => {});
  }, [events, batch?.id]);

  const start = async (url: string, init: RequestInit) => {
    setEvents([]);
    setBatch(null);
    setError(null);
    setRunning(true);
    try {
      await streamBroker(url, init, onEvent);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const replay = events.find((e) => e.replay)?.replay;
  const live = config?.aiMode === "live";

  return (
    <div className="page desk">
      <header className="desk-head">
        <p className="kicker">Broker desk · India → United States</p>
        <h1 className="display">Your customs broker, in your pocket.</h1>
        <p className="lede">
          Show it your pieces and say a few words in Hindi or English. It checks the official US tariff schedule, prices each
          piece duties-included, flags restricted materials, and gives you a PayPal link to send in any chat.
        </p>
      </header>

      <div className="desk-grid">
        <Intake disabled={running} live={live} onRun={(form) => start("/api/broker/run", { method: "POST", body: form })} onReplay={() => start("/api/broker/replay", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })} />

        <section className="agent-panel" aria-live="polite">
          <div className="agent-head">
            <h2>Broker at work</h2>
            {running && <Spinner />}
          </div>
          {replay && (
            <div className="replay-banner">
              REPLAY of recorded run <span className="mono">{replay.runId}</span> from {new Date(replay.recordedAt).toLocaleString()}. Not a live run.
            </div>
          )}
          {events.length === 0 && !running && <p className="muted agent-empty">Steps appear here as the broker works: each tool it calls, what it found, and the source.</p>}
          <Timeline events={events} />
          {error && <p className="error">{error}</p>}
        </section>
      </div>

      {batch?.transcript && (
        <section className="transcript">
          <p className="kicker">What the maker said · {batch.transcript.language}</p>
          <blockquote lang={batch.transcript.language.toLowerCase().startsWith("hindi") ? "hi" : undefined}>{batch.transcript.original}</blockquote>
          <p className="transcript-en">“{batch.transcript.english}”</p>
        </section>
      )}

      {batch && <Pieces batch={batch} onChange={setBatch} />}
    </div>
  );
}

function Intake({ disabled, live, onRun, onReplay }: { disabled: boolean; live: boolean; onRun: (f: FormData) => void; onReplay: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [voice, setVoice] = useState<Blob | null>(null);
  const [voiceLabel, setVoiceLabel] = useState<string | null>(null);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [prep, setPrep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const video = files.find((f) => f.type.startsWith("video/"));

  const pick = (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const vid = arr.find((f) => f.type.startsWith("video/"));
    setFiles(vid ? [vid] : arr.slice(0, 8));
    setError(null);
  };

  const record = async () => {
    if (recording) {
      recording.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        const blob = new Blob(chunks, { type: rec.mimeType });
        setVoice(blob);
        setVoiceLabel(`Recorded voice note (${Math.round(blob.size / 1024)} KB)`);
      };
      rec.start();
      setRecording(rec);
    } catch {
      setError("Microphone not available. You can upload a voice note file instead.");
    }
  };

  const run = async () => {
    setError(null);
    try {
      const form = new FormData();
      if (video) {
        setPrep("Taking frames from the video…");
        const frames = await videoToFrames(video);
        frames.forEach((b, i) => form.append("media", b, `frame_${i}.jpg`));
      } else {
        setPrep("Resizing photos…");
        for (const f of files) form.append("media", await resizeImage(f), f.name.replace(/\.\w+$/, ".jpg"));
      }
      // Voice: a recorded/uploaded note wins; otherwise use the video's own soundtrack.
      const audioSource = voice ?? video ?? null;
      if (audioSource) {
        setPrep("Preparing audio…");
        const wav = await toSpeechWav(audioSource);
        if (wav) form.append("voice", wav, "voice.wav");
      }
      setPrep(null);
      onRun(form);
    } catch (e) {
      setPrep(null);
      setError((e as Error).message);
    }
  };

  return (
    <section className="intake">
      <div
        className={`dropzone small${disabled ? " busy" : ""}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pick(e.target.files)} />
        {files.length ? (
          <div className="thumbs">
            {files.map((f, i) => (
              <figure key={i}>
                {f.type.startsWith("image/") ? <img src={URL.createObjectURL(f)} alt="" /> : <div className="video-thumb">▶ {f.name}</div>}
              </figure>
            ))}
          </div>
        ) : (
          <div className="drop-copy">
            <p className="display sm">Drop a short video or 1–8 photos</p>
            <p className="muted">A 10–30 second pan across your table works best.</p>
          </div>
        )}
      </div>

      <div className="voice-row">
        <button className={`btn ${recording ? "primary rec" : "ghost"}`} onClick={record} disabled={disabled} type="button">
          {recording ? "■ Stop recording" : "● Record a voice note"}
        </button>
        <button className="btn link" type="button" onClick={() => audioRef.current?.click()} disabled={disabled}>
          or upload one
        </button>
        <input
          ref={audioRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setVoice(f);
              setVoiceLabel(f.name);
            }
          }}
        />
      </div>
      <p className="small muted">
        {voiceLabel ? `🎙 ${voiceLabel}` : video ? "The video's own sound will be used as the voice note." : "Optional: describe the pieces in Hindi or English (material, technique, price)."}
        {voice && (
          <button className="btn link small" type="button" onClick={() => { setVoice(null); setVoiceLabel(null); }}>
            remove
          </button>
        )}
      </p>

      <div className="row gap">
        <button className="btn primary" onClick={run} disabled={disabled || !files.length || !!recording}>
          {prep ?? (disabled ? "Broker working…" : "Run the broker")}
        </button>
        <button className="btn ghost" onClick={onReplay} disabled={disabled} title="Re-streams the last recorded run, clearly labelled as a replay">
          Replay last run
        </button>
      </div>
      {!live && <p className="notice sim small">SIMULATION: no Gemini key, so the broker uses labelled fixture listings, not AI output. Tariff lookups are still live.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Timeline({ events }: { events: BrokerEvent[] }) {
  const top = events.filter((e) => e.item === undefined && e.kind !== "done" && e.kind !== "error");
  const tail = events.filter((e) => e.kind === "done" || e.kind === "error");
  const itemIdx = [...new Set(events.filter((e) => e.item !== undefined).map((e) => e.item as number))];
  return (
    <ol className="timeline-steps">
      {top.map((e) => (
        <Step key={e.id} e={e} />
      ))}
      {itemIdx.map((i) => {
        const steps = events.filter((e) => e.item === i);
        const name = (steps.find((e) => e.kind === "classify")?.title ?? `Piece ${i + 1}`).split(": proposed")[0];
        return (
          <li key={`item-${i}`} className="step-group">
            <div className="step-group-title">
              <span className="plate">Pc. {String(i + 1).padStart(2, "0")}</span> {name}
            </div>
            <ol>
              {steps.map((e) => (
                <Step key={e.id} e={e} />
              ))}
            </ol>
          </li>
        );
      })}
      {tail.map((e) => (
        <Step key={e.id} e={e} />
      ))}
    </ol>
  );
}

function Step({ e }: { e: BrokerEvent }) {
  const url = typeof e.data?.url === "string" ? e.data.url : null;
  const source = e.kind === "tariff_lookup" && e.status !== "running" ? (e.data?.source as string | undefined) : undefined;
  return (
    <li className={`step step-${e.status}`}>
      <span className="step-icon" aria-hidden>
        {e.status === "running" ? <span className="spinner-dot" /> : KIND_ICON[e.kind]}
      </span>
      <div className="step-body">
        <div className="step-title">
          {e.title}
          {source && <span className={`src src-${source}`}>{source === "live" ? "LIVE · USITC" : source === "table" ? "FALLBACK · cited table" : "NO RATE"}</span>}
        </div>
        {e.detail && <div className="step-detail">{e.detail}</div>}
        <div className="step-meta">
          {e.tool && <span className="mono">{e.tool}</span>}
          {e.ms !== undefined && <span className="mono">{e.ms} ms</span>}
          {url && (
            <a href={url} target="_blank" rel="noreferrer">
              source
            </a>
          )}
          {e.replay && <span className="tag tag-sim">replay</span>}
        </div>
      </div>
    </li>
  );
}

function Pieces({ batch, onChange }: { batch: Batch; onChange: (b: Batch) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const update = (item: Item) => onChange({ ...batch, items: batch.items.map((i) => (i.id === item.id ? item : i)) });
  const remove = (id: string) => onChange({ ...batch, items: batch.items.filter((i) => i.id !== id) });
  return (
    <section className="section pieces">
      <div className="section-head">
        <span className="section-no">Result</span>
        <h2>Confirm, then send a PayPal link</h2>
      </div>
      <div className="piece-list">
        {batch.items.map((it, n) => {
          const d = it.duty;
          const dutyCents = d.unitDutyCents;
          return (
            <article key={it.id} className={`piece${it.status !== "draft" ? " is-confirmed" : ""}`}>
              <div className="piece-main">
                {it.imageUrl && <img src={it.imageUrl} alt="" />}
                <div className="piece-info">
                  <div className="piece-top">
                    <span className="plate">Pc. {String(n + 1).padStart(2, "0")}</span>
                    <StatusPill status={it.status} />
                    {it.origin === "fixture" && <FixtureTag />}
                    {it.restricted && it.restricted.level !== "ok" && (
                      <span className={`tag ${it.restricted.level === "blocked" ? "tag-block" : "tag-sim"}`} title={it.restricted.hits.map((h) => h.reason).join(" ")}>
                        {it.restricted.level === "blocked" ? "Likely prohibited" : "Check"}: {it.restricted.hits.map((h) => h.term).join(", ")}
                      </span>
                    )}
                  </div>
                  <h3>{it.titleEn}</h3>
                  <p className="small muted">
                    HS {it.hsCode}
                    {d.status === "estimated" && (
                      <>
                        {" "}→ HTS {d.htsLine} · {d.mfnPct === 0 ? "Free" : `${d.mfnPct}%`} {d.rateSource === "live" ? "(live USITC)" : "(cited table)"} + {d.surchargePct}% India (uncertain)
                      </>
                    )}
                  </p>
                  <p className="piece-price">
                    US buyer pays <strong>{usd(it.priceCents + dutyCents)}</strong>{" "}
                    <span className="muted small">
                      = {usd(it.priceCents)} + {usd(dutyCents)} est. duty{d.status === "estimated" ? " (DDP)" : ", no estimate (DAP)"}
                    </span>
                  </p>
                </div>
              </div>
              <div className="piece-actions">
                <button className="btn ghost" onClick={() => setOpen(open === it.id ? null : it.id)}>
                  {open === it.id ? "Close" : it.status === "draft" ? "Review & confirm" : "View details"}
                </button>
                <PayLinkPanel item={it} onPublished={update} />
              </div>
              {open === it.id && (
                <div className="piece-review">
                  <ItemReviewCard n={n + 1} item={it} locked={it.status === "published" || it.status === "sold_out"} onChange={update} onRemove={remove} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
