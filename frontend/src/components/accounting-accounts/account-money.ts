/** Accounting Numeric(18,2), API ROUND_HALF_UP. No binary-float monetary arithmetic. */
const MAX_OPENING_CENTS = BigInt("999999999999999999");
function cents(value: string | number): bigint | null {
    const raw = String(value).trim();
    if (!raw || raw.length > 120) return null;
    const normalized = raw.replace(/^([+-]?)\./, (_match, sign: string) => `${sign}0.`);
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(normalized);
    if (!match) return null;
    const exponent = Number(match[4] || 0) - (match[3]?.length || 0) + 2;
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 120) return null;
    const magnitude = BigInt(match[2] + (match[3] || ""));
    const scale = BigInt(10) ** BigInt(Math.abs(exponent));
    const rounded = exponent >= 0 ? magnitude * scale : magnitude / scale + (magnitude % scale * BigInt(2) >= scale ? BigInt(1) : BigInt(0));
    return match[1] === "-" ? -rounded : rounded;
}
function decimal(value: bigint): string {
    const magnitude = value < BigInt(0) ? -value : value;
    return `${value < BigInt(0) ? "-" : ""}${magnitude / BigInt(100)}.${String(magnitude % BigInt(100)).padStart(2, "0")}`;
}
export function accountOpening(value: string, creditCard: boolean): string {
    const amount = cents(value.trim() || "0");
    if (amount === null || amount > MAX_OPENING_CENTS || amount < -MAX_OPENING_CENTS) throw new Error("Enter an opening balance within the accounting limit (16 whole digits and 2 decimal places).");
    if (creditCard && amount < BigInt(0)) throw new Error("Credit card opening balance must be zero or a positive amount currently owed.");
    return decimal(amount);
}
export function accountSum(values: Array<string | number>): string {
    let total = BigInt(0);
    for (const value of values) { const parsed = cents(value); if (parsed === null) return ""; total += parsed; }
    return decimal(total);
}
export function accountFormat(value: string | number, currency: string): string {
    const amount = cents(value);
    if (amount === null) return `${currency} —`;
    const negative = amount < BigInt(0), magnitude = negative ? -amount : amount;
    const whole = magnitude / BigInt(100), fraction = Number(magnitude % BigInt(100));
    const formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fractionText = new Intl.NumberFormat(undefined, { useGrouping: false, minimumIntegerDigits: 2, maximumFractionDigits: 0 }).format(fraction);
    return `${currency} ${formatter.formatToParts(negative && whole === BigInt(0) ? -0 : negative ? -whole : whole).map(part => part.type === "fraction" ? fractionText : part.value).join("")}`;
}
