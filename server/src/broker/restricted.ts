/**
 * Small curated screen for materials that commonly block India → US craft shipments.
 * NOT legal advice and not exhaustive: it only catches obvious keywords in what the
 * seller and the AI described, so the seller can double-check before selling.
 */

export type RestrictionLevel = "blocked" | "caution";

interface Rule {
  pattern: RegExp;
  term: string;
  level: RestrictionLevel;
  reason: string;
}

const RULES: Rule[] = [
  { pattern: /\bivory\b/i, term: "ivory", level: "blocked", reason: "Elephant ivory trade is banned (CITES; US ESA/African Elephant rules)." },
  // Shahtoosh (also "shatoosh", "shatush"): Tibetan antelope wool. Pashmina (cashmere goat) is legal and NOT matched.
  // Matches the English text (titles, materials, the translated voice note); the model translates Hindi first.
  { pattern: /\b(shah?too?sh|shatush)\b/i, term: "shahtoosh", level: "blocked", reason: "Shahtoosh comes from the endangered Tibetan antelope (chiru), CITES Appendix I; trade is banned. Pashmina (cashmere goat) is fine." },
  { pattern: /\b(red sanders|red sandalwood|pterocarpus santalinus)\b/i, term: "red sanders", level: "blocked", reason: "Red sanders is CITES-listed and its export from India is prohibited." },
  { pattern: /\b(tortoise ?shell|turtle ?shell)\b/i, term: "tortoiseshell", level: "blocked", reason: "Sea turtle products are banned (CITES Appendix I)." },
  { pattern: /\b(tiger|leopard|snake|python|crocodile|alligator|monitor lizard)\s*(skin|leather|hide|bone|claw)/i, term: "wild animal parts", level: "blocked", reason: "Wildlife parts are restricted under CITES and India's Wildlife (Protection) Act." },
  { pattern: /\b(peacock|peafowl) feathers?\b/i, term: "peacock feather", level: "caution", reason: "Peafowl feather exports from India are restricted; US entry may need wildlife (USFWS) declaration." },
  { pattern: /\b(feather|plume)s?\b/i, term: "feathers", level: "caution", reason: "Wild-bird feathers can need USFWS clearance." },
  { pattern: /\b(coral)\b/i, term: "coral", level: "caution", reason: "Many corals are CITES-listed; real coral may need permits." },
  { pattern: /\b(rosewood|sheesham|shisham|dalbergia)\b/i, term: "rosewood (Dalbergia)", level: "caution", reason: "Dalbergia species are CITES Appendix II; small finished items are often exempt, but check." },
  { pattern: /\bsandal ?wood\b/i, term: "sandalwood", level: "caution", reason: "India restricts sandalwood exports; finished handicrafts are often allowed, but check." },
  { pattern: /\b(antique|heirloom|vintage .*100|over 100 years|centur(y|ies) old)\b/i, term: "antique", level: "caution", reason: "India's Antiquities Act bars export of antiquities over 100 years old without a permit." },
  { pattern: /\b(food|spice|tea|pickle|seeds?|plant|soil)\b/i, term: "food/plant material", level: "caution", reason: "Food and plant items need FDA prior notice and/or USDA checks." },
  { pattern: /\b(lead[- ]?based|lead paint|lead glaze)\b/i, term: "lead", level: "caution", reason: "Lead in ceramics or paint used with food is restricted by the FDA/CPSC." },
];

export interface RestrictionResult {
  level: "ok" | RestrictionLevel;
  hits: { term: string; level: RestrictionLevel; reason: string }[];
  disclaimer: string;
}

export const RESTRICTED_DISCLAIMER = "Curated keyword screen, not legal advice and not exhaustive.";

export function checkRestricted(...texts: (string | null | undefined)[]): RestrictionResult {
  const text = texts.filter(Boolean).join(" \n ");
  const hits: RestrictionResult["hits"] = [];
  for (const r of RULES) {
    if (r.pattern.test(text) && !hits.some((h) => h.term === r.term)) hits.push({ term: r.term, level: r.level, reason: r.reason });
  }
  // A specific match ("peacock feather") makes the generic one ("feathers") redundant.
  const pruned = hits.some((h) => h.term === "peacock feather") ? hits.filter((h) => h.term !== "feathers") : hits;
  const level = pruned.some((h) => h.level === "blocked") ? "blocked" : pruned.length ? "caution" : "ok";
  return { level, hits: pruned, disclaimer: RESTRICTED_DISCLAIMER };
}
