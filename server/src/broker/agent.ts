import { randomBytes } from "node:crypto";
import { z } from "zod";
import { nowIso, type Db } from "../db.js";
import { draftListings } from "../ai/draftListings.js";
import { FIXTURE_ALT_LANG, FIXTURE_DRAFT } from "../ai/fixtures.js";
import type { ImageInput, VisionModel } from "../ai/visionModel.js";
import { dutyBasis, estimateDuty, loadRateTable } from "../domain/duty.js";
import { dollarsToCents } from "../domain/money.js";
import type { AiDraft, AiItem } from "../domain/schemas.js";
import { addFrames, createBatch, failBatch, getBatch, insertDraftItems } from "../services/listings.js";
import { checkRestricted } from "./restricted.js";
import { shorten, type HtsLine, type TariffLookup, type TariffResult } from "./tariff.js";

/**
 * The "customs broker" agent. Orchestration is deterministic code; the model is used
 * at fixed steps (perceive, HTS line refinement). Every step is emitted as an event,
 * streamed to the browser, and recorded so a run can be replayed for demos.
 */

export type StepKind =
  | "run"
  | "perceive"
  | "transcript"
  | "classify"
  | "tariff_lookup"
  | "hts_refine"
  | "duty"
  | "restricted_check"
  | "price"
  | "done"
  | "error";

export interface BrokerEvent {
  /** Stable step id; a later event with the same id updates the step ("running" → "done"). */
  id: string;
  kind: StepKind;
  status: "running" | "done" | "warn" | "error";
  /** Which tool did the work, shown on the step chip. */
  tool?: string;
  item?: number;
  title: string;
  detail?: string;
  data?: Record<string, unknown>;
  ms?: number;
  /** Set on replayed events only. */
  replay?: { runId: string; recordedAt: string };
}

export interface BrokerInput {
  images: (ImageInput & { publicPath: string })[];
  audio: ImageInput | null;
  /** Pre-created batch these images were stored under. */
  batchId: string;
}

export interface BrokerDeps {
  db: Db;
  vision: VisionModel | null;
  tariff: TariffLookup;
  altLanguage: { code: string; name: string };
  log?: (m: string) => void;
}

