/** CRM inputs retain their decimal text; no binary-float conversion at the write boundary. */
export function crmDecimal(value: string, scale: number, max: string, positive = false): string | null {
  const text = value.trim();
  if (text.length > 40 || !/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > scale) return null;
  const units = BigInt(whole + fraction.padEnd(scale, "0"));
  const maximum = BigInt(max) * BigInt("1" + "0".repeat(scale));
  if (units > maximum || (positive && units === BigInt(0))) return null;
  return text;
}
/** A display-only estimate: exact four-place operands, rounded once to cents (half up). */
export function requirementEstimate(quantity: string | number, price: string | number): string | null {
  function units(value: string | number) {
    const text = String(value);
    if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return null;
    const [whole, fraction = ""] = text.split(".");
    return BigInt(whole + fraction.padEnd(4, "0"));
  }
  const q = units(quantity), p = units(price);
  if (q === null || p === null) return null;
  const cents = (q * p + BigInt(500000)) / BigInt(1000000);
  return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}
