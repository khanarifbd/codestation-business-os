/** Inventory has Numeric(18,4) units/costs and Numeric(18,2) receipt amounts.
 * Keep decimal wire strings intact: backend Decimal/ROUND_HALF_UP remains authoritative.
 * This intentionally does not reuse Sales' narrower Numeric(16,2) preview bounds. */
type Decimal = { n: bigint; d: bigint };
const ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2), HUNDRED = BigInt(100);
const MAX_RECEIPT_CENTS = BigInt("999999999999999999");
export const inventoryDecimalWire = (value: string) => value.trim() || "0";
function decimal(value: string | number): Decimal | null {
  const text = String(value).trim();
  if (text.length > 200) return null;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || !(match[2] || match[3])) return null;
  const exponent = Number(match[4] || 0) - (match[3]?.length || 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 200) return null;
  const n = BigInt(`${match[1] === "-" ? "-" : ""}${match[2] || "0"}${match[3] || ""}`);
  return exponent >= 0 ? { n: n * BigInt("1" + "0".repeat(exponent)), d: ONE } : { n, d: BigInt("1" + "0".repeat(-exponent)) };
}
function halfUp(n: bigint, d: bigint) {
  const negative = n < ZERO, magnitude = negative ? -n : n;
  const rounded = magnitude / d + ((magnitude % d) * TWO >= d ? ONE : ZERO);
  return negative ? -rounded : rounded;
}
function centsText(cents: bigint) {
  const negative = cents < ZERO, magnitude = negative ? -cents : cents;
  return `${negative ? "-" : ""}${magnitude / HUNDRED}.${String(magnitude % HUNDRED).padStart(2, "0")}`;
}
export function inventoryMoney(value: string | number, currency = "", scale: 2 | 4 = 2): string {
  const parsed = decimal(value);
  if (!parsed) return `${currency ? currency + " " : ""}—`;
  const factor = BigInt(10 ** scale), rounded = halfUp(parsed.n * factor, parsed.d);
  const negative = rounded < ZERO, magnitude = negative ? -rounded : rounded;
  // Only the bounded fraction is converted to Number; the whole amount stays exact.
  const formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: scale, maximumFractionDigits: scale });
  const fraction = new Intl.NumberFormat(undefined, { useGrouping: false, minimumIntegerDigits: scale, maximumFractionDigits: 0 }).format(Number(magnitude % factor));
  const whole = magnitude / factor;
  const parts = formatter.formatToParts(negative && whole === ZERO ? -0 : negative ? -whole : whole);
  return `${currency ? currency + " " : ""}${parts.map(part => part.type === "fraction" ? fraction : part.value).join("")}`;
}
// Python's existing Decimal context rounds multiplication to28 significant digits
// before quantize(). Rather than imply a different result for excess precision,
// withhold only the preview; the unchanged decimal wire still reaches the backend.
function withinBackendContext(coefficient: bigint) {
  return coefficient.toString().replace("-", "").replace(/0+$/, "").length <= 28;
}
/** Mirrors inventory.py within its Decimal context: per-line cents, then line tax cents. */
export function inventoryPurchasePreview(lines: { quantity: string; unit_cost: string; tax_code_id: string }[], taxes: { id: string; rate: string }[]) {
  let subtotal = ZERO, tax = ZERO;
  const unavailable = { subtotal: "", tax: "", total: "" };
  for (const line of lines) {
    const quantity = decimal(line.quantity || "0"), cost = decimal(line.unit_cost || "0");
    const rate = decimal(taxes.find(item => item.id === line.tax_code_id)?.rate || "0");
    if (!quantity || !cost || !rate || quantity.n < ZERO || cost.n < ZERO || rate.n < ZERO) return unavailable;
    const product = quantity.n * cost.n;
    if (!withinBackendContext(product)) return unavailable;
    const base = halfUp(product * HUNDRED, quantity.d * cost.d);
    const taxProduct = base * rate.n;
    if (!withinBackendContext(taxProduct)) return unavailable;
    subtotal += base;
    tax += halfUp(taxProduct, rate.d * HUNDRED);
  }
  if (subtotal > MAX_RECEIPT_CENTS || tax > MAX_RECEIPT_CENTS || subtotal + tax > MAX_RECEIPT_CENTS) return unavailable;
  return { subtotal: centsText(subtotal), tax: centsText(tax), total: centsText(subtotal + tax) };
}

/** Exact stock/reorder comparisons; malformed read values are unknown, never coerced to zero. */
export function inventoryCompare(left: string | number, right: string | number): -1 | 0 | 1 | null {
  const a = decimal(left), b = decimal(right);
  if (!a || !b) return null;
  const difference = a.n * b.d - b.n * a.d;
  return difference < ZERO ? -1 : difference > ZERO ? 1 : 0;
}
