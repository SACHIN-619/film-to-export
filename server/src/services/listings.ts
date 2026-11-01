import { randomBytes } from "node:crypto";
import { nowIso, type Db } from "../db.js";
import { dollarsToCents } from "../domain/money.js";
import type { AiDraft } from "../domain/schemas.js";
import type { ConfirmItemSchema } from "../domain/schemas.js";
import type { z } from "zod";
import { conflict, notFound } from "./errors.js";
import { dutyBasis, estimateDuty, type RateOverride } from "../domain/duty.js";

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("base64url")}`;

export type ItemStatus = "draft" | "confirmed" | "published" | "sold_out";

export interface ItemRow {
  id: string;
  batch_id: string;
  status: ItemStatus;
  origin: "ai" | "fixture";
  title_en: string;
  description_en: string;
  alt_lang: string;
  title_alt: string;
  description_alt: string;
  materials: string;
  dimensions: string | null;
  condition_grade: string;
  condition_notes: string;
  defects: string;
  suggested_price_cents: number;
  price_rationale: string;
  price_cents: number;
  quantity: number;
  hs_suggested: string;
  hs_description: string;
  hs_rationale: string;
  hs_code: string;
  confidence: string;
  image_path: string | null;
  country_of_origin: string;
  sort_order: number;
  confirmed_at: string | null;
  created_at: string;
  mfn_rate_pct?: number | null;
  rate_source?: "live" | "table" | null;
  hts_line?: string | null;
  rate_note?: string | null;
  restricted?: string | null;
}

/** The rate the broker resolved for this item (live USITC or table), if any. */
export function rateOverride(row: ItemRow): RateOverride | null {
  if (row.mfn_rate_pct === null || row.mfn_rate_pct === undefined || !row.rate_source) return null;
  return { mfnPct: Number(row.mfn_rate_pct), htsLine: row.hts_line ?? null, source: row.rate_source };
}

interface BatchRow {
  id: string;
  source: string;
  ai_mode: string;
  model: string | null;
  status: string;
  frame_count: number;
  repaired: boolean;
  error: string | null;
  created_at: string;
  transcript?: string | null;
}

export function toItemDto(row: ItemRow) {
  return {
    id: row.id,
    batchId: row.batch_id,
    status: row.status,
    origin: row.origin,
    titleEn: row.title_en,
    descriptionEn: row.description_en,
    altLang: row.alt_lang,
    titleAlt: row.title_alt,
    descriptionAlt: row.description_alt,
    materials: row.materials,
    dimensions: row.dimensions,
    conditionGrade: row.condition_grade,
    conditionNotes: row.condition_notes,
    defects: JSON.parse(row.defects) as string[],
    suggestedPriceUsd: row.suggested_price_cents / 100,
    priceRationale: row.price_rationale,
    priceUsd: row.price_cents / 100,
    priceCents: row.price_cents,
    quantity: row.quantity,
    hsSuggested: row.hs_suggested,
    hsDescription: row.hs_description,
    hsRationale: row.hs_rationale,
    hsCode: row.hs_code,
    confidence: JSON.parse(row.confidence) as Record<string, "high" | "medium" | "low">,
    imageUrl: row.image_path,
    countryOfOrigin: row.country_of_origin,
    confirmedAt: row.confirmed_at,
    // What a US buyer will be charged as estimated import duty for one unit, and why.
    duty: (() => {
      const e = estimateDuty(row.hs_code, row.price_cents, row.country_of_origin, undefined, rateOverride(row));
      return { ...e, basis: dutyBasis(e) };
    })(),
    rateNote: row.rate_note ?? null,
    restricted: row.restricted ? (JSON.parse(row.restricted) as { level: string; hits: { term: string; level: string; reason: string }[]; disclaimer: string }) : null,
  };
}

export async function createBatch(
  db: Db,
  b: { source: "video" | "photos" | "fixture"; aiMode: "live" | "simulation"; model: string | null },
): Promise<string> {
  const id = newId("b");
  await db.run("INSERT INTO batches (id, source, ai_mode, model, status, created_at) VALUES ($1, $2, $3, $4, 'drafting', $5)", [
    id,
    b.source,
    b.aiMode,
    b.model,
    nowIso(),
  ]);
  return id;
}

export async function addFrames(db: Db, batchId: string, frames: { path: string; mime: string }[]) {
  for (const [idx, f] of frames.entries()) {
    await db.run("INSERT INTO frames (batch_id, idx, path, mime) VALUES ($1, $2, $3, $4)", [batchId, idx, f.path, f.mime]);
  }
  await db.run("UPDATE batches SET frame_count = $1 WHERE id = $2", [frames.length, batchId]);
}

export async function failBatch(db: Db, batchId: string, error: string) {
  await db.run("UPDATE batches SET status = 'failed', error = $1 WHERE id = $2", [error.slice(0, 2000), batchId]);
}

export async function insertDraftItems(
  db: Db,
  batchId: string,
  draft: AiDraft,
  opts: { origin: "ai" | "fixture"; altLang: string; framePaths: string[]; repaired: boolean },
) {
  await db.tx(async (t) => {
    for (const [pos, it] of draft.items.entries()) {
      const cents = dollarsToCents(it.price.usd);
      await t.run(
        `INSERT INTO items (
          id, batch_id, status, origin, title_en, description_en, alt_lang, title_alt, description_alt, materials, dimensions,
          condition_grade, condition_notes, defects, suggested_price_cents, price_rationale, price_cents, quantity,
          hs_suggested, hs_description, hs_rationale, hs_code, confidence, image_path, sort_order, created_at
        ) VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 1, $17, $18, $19, $20, $21, $22, $23, $24)`,
        [
          newId("it"),
          batchId,
          opts.origin,
          it.title_en,
          it.description_en,
          opts.altLang,
          it.title_alt,
          it.description_alt,
          it.materials,
          it.dimensions_estimate,
          it.condition.grade,
          it.condition.notes,
          JSON.stringify(it.condition.defects),
          cents,
          it.price.rationale,
          cents,
          it.hs.code,
          it.hs.description,
          it.hs.rationale,
          it.hs.code,
          JSON.stringify(it.confidence),
          opts.framePaths[it.frame_indices[0]] ?? opts.framePaths[0] ?? null,
          pos,
          nowIso(),
        ],
      );
    }
    await t.run("UPDATE batches SET status = 'ready', repaired = $1 WHERE id = $2", [opts.repaired, batchId]);
  });
}

export async function getBatch(db: Db, id: string) {
  const batch = await db.get<BatchRow>("SELECT * FROM batches WHERE id = $1", [id]);
  if (!batch) throw notFound("Batch");
  const items = await db.all<ItemRow>("SELECT * FROM items WHERE batch_id = $1 ORDER BY sort_order", [id]);
  const frames = await db.all<{ idx: number; path: string; mime: string }>(
    "SELECT idx, path, mime FROM frames WHERE batch_id = $1 ORDER BY idx",
    [id],
  );
  return {
    id: batch.id,
    source: batch.source,
    aiMode: batch.ai_mode,
    model: batch.model,
    status: batch.status,
    frameCount: batch.frame_count,
    repaired: batch.repaired === true,
    error: batch.error,
    createdAt: batch.created_at,
    transcript: batch.transcript ? (JSON.parse(batch.transcript) as { language: string; original: string; english: string }) : null,
    frames,
    items: items.map(toItemDto),
  };
}

export async function latestBatchId(db: Db): Promise<string | null> {
  const row = await db.get<{ id: string }>("SELECT id FROM batches WHERE status <> 'failed' ORDER BY created_at DESC LIMIT 1");
  return row?.id ?? null;
}

async function getItemRow(db: Db, id: string): Promise<ItemRow> {
  const row = await db.get<ItemRow>("SELECT * FROM items WHERE id = $1", [id]);
  if (!row) throw notFound("Item");
  return row;
}

/** Re-resolves the tariff rate when the seller changes the HS code. */
export type RateResolver = (hsCode: string) => Promise<{ source: "live" | "table" | "none"; mfnPct: number | null; htsLine: string | null; note: string }>;

export async function updateItem(db: Db, id: string, input: z.infer<typeof ConfirmItemSchema>, resolveRate?: RateResolver) {
  const row = await getItemRow(db, id);
  if (row.status !== "draft" && row.status !== "confirmed") throw conflict("Published items can't be edited in this demo");
  if (input.hs_code.trim() !== row.hs_code.trim()) {
    // New HS code: the old live rate no longer applies. Look it up again (or fall back to the table).
    const r = resolveRate ? await resolveRate(input.hs_code) : null;
    const ok = r && r.source !== "none" && r.mfnPct !== null;
    await db.run("UPDATE items SET mfn_rate_pct = $1, rate_source = $2, hts_line = $3, rate_note = $4 WHERE id = $5", [
      ok ? r!.mfnPct : null,
      ok ? r!.source : null,
      ok ? r!.htsLine : null,
      r?.note ?? null,
      id,
    ]);
  }
  await db.run(
    `UPDATE items SET title_en = $1, description_en = $2, title_alt = $3, description_alt = $4, materials = $5, dimensions = $6,
     condition_grade = $7, condition_notes = $8, price_cents = $9, quantity = $10, hs_code = $11, status = $12, confirmed_at = $13
     WHERE id = $14`,
    [
      input.title_en,
      input.description_en,
      input.title_alt,
      input.description_alt,
      input.materials,
      input.dimensions ?? null,
      input.condition_grade,
      input.condition_notes,
      dollarsToCents(input.price_usd),
      input.quantity,
      input.hs_code,
      input.confirm ? "confirmed" : "draft",
      input.confirm ? nowIso() : null,
      id,
    ],
  );
  return toItemDto(await getItemRow(db, id));
}

export async function deleteItem(db: Db, id: string) {
  const row = await getItemRow(db, id);
  if (row.status !== "draft" && row.status !== "confirmed") throw conflict("Only unpublished drafts can be removed");
  await db.run("DELETE FROM items WHERE id = $1", [id]);
}

/** Publishing requires every remaining item to be seller-confirmed. */
export async function publishBatch(db: Db, batchId: string) {
  const batch = await getBatch(db, batchId);
  if (batch.items.length === 0) throw conflict("Nothing to publish");
  const unconfirmed = batch.items.filter((i) => i.status === "draft");
  if (unconfirmed.length) {
    throw conflict("Every item must be confirmed by the seller before publishing", {
      unconfirmed: unconfirmed.map((i) => ({ id: i.id, title: i.titleEn })),
    });
  }
  await db.tx(async (t) => {
    await t.run("UPDATE items SET status = 'published' WHERE batch_id = $1 AND status = 'confirmed'", [batchId]);
    await t.run("UPDATE batches SET status = 'published' WHERE id = $1", [batchId]);
  });
  return getBatch(db, batchId);
}

/**
 * Publish ONE confirmed item so it can be sold through a pay link. Items the
 * restricted-materials screen marks "blocked" are refused.
 */
export async function publishItem(db: Db, id: string) {
  const row = await getItemRow(db, id);
  if (row.status === "published" || row.status === "sold_out") return toItemDto(row);
  if (row.status !== "confirmed") throw conflict("Confirm price, quantity, condition and HS code before getting a pay link");
  const screen = row.restricted ? (JSON.parse(row.restricted) as { level: string; hits: { term: string }[] }) : null;
  if (screen?.level === "blocked") {
    throw conflict(`This piece looks like a prohibited material (${screen.hits.map((h) => h.term).join(", ")}). Not legal advice, but we won't create a pay link.`);
  }
  await db.run("UPDATE items SET status = 'published' WHERE id = $1 AND status = 'confirmed'", [id]);
  return toItemDto(await getItemRow(db, id));
}

export async function listShop(db: Db) {
  const rows = await db.all<ItemRow>(
    "SELECT * FROM items WHERE status IN ('published', 'sold_out') ORDER BY created_at DESC, sort_order",
  );
  return rows.map(toItemDto);
}

export async function getShopItem(db: Db, id: string) {
  const row = await getItemRow(db, id);
  if (row.status !== "published" && row.status !== "sold_out") throw notFound("Item");
  return toItemDto(row);
}

export async function getItemForSale(db: Db, id: string): Promise<ItemRow> {
  const row = await db.get<ItemRow>("SELECT * FROM items WHERE id = $1 AND status = 'published'", [id]);
  if (!row) throw notFound("Item for sale");
  return row;
}
