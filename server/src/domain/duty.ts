import fs from "node:fs";
import path from "node:path";

/**
 * US import duty ESTIMATE for a seller-confirmed HS code and price.
 * Server-only: checkout totals use this, never a number sent by the browser.
 * Not customs advice; see server/data/duty_rates.json for sources and the checked date.
 */

export interface RateHeading {
  hs: string;
  hts_line: string;
  description: string;
  mfn_rate_pct: number;
  verified: boolean;
  note?: string;
  sources: string[];
}

export interface OriginSurcharge {
  rate_pct: number;
  label: string;
  status: "confirmed" | "uncertain";
  note?: string;
  sources: string[];
}

export interface RateTable {
  destination: string;
  checked_on: string;
  disclaimer: string;
  not_included: string;
  origin_surcharges: Record<string, OriginSurcharge>;
  headings: RateHeading[];
}

export type DutyEstimate =
  | {
      status: "estimated";
      unitDutyCents: number;
      totalPct: number;
      mfnPct: number;
      surchargePct: number;
      matchedHs: string;
      htsLine: string;
      description: string;
      mfnVerified: boolean;
      surchargeLabel: string | null;
      surchargeStatus: OriginSurcharge["status"] | null;
      sources: string[];
      /** Where the MFN rate came from: a live USITC lookup or the local cited table. */
      rateSource: "live" | "table";
      checkedOn: string;
      disclaimer: string;
    }
  | { status: "unknown"; unitDutyCents: 0; reason: string; checkedOn: string; disclaimer: string };

let cached: RateTable | null = null;
export function loadRateTable(file = path.resolve("server/data/duty_rates.json")): RateTable {
  // Strip a UTF-8 BOM: Windows editors (and PowerShell 5.1) add one, and JSON.parse rejects it.
  if (!cached) cached = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) as RateTable;
  return cached;
}

const digits = (hs: string) => hs.replace(/\D/g, "");

/** Longest-prefix match on digits, so "6214.90.00.10" and "6214.90" both find 6214.90. */
export function findHeading(table: RateTable, hsCode: string): RateHeading | null {
  const d = digits(hsCode);
  let best: RateHeading | null = null;
  for (const h of table.headings) {
    const hd = digits(h.hs);
    if (d.startsWith(hd) && (!best || hd.length > digits(best.hs).length)) best = h;
  }
  return best;
}

/** A rate already resolved for this item (live USITC lookup or table), stored on the item row. */
export interface RateOverride {
  mfnPct: number;
  htsLine: string | null;
  source: "live" | "table";
  description?: string | null;
}

/** Duty for ONE unit at `unitCents` customs value. Multiply by quantity for the order. */
export function estimateDuty(
  hsCode: string,
  unitCents: number,
  origin = "IN",
  table: RateTable = loadRateTable(),
  override: RateOverride | null = null,
): DutyEstimate {
  const tableHeading = findHeading(table, hsCode);
  const heading: RateHeading | null = override
    ? {
        hs: tableHeading?.hs ?? hsCode,
        hts_line: override.htsLine ?? tableHeading?.hts_line ?? hsCode,
        description: override.description ?? tableHeading?.description ?? "",
        mfn_rate_pct: override.mfnPct,
        // A live USITC answer is the official schedule itself.
        verified: override.source === "live" ? true : (tableHeading?.verified ?? false),
        sources:
          override.source === "live"
            ? [`https://hts.usitc.gov/reststop/search?keyword=${encodeURIComponent(override.htsLine ?? hsCode)}`]
            : (tableHeading?.sources ?? []),
      }
    : tableHeading;
  if (!heading) {
    return {
      status: "unknown",
      unitDutyCents: 0,
      reason: `No rate on file for HS ${hsCode}. The buyer may owe duty on delivery.`,
      checkedOn: table.checked_on,
      disclaimer: table.disclaimer,
    };
  }
  const surcharge = table.origin_surcharges[origin] ?? null;
  const surchargePct = surcharge?.rate_pct ?? 0;
  const totalPct = Math.round((heading.mfn_rate_pct + surchargePct) * 100) / 100;
  return {
    status: "estimated",
    unitDutyCents: Math.round((unitCents * totalPct) / 100),
    totalPct,
    mfnPct: heading.mfn_rate_pct,
    surchargePct,
    matchedHs: heading.hs,
    htsLine: heading.hts_line,
    description: heading.description,
    mfnVerified: heading.verified,
    surchargeLabel: surcharge?.label ?? null,
    surchargeStatus: surcharge?.status ?? null,
    sources: [...heading.sources, ...(surcharge?.sources ?? [])],
    rateSource: override?.source ?? "table",
    checkedOn: table.checked_on,
    disclaimer: table.disclaimer,
  };
}

/** One-line human explanation: "HS 6214.90 → 11.3% MFN + 10% India surcharge (uncertain) = 21.3%". */
export function dutyBasis(e: DutyEstimate): string {
  if (e.status === "unknown") return e.reason;
  const src = e.rateSource === "live" ? ", live USITC" : "";
  const parts = [`HS ${e.matchedHs} (HTS ${e.htsLine}) → ${e.mfnPct}% MFN${e.mfnVerified ? "" : " (unverified)"}${src}`];
  if (e.surchargePct) parts.push(`${e.surchargePct}% ${e.surchargeLabel}${e.surchargeStatus === "uncertain" ? " (uncertain)" : ""}`);
  return `${parts.join(" + ")} = ${e.totalPct}% of customs value. Rates checked ${e.checkedOn}.`;
}
