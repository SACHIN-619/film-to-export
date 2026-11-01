import { findHeading, loadRateTable, type RateTable } from "../domain/duty.js";

/**
 * Live lookup of the US General (MFN) duty rate from the official USITC HTS REST API
 * (https://hts.usitc.gov/reststop/search?keyword=…, public, no key). Falls back to the
 * local, cited table when the API is unreachable or the rate isn't a plain percentage.
 */

export const HTS_API = "https://hts.usitc.gov/reststop/search";

export interface TariffResult {
  source: "live" | "table" | "none";
  mfnPct: number | null;
  htsLine: string | null;
  description: string | null;
  /** Human-readable note: which line was used, ranges, why we fell back. */
  note: string;
  /** Link someone can click to see the same data. */
  url: string;
  checkedAt: string;
  ms: number;
  /** Ad-valorem lines under this heading (live only), for refining to the exact 8/10-digit line. */
  lines?: HtsLine[];
}

interface HtsRow {
  htsno: string;
  description: string;
  general: string;
  indent?: string;
}

export interface TariffLookup {
  lookup(hsCode: string, opts?: { scope?: "heading" | "code" }): Promise<TariffResult>;
}

const digits = (s: string) => s.replace(/\D/g, "");

/** "7%" → 7, "Free" → 0, "11.3%" → 11.3; specific/compound rates ("0.47¢/kg", "6% + 2¢/kg") → null. */
export function parseGeneralRate(general: string): number | null {
  const g = general.trim();
  if (/^free$/i.test(g)) return 0;
  const m = /^(\d+(?:\.\d+)?)%$/.exec(g);
  return m ? Number(m[1]) : null;
}

/** HS "621490" / "6214.90.00.10" → the API keyword "6214.90" / "6214.90.00". */
export function toKeyword(hsCode: string): string {
  const d = digits(hsCode);
  if (d.length <= 4) return d;
  const parts = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean);
  return parts.slice(0, 3).join(".");
}

/** Whitespace-normalised description. Never truncated: qualifiers at the end decide the line. */
const clip = (s: string) => s.replace(/\s+/g, " ").replace(/:$/, "").trim();

