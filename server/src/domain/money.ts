/** All money is held as integer cents. PayPal wants "12.34" strings. */

export function centsToValue(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Invalid cents: ${cents}`);
  return (cents / 100).toFixed(2);
}

/** Parse a PayPal amount string ("48", "48.5", "48.50") to cents. Returns null if malformed. */
export function valueToCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function dollarsToCents(usd: number): number {
  return Math.round(usd * 100);
}
