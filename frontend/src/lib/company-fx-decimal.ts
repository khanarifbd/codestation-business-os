// Keep FX input strings intact: the backend owns Decimal scale/rounding policy.
const decimal = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/;
// Resource bounds exceed the persisted 24-digit FX fields without imposing a
// new fractional scale or rounding rule. Reject pathological wire/user text.
function boundedDecimal(value: string): RegExpExecArray | null {
  if (value.length > 128) return null;
  const match = decimal.exec(value.trim());
  if (!match) return null;
  const exponent = Number(match[3] || "0");
  return Number.isSafeInteger(exponent) && Math.abs(exponent) <= 128 ? match : null;
}
export function positiveFxInput(value: string): string | null {
  const input = value.trim(), match = boundedDecimal(value);
  return match && match[1] !== "-" && /[1-9]/.test(match[2]) ? input : null;
}

// Pydantic serializes Decimal as fixed-point or scientific strings. Neither
// their coefficient nor displayed fractional digits may pass through Number.
export function formatFxDecimal(value: string | null, locale?: string): string {
  if (value === null) return "—";
  const match = boundedDecimal(value);
  if (!match) return "—";
  const exponent = Number(match[3] || "0");
  const [whole, fraction = ""] = match[2].split("."), digits = whole + fraction;
  const point = whole.length + exponent;
  const integer = point <= 0 ? "0" : point >= digits.length ? digits + "0".repeat(point - digits.length) : digits.slice(0, point);
  const fractional = (point <= 0 ? "0".repeat(-point) + digits : point >= digits.length ? "" : digits.slice(point)).replace(/0+$/, "").padEnd(2, "0");
  const negative = match[1] === "-" && /[1-9]/.test(digits);
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(integer || "0"));
  const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === "decimal")?.value ?? ".";
  const digitFormatter = new Intl.NumberFormat(locale, { useGrouping: false });
  const localDigits = Array.from({ length: 10 }, (_, digit) => digitFormatter.format(digit));
  const localizedFraction = fractional.replace(/[0-9]/g, digit => localDigits[Number(digit)]);
  return `${negative ? "-" : ""}${grouped}${separator}${localizedFraction}`;
}
