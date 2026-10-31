export type DashboardSeriesScope = { organizationId: string; dateFrom: string; dateTo: string; timezone: string };
export type DashboardSeriesCount = { period_start: string; period_end: string; projects: number; orders: number; clients: number };
export type DashboardSeriesMoneyPoint = { period_start: string; period_end: string; income: string; expenses: string };
export type DashboardSeriesData = {
 organization_id: string; date_from: string; date_to: string; effective_date_to: string | null;
 timezone: string; bucket: "day" | "month"; income_basis: "received"; expense_basis: "recorded";
 counts: DashboardSeriesCount[]; money: { currency: string; points: DashboardSeriesMoneyPoint[] }[];
};
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v;
const nextDay = (v: string) => new Date(Date.parse(`${v}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
const money = (v: unknown) => typeof v === "string" && /^-?(?:0|[1-9]\d{0,59})\.\d{2}$/.test(v);
const invalid = (): never => { throw new Error("Chart history could not be verified. Retry reading the current period."); };
/** Reject wrong-tenant/range/basis and partial or malformed histories before rendering. */
export function decodeDashboardSeries(value: unknown, scope: DashboardSeriesScope): DashboardSeriesData {
 if (!record(value) || value.organization_id !== scope.organizationId || value.date_from !== scope.dateFrom || value.date_to !== scope.dateTo || value.timezone !== scope.timezone || !date(value.date_from) || !date(value.date_to) || value.date_from > value.date_to || value.income_basis !== "received" || value.expense_basis !== "recorded" || (value.bucket !== "day" && value.bucket !== "month") || !Array.isArray(value.counts) || value.counts.length > 366 || !Array.isArray(value.money) || value.money.length > 200) return invalid();
 const totalDays = Math.round((Date.parse(`${value.date_to}T00:00:00Z`) - Date.parse(`${value.date_from}T00:00:00Z`))/86400000) + 1;
 if (totalDays > 366 || value.bucket !== (totalDays <= 62 ? "day" : "month")) return invalid();
 if (value.effective_date_to !== null && (!date(value.effective_date_to) || value.effective_date_to < value.date_from || value.effective_date_to > value.date_to)) return invalid();
 if ((value.effective_date_to === null) !== (value.counts.length === 0) || (value.effective_date_to === null && value.money.length !== 0)) return invalid();
 let expectedStart: string = value.date_from;
 for (const row of value.counts) {
  if (!record(row) || !date(row.period_start) || !date(row.period_end) || row.period_start !== expectedStart || row.period_end < row.period_start || row.period_end > String(value.effective_date_to) || !["projects","orders","clients"].every(key => typeof row[key] === "number" && Number.isSafeInteger(row[key]) && Number(row[key]) >= 0)) return invalid();
  if (value.bucket === "day" && row.period_start !== row.period_end) return invalid();
  if (value.bucket === "month") {
   if (row.period_start.slice(0,7) !== row.period_end.slice(0,7)) return invalid();
   if (row.period_end !== value.effective_date_to && nextDay(row.period_end).slice(8) !== "01") return invalid();
  }
  expectedStart = nextDay(row.period_end);
 }
 if (value.counts.length && value.counts[value.counts.length-1].period_end !== value.effective_date_to) return invalid();
 const currencies = new Set<string>();
 for (const series of value.money) {
  if (!record(series) || typeof series.currency !== "string" || !/^[A-Z]{3}$/.test(series.currency) || currencies.has(series.currency) || !Array.isArray(series.points) || series.points.length !== value.counts.length) return invalid();
  currencies.add(series.currency);
  for (let i=0;i<series.points.length;i++) {
   const point=series.points[i], period=value.counts[i];
   if (!record(point) || point.period_start !== period.period_start || point.period_end !== period.period_end || !money(point.income) || !money(point.expenses)) return invalid();
  }
 }
 return value as DashboardSeriesData;
}
