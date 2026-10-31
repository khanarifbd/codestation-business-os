export type DashboardChartPeriod = { key: string; label: string; axisLabel?: string };
export type DashboardChartSeries = { key: string; label: string; values: string[] };
export type DashboardChartUnit = { kind: "count" } | { kind: "money"; currency: string };

const DECIMAL = /^-?(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/;
const COUNT = /^(?:0|[1-9]\d{0,59})$/;

function parsed(value: string) {
  if (typeof value !== "string" || !DECIMAL.test(value)) throw new Error("Chart values must be exact decimal strings.");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return { integer: BigInt(whole + fraction) * (negative ? BigInt(-1) : BigInt(1)), places: fraction.length };
}
function decimal(integer: bigint, places: number) {
  const negative = integer < BigInt(0);
  const raw = (negative ? -integer : integer).toString().padStart(places + 1, "0");
  return `${negative ? "-" : ""}${places ? `${raw.slice(0, -places)}.${raw.slice(-places)}` : raw}`;
}

/** Only a bounded [0,1] ratio becomes Number; full exact financial values never do. */
export function dashboardSeriesGeometry(periods: DashboardChartPeriod[], series: DashboardChartSeries[], unit: DashboardChartUnit) {
  if (!Array.isArray(periods) || periods.length > 366 || !Array.isArray(series) || series.length > 5) throw new Error("Unsupported chart dimensions.");
  if (unit.kind !== "count" && (unit.kind !== "money" || !/^[A-Z]{3}$/.test(unit.currency))) throw new Error("Chart unit is required.");
  const periodKeys = new Set<string>(), seriesKeys = new Set<string>();
  for (const period of periods) {
    if (!period || typeof period.key !== "string" || !period.key || periodKeys.has(period.key) || typeof period.label !== "string" || !period.label || (period.axisLabel !== undefined && (typeof period.axisLabel !== "string" || !period.axisLabel))) throw new Error("Chart periods must be uniquely labeled.");
    periodKeys.add(period.key);
  }
  const values = series.map(row => {
    if (!row || typeof row.key !== "string" || !row.key || seriesKeys.has(row.key) || typeof row.label !== "string" || !row.label || !Array.isArray(row.values) || row.values.length !== periods.length) throw new Error("Chart series must match every period.");
    seriesKeys.add(row.key);
    return row.values.map(value => {
      if (unit.kind === "count" && (typeof value !== "string" || !COUNT.test(value))) throw new Error("Counts must be nonnegative integers.");
      const result = parsed(value);
      if (unit.kind === "money" && result.places > 2) throw new Error("Money history must use exact ledger cents.");
      return result;
    });
  });
  const places = Math.max(unit.kind === "money" ? 2 : 0, ...values.flat().map(value => value.places));
  const integers = values.map(row => row.map(value => value.integer * BigInt(10) ** BigInt(places - value.places)));
  const all = integers.flat();
  const zero = BigInt(0);
  let min = zero, max = zero;
  for (const value of all) { if (value < min) min = value; if (value > max) max = value; }
  const allZero = all.length > 0 && all.every(value => value === zero);
  if (min === max) max = BigInt(10) ** BigInt(places);
  const range = max - min;
  const left = 12, right = 628, top = 18, bottom = 190;
  const points = integers.map(row => row.map((value, index) => ({
    x: periods.length === 1 ? (left + right) / 2 : left + index * (right - left) / (periods.length - 1),
    y: bottom - Number(((value - min) * BigInt(1000000)) / range) / 1000000 * (bottom - top),
  })));
  return { points, min: decimal(min, places), max: decimal(max, places), allZero, left, right, top, bottom };
}

export function nearestChartPeriod(clientX: number, left: number, width: number, count: number) {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0 || !Number.isInteger(count) || count < 1) return null;
  const viewX = (clientX - left) / width * 640;
  return Math.max(0, Math.min(count - 1, Math.round((viewX - 12) / 616 * (count - 1))));
}

export function exactChartCount(value: string) {
  if (!COUNT.test(value)) throw new Error("Invalid chart count.");
  return new Intl.NumberFormat().format(BigInt(value));
}

/** Point inspection only: this never changes the reporting date range. */
export function keyboardChartPeriod(key: string, current: number, count: number) {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(current) || current < 0 || current >= count) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowLeft") return Math.max(0, current - 1);
  if (key === "ArrowRight") return Math.min(count - 1, current + 1);
  return null;
}