const RefineSchema = z.object({ htsno: z.string().min(4), reason: z.string().min(3).max(400) });

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export async function runBroker(deps: BrokerDeps, input: BrokerInput, emit: (e: BrokerEvent) => void) {
  const runId = `run_${randomBytes(5).toString("hex")}`;
  const t0 = Date.now();
  const recorded: { t: number; event: BrokerEvent }[] = [];
  const send = (e: BrokerEvent) => {
    recorded.push({ t: Date.now() - t0, event: e });
    emit(e);
  };
  const timed = async <T>(e: Omit<BrokerEvent, "status">, fn: () => Promise<T>, done: (r: T) => Partial<BrokerEvent>) => {
    const s = Date.now();
    send({ ...e, status: "running" });
    try {
      const r = await fn();
      send({ ...e, status: "done", ms: Date.now() - s, ...done(r) });
      return r;
    } catch (err) {
      // Close the step visibly instead of leaving it spinning.
      send({ ...e, status: "error", ms: Date.now() - s, detail: (err as Error).message });
      throw err;
    }
  };
  const mode = deps.vision ? "live" : "fixture";

  try {
    send({
      id: "run",
      kind: "run",
      status: "done",
      title: `Received ${input.images.length} image${input.images.length === 1 ? "" : "s"}${input.audio ? " + a voice note" : ""}`,
      detail: deps.vision ? `Run ${runId}` : `Run ${runId}: SIMULATION (no Gemini key), fixture listings, not AI output`,
      data: { runId, mode },
    });

    // 1. Perceive: one model call over frames (+ audio) → transcript + distinct items.
    let draft: AiDraft;
    let repaired = false;
    if (deps.vision) {
      const vision = deps.vision;
      const perceiveStep = {
        id: "perceive",
        kind: "perceive" as const,
        tool: vision.name,
        title: input.audio ? "Watching the photos and listening to the voice note" : "Looking at the photos",
        detail: "One call: find each distinct piece, condition, materials, price, HS code",
      };
      const out = await timed(
        perceiveStep,
        () =>
          draftListings(vision, input.images, deps.altLanguage.name, input.audio, {
            onRetry: ({ attempt, status, waitMs, model, reason }) =>
              send({
                ...perceiveStep,
                status: "running",
                tool: `gemini:${model}`,
                detail: reason ?? `Model busy${status ? ` (HTTP ${status})` : ""}; retry ${attempt} in ${Math.round(waitMs / 1000)}s…`,
              }),
          }),
        (r) => ({
          tool: vision.lastModelUsed ? `gemini:${vision.lastModelUsed}` : vision.name,
          title: `Found ${r.draft.items.length} piece${r.draft.items.length === 1 ? "" : "s"}`,
          detail: r.repaired ? "Output failed schema once and was repaired" : "Output passed the schema first time",
          status: r.repaired ? "warn" : "done",
        }),
      );
      draft = out.draft;
      repaired = out.repaired;
    } else {
      send({ id: "perceive", kind: "perceive", status: "warn", tool: "fixture", title: "SIMULATION: loaded fixture listings", detail: "No GEMINI_API_KEY: hand-written examples, not AI output" });
      draft = structuredClone(FIXTURE_DRAFT);
    }

    if (draft.transcript) {
      send({
        id: "transcript",
        kind: "transcript",
        status: "done",
        tool: deps.vision?.name,
        title: `Heard the maker (${draft.transcript.language})`,
        detail: draft.transcript.english,
        data: { ...draft.transcript },
      });
    } else if (input.audio && !deps.vision) {
      send({ id: "transcript", kind: "transcript", status: "warn", title: "Voice note not transcribed", detail: "SIMULATION mode has no speech model" });
    }

    // Persist drafts so the seller can confirm them (confirm gate) and get pay links.
    const framePaths = input.images.map((i) => i.publicPath);
    await insertDraftItems(deps.db, input.batchId, draft, {
      origin: deps.vision ? "ai" : "fixture",
      altLang: deps.vision ? deps.altLanguage.code : FIXTURE_ALT_LANG,
      framePaths,
      repaired,
    });
    if (draft.transcript) await deps.db.run("UPDATE batches SET transcript = $1 WHERE id = $2", [JSON.stringify(draft.transcript), input.batchId]);
    const items = (await getBatch(deps.db, input.batchId)).items;
    const table = loadRateTable();

    // 2. Per piece, in parallel: classify → live tariff (whole heading) → refine line → duty → restricted → price.
    // Line refinement for all pieces goes out as ONE model call (free tiers allow few requests per day).
    const refineBatch = new RefineBatch(draft.items.length, (reqs) => refineLines(deps.vision!, reqs));
    const processPiece = async (it: AiItem, i: number) => {
      const itemId = items[i]?.id;
      const label = it.title_en;
      send({
        id: `classify:${i}`,
        kind: "classify",
        item: i,
        status: "done",
        tool: deps.vision?.name ?? "fixture",
        title: `${label}: proposed HS ${it.hs.code}`,
        detail: it.hs.rationale,
        data: { itemId, hs: it.hs.code, confidence: it.confidence.hs_code, description: it.hs.description, sellerSaid: it.seller_said ?? null },
      });

      const heading = it.hs.code.replace(/\D/g, "").slice(0, 4);
      const tr = await timed(
        { id: `tariff:${i}`, kind: "tariff_lookup", item: i, tool: "usitc.hts.search", title: `Reading heading ${heading} of the official US tariff schedule` },
        () => deps.tariff.lookup(it.hs.code, { scope: "heading" }),
        (r) => ({
          status: r.source === "live" ? "done" : "warn",
          title:
            r.source === "live"
              ? `USITC: ${r.lines?.length ?? 1} line(s) under ${heading}; nearest ${r.htsLine} → ${r.mfnPct === 0 ? "Free" : `${r.mfnPct}%`}`
              : r.source === "table"
                ? `Fallback: local table ${r.htsLine} → ${r.mfnPct}%`
                : `No rate found for ${it.hs.code}`,
          detail: r.note,
          data: { source: r.source, mfnPct: r.mfnPct, htsLine: r.htsLine, url: r.url, lines: r.lines?.length ?? 0 },
        }),
      );

      let rate: TariffResult = tr;
      let hsCode = it.hs.code;
      const distinct = new Set((tr.lines ?? []).map((l) => l.pct));
      const needsRefine = tr.source === "live" && !!deps.vision && !!tr.lines && tr.lines.length > 1 && distinct.size > 1;
      if (!needsRefine) refineBatch.skip();
      if (needsRefine && tr.lines) {
        const refined = await timed(
          {
            id: `refine:${i}`,
            kind: "hts_refine",
            item: i,
            tool: deps.vision?.name,
            title: `Matching the material to one of ${tr.lines.length} official lines`,
            detail: `Rates under ${heading} range ${Math.min(...distinct)}–${Math.max(...distinct)}%: the exact line decides the duty`,
          },
          () => refineBatch.need(i, it, tr),
          (r) => {
            const corrected = r.chosen && sixDigits(r.result.htsLine) !== sixDigits(it.hs.code);
            return {
              status: r.chosen ? "done" : "warn",
              title: !r.chosen
                ? `Kept ${tr.htsLine} (model choice not on the official list)`
                : corrected
                  ? `Corrected ${it.hs.code} → ${r.result.htsLine} (${r.result.mfnPct === 0 ? "Free" : `${r.result.mfnPct}%`})`
                  : `Picked ${r.result.htsLine} → ${r.result.mfnPct === 0 ? "Free" : `${r.result.mfnPct}%`}`,
              detail: corrected ? `${r.reason} Official line: ${shorten(r.result.description, 200)}` : r.reason,
              data: { corrected, from: it.hs.code, to: r.result.htsLine },
            };
          },
        );
        rate = refined.result;
        if (refined.chosen && rate.htsLine) hsCode = formatHs(rate.htsLine);
      }

      // The confirmed HS code follows the official line the broker settled on.
      if (itemId && hsCode !== it.hs.code) {
        await deps.db.run(
          "UPDATE items SET hs_code = $1, hs_suggested = $1, hs_description = $2, hs_rationale = $3 WHERE id = $4",
          [hsCode, rate.description ?? it.hs.description, `${it.hs.rationale} Broker check against the official USITC schedule moved ${it.hs.code} → ${hsCode}.`, itemId],
        );
      }

      const priceCents = dollarsToCents(it.price.usd);
      const override = rate.mfnPct !== null && rate.source !== "none" ? { mfnPct: rate.mfnPct, htsLine: rate.htsLine, source: rate.source, description: rate.description } : null;
      const duty = estimateDuty(hsCode, priceCents, "IN", table, override);
      send({
        id: `duty:${i}`,
        kind: "duty",
        item: i,
        status: duty.status === "estimated" ? (duty.surchargeStatus === "uncertain" ? "warn" : "done") : "warn",
        tool: "duty.estimate",
        title: duty.status === "estimated" ? `Estimated US import duty ${duty.totalPct}% → ${usd(duty.unitDutyCents)}` : "No duty estimate (goods-only, DAP)",
        detail: dutyBasis(duty),
      });

      const screen = checkRestricted(it.title_en, it.description_en, it.materials, it.seller_said ?? "");
      send({
        id: `restricted:${i}`,
        kind: "restricted_check",
        item: i,
        status: screen.level === "ok" ? "done" : screen.level === "caution" ? "warn" : "error",
        tool: "restricted.screen",
        title: screen.level === "ok" ? "No restricted materials spotted" : screen.level === "caution" ? `Check before shipping: ${screen.hits.map((h) => h.term).join(", ")}` : `Likely prohibited: ${screen.hits.filter((h) => h.level === "blocked").map((h) => h.term).join(", ")}`,
        detail: [...screen.hits.map((h) => h.reason), screen.disclaimer].join(" "),
        data: { level: screen.level, hits: screen.hits },
      });

      const total = priceCents + duty.unitDutyCents;
      send({
        id: `price:${i}`,
        kind: "price",
        item: i,
        status: "done",
        tool: "pricing",
        title: `US buyer pays ${usd(total)} (${usd(priceCents)} + ${usd(duty.unitDutyCents)} est. duty, DDP)`,
        detail: it.price.rationale,
        data: { itemId, priceCents, dutyCents: duty.unitDutyCents, totalCents: total },
      });

      if (itemId) {
        await deps.db.run(
          "UPDATE items SET mfn_rate_pct = $1, rate_source = $2, hts_line = $3, rate_note = $4, restricted = $5 WHERE id = $6",
          [override?.mfnPct ?? null, override?.source ?? null, override?.htsLine ?? null, rate.note, JSON.stringify(screen), itemId],
        );
      }
    };
    await Promise.all(draft.items.map((it, i) => processPiece(it, i)));

    send({
      id: "done",
      kind: "done",
      status: "done",
      title: "Drafts ready. Review and confirm each piece, then get its PayPal link.",
      detail: `${draft.items.length} piece(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      data: { batchId: input.batchId, runId },
    });
  } catch (err) {
    const msg = (err as Error).message;
    deps.log?.(`broker ${runId} failed: ${msg}`);
    await failBatch(deps.db, input.batchId, msg).catch(() => {});
    send({ id: "error", kind: "error", status: "error", title: "The broker hit a problem", detail: msg, data: { runId } });
  } finally {
    await deps.db
      .run("INSERT INTO broker_runs (id, batch_id, mode, events, created_at) VALUES ($1, $2, $3, $4, $5)", [
        runId,
        input.batchId,
        mode,
        JSON.stringify(recorded),
        nowIso(),
      ])
      .catch((e) => deps.log?.(`could not record run ${runId}: ${(e as Error).message}`));
  }
  return { runId, batchId: input.batchId };
}

const sixDigits = (hs: string | null) => (hs ?? "").replace(/\D/g, "").slice(0, 6);
/** "6214.90.00.10" / "621490" → "6214.90.00" (the HS_CODE format the confirm form accepts). */
export function formatHs(htsno: string): string {
  const d = htsno.replace(/\D/g, "").slice(0, 8);
  return [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean).join(".");
}

type RefineOutcome = { result: TariffResult; chosen: boolean; reason: string };
type RefineRequest = { i: number; it: AiItem; tr: TariffResult };

/**
 * Collects line-refinement requests from pieces processed in parallel and sends them as ONE
 * model call once every piece has either asked (`need`) or opted out (`skip`).
 */
export class RefineBatch {
  private reqs: (RefineRequest & { resolve: (o: RefineOutcome) => void })[] = [];
  private settled = 0;
  private fired = false;

  constructor(
    private readonly total: number,
    private readonly run: (reqs: RefineRequest[]) => Promise<Map<number, RefineOutcome>>,
  ) {}

  need(i: number, it: AiItem, tr: TariffResult): Promise<RefineOutcome> {
    return new Promise((resolve) => {
      this.reqs.push({ i, it, tr, resolve });
      this.flush();
    });
  }

  skip() {
    this.settled++;
    this.flush();
  }

  private flush() {
    if (this.fired || this.reqs.length + this.settled < this.total || this.reqs.length === 0) return;
    this.fired = true;
    const reqs = this.reqs;
    this.run(reqs.map(({ i, it, tr }) => ({ i, it, tr })))
      .then((out) => reqs.forEach((r) => r.resolve(out.get(r.i) ?? { result: r.tr, chosen: false, reason: `No answer for this piece; kept ${r.tr.htsLine}.` })))
      .catch((err) => reqs.forEach((r) => r.resolve({ result: r.tr, chosen: false, reason: `Refinement failed (${(err as Error).message}); kept ${r.tr.htsLine}.` })));
  }
}

/**
 * Models write codes inconsistently ("7419.80.09" vs "7419.80.09.00", "741980"). Accept an exact
 * digit match, else the single official line that starts with the digits given. Anything
 * ambiguous or absent is rejected: we never invent a line.
 */
export function matchLine(lines: HtsLine[], answer: string): HtsLine | undefined {
  const d = answer.replace(/\D/g, "");
  if (d.length < 6) return undefined;
  const exact = lines.find((l) => l.htsno.replace(/\D/g, "") === d);
  if (exact) return exact;
  const prefixed = lines.filter((l) => l.htsno.replace(/\D/g, "").startsWith(d));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

const BatchRefineSchema = z.object({
  choices: z.array(RefineSchema.extend({ piece: z.number().int().min(1) })).min(1),
});

/** Ask the model to pick the exact line for each piece; only lines from that piece's official list are accepted. */
export async function refineLines(vision: VisionModel, reqs: RefineRequest[]): Promise<Map<number, RefineOutcome>> {
  const blocks = reqs.map(({ it, tr }, n) => {
    const lines = tr.lines as HtsLine[];
    return `### Piece ${n + 1}
First guess: ${it.hs.code} (may be the wrong subheading)
Product: ${it.title_en}
Materials: ${it.materials}
Description: ${it.description_en}${it.seller_said ? `\nMaker said: ${it.seller_said}` : ""}
Official USITC lines (choose ONE htsno from THIS list):
${lines.map((l) => `- ${l.htsno}: ${l.description} (General ${l.pct}%)`).join("\n")}`;
  });
  const prompt = `You classify handmade products into exact US HTS lines.
The material decides the line (e.g. cotton is NOT "wool or fine animal hair", "synthetic" or "artificial" fibers; brass is a copper alloy; a lamp is not an illuminated sign). Never invent codes.

${blocks.join("\n\n")}

Return ONLY JSON: {"choices": [{"piece": <number>, "htsno": "<an htsno from that piece's list>", "reason": "<one sentence naming the material and why this line fits>"}]}`;

  const raw = await vision.generateJson(prompt, []);
  const parsed = BatchRefineSchema.safeParse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "")));
  const out = new Map<number, RefineOutcome>();
  reqs.forEach(({ i, tr }, n) => {
    const choice = parsed.success ? parsed.data.choices.find((c) => c.piece === n + 1) : undefined;
    const line = choice ? matchLine(tr.lines as HtsLine[], choice.htsno) : undefined;
    out.set(
      i,
      choice && line
        ? {
            result: { ...tr, mfnPct: line.pct, htsLine: line.htsno, description: line.description, note: `USITC HTS: ${line.htsno} "${shorten(line.description)}" General ${line.pct === 0 ? "Free" : `${line.pct}%`}. Line chosen by AI from the official list: ${choice.reason}` },
            chosen: true,
            reason: choice.reason,
          }
        : { result: tr, chosen: false, reason: `Model answer not on the official list; kept ${tr.htsLine}.` },
    );
  });
  return out;
}

/** Re-stream a recorded run with its original pacing (capped), every event labelled as a replay. */
export async function replayRun(db: Db, runId: string | null, emit: (e: BrokerEvent) => void, opts: { maxGapMs?: number } = {}) {
  const row = runId
    ? await db.get<{ id: string; events: string; created_at: string }>("SELECT id, events, created_at FROM broker_runs WHERE id = $1", [runId])
    : await db.get<{ id: string; events: string; created_at: string }>(
        "SELECT id, events, created_at FROM broker_runs WHERE events LIKE '%\"kind\":\"done\"%' ORDER BY created_at DESC LIMIT 1",
      );
  if (!row) return false;
  const recorded = JSON.parse(row.events) as { t: number; event: BrokerEvent }[];
  const replay = { runId: row.id, recordedAt: row.created_at };
  let last = 0;
  for (const r of recorded) {
    const gap = Math.min(r.t - last, opts.maxGapMs ?? 1800);
    last = r.t;
    if (gap > 0) await new Promise((res) => setTimeout(res, gap));
    emit({ ...r.event, replay });
  }
  return true;
}

export async function prepareBatch(db: Db, model: string | null, live: boolean) {
  return createBatch(db, { source: "photos", aiMode: live ? "live" : "simulation", model });
}

export { addFrames };
