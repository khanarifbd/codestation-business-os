import { formatMoneyExact } from "@/lib/sales-money-preview";

export type StatementRow = { code: string; name: string; amount: string | number };
export type FinancialStatements = {
  base_currency: string; accounting_currency: string; reporting_currency: string;
  reporting_rate: string | number | null; reporting_rate_applied: boolean; reporting_note: string | null;
  functional_period_start: string; functional_period_end: string | null; date_from: string; date_to: string;
  income: StatementRow[]; expenses: StatementRow[]; assets: StatementRow[]; liabilities: StatementRow[]; equity: StatementRow[];
  total_income: string | number; total_expenses: string | number; net_profit: string | number;
  total_assets: string | number; total_liabilities: string | number; recorded_equity: string | number;
  current_earnings: string | number; total_equity: string | number; total_liabilities_and_equity: string | number;
  cash_flow: { operating: string | number; investing: string | number; financing: string | number; net_change: string | number };
};
export type StatementAccount = { id: string; name: string; account_type: string; currency: string; current_balance: string | number; is_active: boolean };
export type StatementMovement = { id: string; transaction_date: string; direction: "credit" | "debit"; amount: string | number; currency: string; source_type: string; source_id: string; reference: string | null; description: string | null; created_at: string };
export type StatementLedger = { items: StatementMovement[]; next_cursor: string | null };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string";
const nullable = (value: unknown) => value === null || text(value);
const code = (value: unknown): value is string => text(value) && /^[A-Z]{3}$/.test(value);
export const statementId = (value: unknown): value is string => text(value) && /^[A-Za-z0-9_-]{1,200}$/.test(value);
export function statementDate(value: unknown): value is string {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Exact read-side decimals, including Pydantic Decimal exponent notation; never round a read. */
export function statementScaled(value: unknown, digits = 2): bigint | null {
  if (!Number.isInteger(digits) || digits < 0 || digits > 8) return null;
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value);
  if (raw.length > 90) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(raw);
  if (!match) return null;
  const exponent = BigInt(match[4] || "0"), fraction = match[3] || "";
  if (exponent < -BigInt(90) || exponent > BigInt(90)) return null;
  const coefficient = BigInt(match[2] + fraction), shift = BigInt(digits) + exponent - BigInt(fraction.length);
  if (coefficient === BigInt(0)) return BigInt(0);
  // Bounded expansion, not a single stored row's range: large report aggregates remain exact.
  // The normalized monetary string stays below the shared formatter's 100-character limit.
  if (BigInt(coefficient.toString().length) + shift > BigInt(90 + digits)) return null;
  const scale = BigInt(10) ** (shift < BigInt(0) ? -shift : shift);
  if (shift < BigInt(0) && coefficient % scale !== BigInt(0)) return null;
  return (match[1] ? -BigInt(1) : BigInt(1)) * (shift < BigInt(0) ? coefficient / scale : coefficient * scale);
}
export function statementCentsText(value: bigint) {
  const magnitude = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "-" : ""}${magnitude / BigInt(100)}.${String(magnitude % BigInt(100)).padStart(2, "0")}`;
}
export function statementMoney(value: unknown, currency: string) {
  const cents = statementScaled(value);
  return cents === null || !code(currency) ? "—" : formatMoneyExact(statementCentsText(cents), currency);
}
export function statementDifference(data: FinancialStatements) {
  return statementCentsText(statementScaled(data.total_assets)! - statementScaled(data.total_liabilities_and_equity)!);
}
const sum = (rows: StatementRow[]) => rows.reduce((total, row) => total + statementScaled(row.amount)!, BigInt(0));
function isRows(value: unknown): value is StatementRow[] {
  return Array.isArray(value) && value.every(row => record(row) && text(row.code) && text(row.name) && statementScaled(row.amount) !== null)
    && new Set(value.map(row => row.code)).size === value.length;
}
export function isFinancialStatements(value: unknown): value is FinancialStatements {
  if (!record(value) || !["base_currency", "accounting_currency", "reporting_currency"].every(key => code(value[key]))
    || typeof value.reporting_rate_applied !== "boolean" || !nullable(value.reporting_note)
    || !(value.reporting_rate === null || statementScaled(value.reporting_rate, 8) !== null && statementScaled(value.reporting_rate, 8)! > BigInt(0))
    || !statementDate(value.functional_period_start) || !(value.functional_period_end === null || statementDate(value.functional_period_end))
    || !statementDate(value.date_from) || !statementDate(value.date_to) || value.date_from > value.date_to
    || value.date_from < value.functional_period_start || value.functional_period_end !== null && value.date_to > String(value.functional_period_end)
    || !["income", "expenses", "assets", "liabilities", "equity"].every(key => isRows(value[key]))
    || !["total_income", "total_expenses", "net_profit", "total_assets", "total_liabilities", "recorded_equity", "current_earnings", "total_equity", "total_liabilities_and_equity"].every(key => statementScaled(value[key]) !== null)
    || !record(value.cash_flow) || !["operating", "investing", "financing", "net_change"].every(key => statementScaled((value.cash_flow as Record<string, unknown>)[key]) !== null)) return false;
  const data = value as unknown as FinancialStatements, cents = statementScaled;
  if (data.reporting_rate_applied ? data.reporting_rate === null || data.base_currency !== data.reporting_currency
    : data.base_currency !== data.accounting_currency || data.reporting_rate !== null) return false;
  return sum(data.income) === cents(data.total_income) && sum(data.expenses) === cents(data.total_expenses)
    && cents(data.net_profit) === cents(data.total_income)! - cents(data.total_expenses)!
    && sum(data.assets) === cents(data.total_assets) && sum(data.liabilities) === cents(data.total_liabilities)
    && sum(data.equity) === cents(data.recorded_equity) && cents(data.total_equity) === cents(data.recorded_equity)! + cents(data.current_earnings)!
    && cents(data.total_liabilities_and_equity) === cents(data.total_liabilities)! + cents(data.total_equity)!
    && cents(data.cash_flow.net_change) === cents(data.cash_flow.operating)! + cents(data.cash_flow.investing)! + cents(data.cash_flow.financing)!;
}
export function statementMatchesPeriod(data: FinancialStatements, from: string, to: string) {
  if (from && to) return data.date_from === (from < to ? from : to) && data.date_to === (from < to ? to : from);
  if (to) return data.date_to === to;
  // A future explicit start can be swapped with the server's organization-local default end.
  return !from || data.date_from === from || data.date_to === from;
}
export function isStatementAccounts(value: unknown): value is StatementAccount[] {
  return Array.isArray(value) && value.every(row => record(row) && statementId(row.id) && text(row.name) && text(row.account_type)
    && code(row.currency) && statementScaled(row.current_balance) !== null && typeof row.is_active === "boolean")
    && new Set(value.map(row => row.id)).size === value.length;
}
export function isStatementLedger(value: unknown): value is StatementLedger {
  return record(value) && (value.next_cursor === null || text(value.next_cursor) && value.next_cursor.length > 0 && value.next_cursor.length < 4096)
    && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(row => record(row) && statementId(row.id)
      && statementDate(row.transaction_date) && ["credit", "debit"].includes(String(row.direction)) && statementScaled(row.amount) !== null && statementScaled(row.amount)! >= BigInt(0)
      && code(row.currency) && text(row.source_type) && text(row.source_id) && nullable(row.reference) && nullable(row.description)
      && text(row.created_at) && Number.isFinite(Date.parse(row.created_at)))
    && new Set(value.items.map(row => row.id)).size === value.items.length;
}
export function movementMeaning(account: StatementAccount, direction: "credit" | "debit") {
  return account.account_type === "credit_card" ? direction === "credit" ? "Charge / increase owed" : "Payment / decrease owed" : direction === "credit" ? "Money in" : "Money out";
}
export const statementLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
