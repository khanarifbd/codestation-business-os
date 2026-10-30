import { salesTotalsPreview, type SalesMoneyLine, type SalesPreviewInput } from "./sales-money-preview";

// Existing sales/commercial schema: 14/4 quantity, 16/4 unit price, percentages 0..100.
const SCALE = BigInt(10000), CENTS = BigInt(100), MAX_CENTS = BigInt("9999999999999999");
function units(value: string | number, max: bigint, positive = false): bigint | null {
  const text = String(value).trim();
  if (text.length > 100) return null;
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] || 0) - fraction.length;
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return null;
  const coefficient = BigInt((match[2] || "0") + fraction);
  if (match[1] === "-" && coefficient !== BigInt(0)) return null;
  const shift = exponent + 4;
  const divisor = BigInt("1" + "0".repeat(Math.abs(shift)));
  // Decimal accepts scientific notation and insignificant trailing zeros; retain that contract.
  if (shift < 0 && coefficient % divisor !== BigInt(0)) return null;
  const amount = shift >= 0 ? coefficient * divisor : coefficient / divisor;
  return amount > max || (positive && amount === BigInt(0)) ? null : amount;
}
function operands(input: SalesPreviewInput) {
  const q = units(input.quantity, BigInt("99999999999999"), true);
  const p = units(input.unit_price, BigInt("9999999999999999"));
  const d = units(input.discount_percent === "" ? "0" : input.discount_percent, BigInt(100) * SCALE);
  const t = units(input.tax_rate === "" ? "0" : input.tax_rate, BigInt(100) * SCALE);
  return q === null || p === null || d === null || t === null ? null : { q, p, d, t };
}
export function exactSalesPayload(input: SalesPreviewInput) {
  if (!operands(input)) return null;
  return { quantity: String(input.quantity).trim(), unit_price: String(input.unit_price).trim(), discount_percent: String(input.discount_percent === "" ? "0" : input.discount_percent).trim(), tax_rate: String(input.tax_rate === "" ? "0" : input.tax_rate).trim() };
}
const rounded = (n: bigint, d: bigint) => (n + d / BigInt(2)) / d;
const text = (n: bigint) => `${n / CENTS}.${String(n % CENTS).padStart(2, "0")}`;
/** Match services/sales.py: round subtotal, discount, taxable, tax, total separately. */
export function exactSalesLinePreview(input: SalesPreviewInput, mode: string): SalesMoneyLine | null {
  const values = operands(input);
  if (!values || !["exclusive", "inclusive"].includes(mode)) return null;
  const { q, p, d, t } = values;
  const subtotal = rounded(q * p * CENTS, SCALE * SCALE);
  const discount = rounded(subtotal * d, SCALE * CENTS);
  const taxable = subtotal - discount;
  const tax = mode === "inclusive" ? taxable - rounded(taxable * SCALE * CENTS, SCALE * CENTS + t) : rounded(taxable * t, SCALE * CENTS);
  const total = mode === "inclusive" ? taxable : taxable + tax;
  if ([subtotal, discount, taxable, tax, total].some(v => v < BigInt(0) || v > MAX_CENTS)) return null;
  return { subtotal: text(subtotal), discount: text(discount), taxable: text(taxable), tax: text(tax), total: text(total) };
}
export function exactSalesTotalPreview(lines: SalesPreviewInput[], mode: string) {
  return salesTotalsPreview(lines.map(line => exactSalesLinePreview(line, mode))).total;
}
