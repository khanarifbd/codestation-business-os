import { formatMoneyExact } from "@/lib/sales-money-preview";
import { operationKeys, trendSeries } from "./report-types";
import type { ReportAmount, ReportFilters, ReportOption, ReportTrend, ReportsMeta, ReportsOverview } from "./report-types";

const ZERO = BigInt(0), TEN = BigInt(10);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const currency = (value: unknown) => typeof value === "string" && /^[A-Z]{3}$/.test(value);
export const reportId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Decimal parsing is presentation-only. Never feeds a money mutation or recomputes server totals. */
export function reportDecimal(value: unknown): { coefficient: bigint; exponent: number } | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) return null;
  const raw = String(value);
  if (!raw || raw.length > 100) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match) return null;
  const exponent = Number(match[4] || 0) - (match[3]?.length || 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 400) return null;
  return { coefficient: BigInt(`${match[1] === "-" ? "-" : ""}${match[2]}${match[3] || ""}`), exponent };
}
const amount = (value: unknown) => reportDecimal(value) !== null;
const amounts = (row: Record<string, unknown>, keys: string[]) => keys.every(key => amount(row[key]));
const unique = <T,>(rows: T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length;
export function reportDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const month = (value: unknown) => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && !value.startsWith("0000");
const activityKeys = ["invoiced_revenue", "collected_revenue", "direct_expenses", "estimated_profit"];
const financialKeys = ["invoiced_revenue", "direct_income", "collected_revenue", "receivables", "expenses", "platform_fees", "transfer_fees", "net_profit"];
const trendKeys = ["invoiced_revenue", "direct_income", "collected_revenue", "expenses", "transfer_fees", "net_profit"];
function activity(row: unknown): row is Record<string, unknown> {
  return record(row) && text(row.client_name) && currency(row.currency) && amounts(row, activityKeys) && (row.margin_percent === null || amount(row.margin_percent));
}
export function isReportsOverview(value: unknown): value is ReportsOverview {
  if (!record(value) || value.reporting_basis !== "operational" || !reportDate(value.date_from) || !reportDate(value.date_to) || value.date_from > value.date_to) return false;
  if (!Array.isArray(value.financials) || !value.financials.every(row => record(row) && currency(row.currency) && amounts(row, financialKeys)) || !unique(value.financials, row => row.currency)) return false;
  if (!Array.isArray(value.trend) || !value.trend.every(row => record(row) && month(row.period) && currency(row.currency) && amounts(row, trendKeys)) || !unique(value.trend, row => `${row.period}:${row.currency}`)) return false;
  if (!Array.isArray(value.accounts) || !value.accounts.every(row => record(row) && reportId(row.account_id) && text(row.account_name) && text(row.account_type) && currency(row.currency) && amount(row.balance)) || !unique(value.accounts, row => row.account_id)) return false;
  if (!record(value.operations)) return false;
  const operations = value.operations;
  if (!operationKeys.every(key => typeof operations[key] === "number" && Number.isSafeInteger(operations[key]) && (operations[key] as number) >= 0)) return false;
  if (!Array.isArray(value.projects) || value.projects.length > 100 || !value.projects.every(row => activity(row) && reportId(row.project_id) && text(row.project_number) && text(row.project_name) && amount(row.contract_value)) || !unique(value.projects, row => row.project_id)) return false;
  return Array.isArray(value.clients) && value.clients.every(row => activity(row) && reportId(row.client_id)) && unique(value.clients, row => `${row.client_id}:${row.currency}`);
}
export function reportMatchesFilters(value: unknown, filters: Pick<ReportFilters, "date_from" | "date_to" | "currency">): value is ReportsOverview {
  return isReportsOverview(value) && value.date_from === filters.date_from && value.date_to === filters.date_to && (!filters.currency || [value.financials, value.trend, value.accounts, value.projects, value.clients].every(rows => rows.every(row => row.currency === filters.currency)));
}
export function isReportsMeta(value: unknown): value is ReportsMeta {
  if (!record(value) || !Array.isArray(value.currencies) || !value.currencies.every(currency) || !unique(value.currencies, row => row)) return false;
  return [value.clients, value.projects].every(rows => Array.isArray(rows) && rows.every(row => record(row) && reportId(row.id) && text(row.label)) && unique(rows, row => row.id));
}
export const reportMoney = (value: ReportAmount, code: string) => formatMoneyExact(value, code);
export function reportPercent(value: ReportAmount | null) {
  return value === null ? "—" : `${formatMoneyExact(value, "").trim()}%`;
}
export function reportLabel(options: ReportOption[] | undefined, id: string, all: string) {
  return !id ? all : options?.find(option => option.id === id)?.label || `Selected ID: ${id}`;
}
export function reportOptions(options: ReportOption[] | undefined, selected: string, all: string) {
  const rows = (options || []).map(option => ({ value: option.id, label: option.label }));
  if (selected && !rows.some(option => option.value === selected)) rows.unshift({ value: selected, label: `Selected ID: ${selected} (not in metadata)` });
  return [{ value: "", label: all }, ...rows];
}
/** A separate exact scale for each currency; negative data uses a symmetric zero centre. */
export function trendScale(rows: ReportTrend[], code: string) {
  const values = rows.filter(row => row.currency === code).flatMap(row => trendSeries.map(series => reportDecimal(row[series.key])!));
  const exponent = values.length ? values.reduce((min, value) => Math.min(min, value.exponent), values[0].exponent) : 0;
  const units = (value: ReportAmount) => {
    const decimal = reportDecimal(value);
    return decimal ? decimal.coefficient * TEN ** BigInt(decimal.exponent - Math.min(exponent, decimal.exponent)) : ZERO;
  };
  const magnitudes = values.map(value => value.coefficient * TEN ** BigInt(value.exponent - exponent));
  const negative = magnitudes.some(value => value < ZERO);
  const maximum = magnitudes.reduce((max, value) => { const abs = value < ZERO ? -value : value; return abs > max ? abs : max; }, ZERO);
  return {
    negative,
    zero: negative ? 50 : 0,
    bar(value: ReportAmount) {
      const exact = units(value), magnitude = exact < ZERO ? -exact : exact;
      // Only the bounded visual ratio is converted to Number; displayed money remains exact.
      const ratio = maximum === ZERO ? 0 : Number(magnitude * BigInt(10000) / maximum) / 100;
      const width = Math.min(negative ? 50 : 100, ratio / (negative ? 2 : 1));
      return { left: negative ? exact < ZERO ? 50 - width : 50 : 0, width };
    },
  };
}