/** Shortened text for display only (notes, step titles). */
export const shorten = (s: string | null | undefined, max = 160) => {
  const t = (s ?? "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * HTS rows are hierarchical: a line's own description is often just "Other" and its meaning
 * lives in its parents (by `indent`). Rebuild "Parent › Child › Line" so a person, or the model,
 * can tell "Of wool or fine animal hair" from "Of other textile materials".
 */
export function withContext(rows: HtsRow[]): (HtsRow & { path: string })[] {
  const stack: { indent: number; text: string }[] = [];
  return rows.map((r) => {
    const indent = Number(r.indent ?? 0);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    // Keep EVERY level: "Illuminated signs › Other › Of brass" must not shrink to "Other › Of brass".
    const path = [...stack.map((s) => s.text), clip(r.description ?? "")].filter(Boolean).join(" › ");
    stack.push({ indent, text: clip(r.description ?? "") });
    return { ...r, path };
  });
}

/**
 * Pick the line for an HS code from API rows. `scopeDigits` widens the candidate set (4 = the whole
 * heading, so a wrong subheading like 6214.20 "wool" vs 6214.90 "other, incl. cotton" can be corrected).
 * Preference: the line our cited table uses → the residual "Other" line inside the proposed code →
 * the first line inside the proposed code → the residual "Other" in scope → the first in scope.
 */
export function pickRate(hsCode: string, rows: HtsRow[], preferredLine?: string | null, scopeDigits?: number) {
  const d = digits(hsCode);
  const proposed = d.slice(0, Math.min(d.length, 8));
  const scope = d.slice(0, scopeDigits ?? proposed.length);
  const candidates = withContext(rows)
    .filter((r) => r.htsno && digits(r.htsno).startsWith(scope) && r.general)
    .map((r) => ({ ...r, pct: parseGeneralRate(r.general) }));
  const adValorem = candidates.filter((c) => c.pct !== null) as (HtsRow & { pct: number; path: string })[];
  if (adValorem.length === 0) return { picked: null, candidates: candidates.length, lines: [] as HtsLine[] };
  const pd = preferredLine ? digits(preferredLine) : "";
  const isOther = (c: { description: string }) => /^other\b/i.test(c.description.trim());
  const inProposed = adValorem.filter((c) => digits(c.htsno).startsWith(proposed));
  const preferred = pd ? adValorem.find((c) => digits(c.htsno).startsWith(pd)) : undefined;
  const picked = preferred ?? inProposed.find(isOther) ?? inProposed[0] ?? adValorem.find(isOther) ?? adValorem[0];
  const rates = [...new Set(adValorem.map((c) => c.pct))].sort((a, b) => a - b);
  return {
    picked,
    candidates: adValorem.length,
    range: rates.length > 1 ? ([rates[0], rates[rates.length - 1]] as const) : null,
    lines: adValorem.slice(0, 40).map((c) => ({ htsno: c.htsno, description: c.path, pct: c.pct })),
  };
}

export interface HtsLine {
  htsno: string;
  description: string;
  pct: number;
}

/** Offline lookup from the local cited table only (tests, or no network). */
export class TableTariffLookup implements TariffLookup {
  constructor(private readonly table?: RateTable) {}
  async lookup(hsCode: string): Promise<TariffResult> {
    const table = this.table ?? loadRateTable();
    const h = findHeading(table, hsCode);
    const base = { checkedAt: new Date().toISOString(), ms: 0 };
    return h
      ? { ...base, source: "table", mfnPct: h.mfn_rate_pct, htsLine: h.hts_line, description: h.description, note: `Local cited table (checked ${table.checked_on}).`, url: h.sources[0] ?? HTS_API }
      : { ...base, source: "none", mfnPct: null, htsLine: null, description: null, note: `No rate on file for HS ${hsCode}.`, url: HTS_API };
  }
}

export class LiveTariffLookup implements TariffLookup {
  /** Raw API rows per keyword, so different proposed codes under one heading share one call. */
  private cache = new Map<string, { at: number; rows: HtsRow[] }>();

  constructor(
    private readonly opts: { fetchFn?: typeof fetch; timeoutMs?: number; ttlMs?: number; table?: RateTable } = {},
  ) {}

  private async rows(keyword: string, url: string): Promise<{ rows: HtsRow[]; cached: boolean }> {
    const hit = this.cache.get(keyword);
    if (hit && Date.now() - hit.at < (this.opts.ttlMs ?? 6 * 3600_000)) return { rows: hit.rows, cached: true };
    const res = await (this.opts.fetchFn ?? fetch)(url, { signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    const rows = Array.isArray(json) ? (json as HtsRow[]) : [];
    this.cache.set(keyword, { at: Date.now(), rows });
    return { rows, cached: false };
  }

  /**
   * `scope: "heading"` searches the whole 4-digit heading (used by the agent so a wrong
   * subheading can be corrected); the default searches the code as given (seller edits).
   */
  async lookup(hsCode: string, opts: { scope?: "heading" | "code" } = {}): Promise<TariffResult> {
    const table = this.opts.table ?? loadRateTable();
    const heading = findHeading(table, hsCode);
    const wide = opts.scope === "heading";
    const keyword = wide ? digits(hsCode).slice(0, 4) : toKeyword(hsCode);
    const url = `${HTS_API}?keyword=${encodeURIComponent(keyword)}`;
    const t0 = Date.now();
    const fallback = (why: string): TariffResult =>
      heading
        ? {
            source: "table",
            mfnPct: heading.mfn_rate_pct,
            htsLine: heading.hts_line,
            description: heading.description,
            note: `${why} Used the local cited table (checked ${table.checked_on}).`,
            url: heading.sources[0] ?? url,
            checkedAt: new Date().toISOString(),
            ms: Date.now() - t0,
          }
        : {
            source: "none",
            mfnPct: null,
            htsLine: null,
            description: null,
            note: `${why} No rate on file for HS ${hsCode}.`,
            url,
            checkedAt: new Date().toISOString(),
            ms: Date.now() - t0,
          };

    try {
      const { rows, cached } = await this.rows(keyword, url);
      const { picked, candidates, range, lines } = pickRate(hsCode, rows, heading?.hts_line, wide ? 4 : undefined);
      if (!picked) {
        return fallback(
          candidates ? `USITC lists ${candidates} line(s) for ${keyword} but none has a plain % rate.` : `USITC returned no line for ${keyword}.`,
        );
      }
      return {
        source: "live",
        mfnPct: picked.pct,
        htsLine: picked.htsno,
        description: picked.path,
        note:
          `USITC HTS: ${picked.htsno} "${shorten(picked.path)}" General ${picked.general}.` +
          (range ? ` ${candidates} lines under ${keyword} range ${range[0]}–${range[1]}%; the exact line matters.` : "") +
          (cached ? " (cached)" : ""),
        url,
        checkedAt: new Date().toISOString(),
        ms: Date.now() - t0,
        lines,
      };
    } catch (err) {
      return fallback(`USITC API unavailable (${(err as Error).message}).`);
    }
  }
}
