/** Mirrors backend services/sales.py cents/ROUND_HALF_UP stages; never changes request payloads. */
export type SalesPreviewInput = { quantity: string | number; unit_price: string | number; discount_percent: string | number; tax_rate: string | number };
export type SalesMoneyLine = { subtotal: string; discount: string; taxable: string; tax: string; total: string };
export type SalesMoneyTotals = Pick<SalesMoneyLine, "subtotal" | "discount" | "tax" | "total">;
type Ratio = { n: bigint; d: bigint };
const ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2), HUNDRED = BigInt(100);
const MAX_CENTS = BigInt("9999999999999999"); // Existing Numeric(16, 2) money columns.

function decimalRatio(value: string): Ratio | null {
  if (!value || value.length > 100) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return null;
  const exponent = Number(match[4] || 0) - (match[3]?.length || 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 400) return null;
  const coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${match[2]}${match[3] || ""}`);
  return exponent >= 0 ? { n: coefficient * BigInt("1" + "0".repeat(exponent)), d: ONE } : { n: coefficient, d: BigInt("1" + "0".repeat(-exponent)) };
}
function wireRatio(value: string | number): { ratio: Ratio; numeric: number } | null {
  // Inputs are sent through Number(...) by existing callers. Use that exact JSON-number value.
  if (typeof value === "string" && value.length > 100) return null;
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return null;
  const ratio = decimalRatio(String(numeric));
  return ratio ? { ratio, numeric } : null;
}
function halfUp(n: bigint, d: bigint): bigint {
  const negative = n < ZERO, magnitude = negative ? -n : n;
  const rounded = magnitude / d + ((magnitude % d) * TWO >= d ? ONE : ZERO);
  return negative ? -rounded : rounded;
}
function centsText(cents: bigint): string {
  const negative = cents < ZERO, magnitude = negative ? -cents : cents;
  return `${negative ? "-" : ""}${magnitude / HUNDRED}.${String(magnitude % HUNDRED).padStart(2, "0")}`;
}
function moneyCents(value: string | number): bigint | null {
  const ratio = decimalRatio(String(value));
  return ratio ? halfUp(ratio.n * HUNDRED, ratio.d) : null;
}
export function salesLinePreview(input: SalesPreviewInput, mode: string): SalesMoneyLine | null {
  if (mode !== "inclusive" && mode !== "exclusive") return null;
  const q = wireRatio(input.quantity), p = wireRatio(input.unit_price), discount = wireRatio(input.discount_percent), rate = wireRatio(input.tax_rate);
  if (!q || !p || !discount || !rate || q.numeric <= 0 || q.numeric >= 1e10 || p.numeric < 0 || p.numeric > 1e12 || discount.numeric < 0 || discount.numeric > 100 || rate.numeric < 0 || rate.numeric > 1000) return null;
  const subtotal = halfUp(q.ratio.n * p.ratio.n * HUNDRED, q.ratio.d * p.ratio.d);
  const discountCents = halfUp(subtotal * discount.ratio.n, discount.ratio.d * HUNDRED);
  const taxable = subtotal - discountCents;
  const tax = mode === "inclusive"
    ? taxable - halfUp(taxable * rate.ratio.d * HUNDRED, rate.ratio.d * HUNDRED + rate.ratio.n)
    : halfUp(taxable * rate.ratio.n, rate.ratio.d * HUNDRED);
  const total = mode === "inclusive" ? taxable : taxable + tax;
  if ([subtotal, discountCents, taxable, tax, total].some(value => value < ZERO || value > MAX_CENTS)) return null;
  return { subtotal: centsText(subtotal), discount: centsText(discountCents), taxable: centsText(taxable), tax: centsText(tax), total: centsText(total) };
}
export function sumMoneyExact(values: Array<string | number>): string {
  let total = ZERO;
  for (const value of values) { const cents = moneyCents(value); if (cents === null) return ""; total += cents; }
  return total > MAX_CENTS || total < -MAX_CENTS ? "" : centsText(total);
}
export function salesTotalsPreview(lines: Array<SalesMoneyLine | null>): SalesMoneyTotals {
  if (lines.some(line => line === null)) return { subtotal: "", discount: "", tax: "", total: "" };
  const valid = lines as SalesMoneyLine[];
  return { subtotal: sumMoneyExact(valid.map(line => line.subtotal)), discount: sumMoneyExact(valid.map(line => line.discount)), tax: sumMoneyExact(valid.map(line => line.tax)), total: sumMoneyExact(valid.map(line => line.total)) };
}
/** Localized grouping without converting an exact full monetary value into a binary float. */
export function formatMoneyExact(value: string | number | null | undefined, currency: string): string {
  const cents = moneyCents(value ?? 0);
  if (cents === null) return `${currency} —`;
  const negative = cents < ZERO, magnitude = negative ? -cents : cents;
  const whole = magnitude / HUNDRED, fraction = magnitude % HUNDRED;
  const formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fractionText = new Intl.NumberFormat(undefined, { useGrouping: false, minimumIntegerDigits: 2, maximumFractionDigits: 0 }).format(Number(fraction)); // 0..99 only, exact.
  const parts = formatter.formatToParts(negative && whole === ZERO ? -0 : negative ? -whole : whole);
  return `${currency} ${parts.map(part => part.type === "fraction" ? fractionText : part.value).join("")}`;
}
