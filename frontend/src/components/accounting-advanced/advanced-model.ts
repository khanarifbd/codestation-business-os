import { transferCents } from "@/components/accounting-transfers/transfer-model";
import { centsText, decimalInput } from "@/components/accounting-money-out/money-out-model";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import { categories, correctionTypes } from "./advanced-types";
import type { AccountForm, AdjustmentForm, Candidate, Category, CorrectionHistory, CorrectionResult, CorrectionType, Journal, LedgerAccount, TrialBalance } from "./advanced-types";

export const advancedMoney = formatMoneyExact;
export const advancedCents = transferCents;
export const ADVANCED_PAGE_SIZE = 20, JOURNAL_CAP = 200, CANDIDATE_CAP = 200, HISTORY_CAP = 100;
const MAX_STORED = BigInt("999999999999999999");
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const text = (v: unknown): v is string => typeof v === "string";
const present = (v: unknown): v is string => text(v) && v.trim().length > 0;
const nullable = (v: unknown) => v === null || text(v);
const currency = (v: unknown): v is string => text(v) && /^[A-Z]{3}$/.test(v);
export const advancedId = (v: unknown): v is string => text(v) && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const nullableId = (v: unknown) => v === null || advancedId(v);
const category = (v: unknown): v is Category => text(v) && categories.includes(v as Category);
export const correctionType = (v: unknown): v is CorrectionType => text(v) && correctionTypes.some(t => t.value === v);
export const pretty = (v: string | null | undefined) => v ? v.replaceAll("_", " ").replace(/\b\w/g, s => s.toUpperCase()) : "—";
export function advancedDate(v: unknown): v is string {
  if (!text(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith("0000-")) return false;
  const parsed = new Date(v + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}
/** Read decimals must already fit the declared scale; never round malformed DTOs into valid reports. */
function scaled(v: unknown, digits: number): bigint | null {
  if (!text(v) && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER)) return null;
  const raw = String(v).trim(), negative = raw.startsWith("-");
  const canonical = decimalInput(negative ? raw.slice(1) : raw);
  if (canonical === null || negative && raw[1] === "+") return null;
  const [whole, fraction = ""] = canonical.split(".");
  if (fraction.length > digits) return null;
  return (negative ? -BigInt(1) : BigInt(1)) * (BigInt(whole) * BigInt(10) ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0"));
}
function amount(v: unknown, { signed = false, stored = false, positive = false } = {}) {
  const n = scaled(v, 2);
  return n !== null && (signed || n >= BigInt(0)) && (!positive || n > BigInt(0)) && (!stored || n <= MAX_STORED && n >= -MAX_STORED);
}
function rate(v: unknown) { const n = scaled(v, 8); return n !== null && n > BigInt(0) && n <= MAX_STORED; }
export function advancedRate(v: string | number) {
  const n = scaled(v, 8); if (n === null) return "—";
  const sign = n < BigInt(0) ? "-" : "", a = n < BigInt(0) ? -n : n;
  return `${sign}${a / BigInt(100000000)}.${String(a % BigInt(100000000)).padStart(8, "0")}`;
}
const unique = <T,>(rows: T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length;
export function isLedger(v: unknown): v is LedgerAccount {
  return record(v) && advancedId(v.id) && present(v.code) && present(v.name) && category(v.category)
    && (v.normal_balance === "debit" || v.normal_balance === "credit") && nullableId(v.parent_id)
    && ["subtype", "system_key", "notes"].every(k => nullable(v[k]))
    && ["is_system", "is_active", "allow_manual_posting"].every(k => typeof v[k] === "boolean");
}
export function isLedgerList(v: unknown): v is LedgerAccount[] { return Array.isArray(v) && v.every(isLedger) && unique(v, row => row.id); }
export function isTrial(v: unknown): v is TrialBalance {
  if (!record(v) || v.as_of !== null && !advancedDate(v.as_of) || !currency(v.accounting_currency) || !advancedDate(v.functional_period_start)
    || !amount(v.total_debit) || !amount(v.total_credit) || !Array.isArray(v.rows)) return false;
  const rows = v.rows;
  if (!rows.every(row => record(row) && advancedId(row.ledger_account_id) && present(row.code) && present(row.name) && category(row.category)
    && amount(row.debit) && amount(row.credit) && amount(row.balance, { signed: true })
    && scaled(row.debit, 2)! - scaled(row.credit, 2)! === scaled(row.balance, 2)) || !unique(rows, row => row.ledger_account_id)) return false;
  return rows.reduce((sum, row) => sum + scaled(row.debit, 2)!, BigInt(0)) === scaled(v.total_debit, 2)
    && rows.reduce((sum, row) => sum + scaled(row.credit, 2)!, BigInt(0)) === scaled(v.total_credit, 2);
}
function isLine(v: unknown): v is Journal["lines"][number] {
  if (!record(v) || !advancedId(v.id) || !advancedId(v.ledger_account_id) || !present(v.account_code) || !present(v.account_name) || !nullable(v.description)
    || !currency(v.currency) || !rate(v.exchange_rate_to_base) || !amount(v.original_amount, { stored: true, positive: true })
    || !amount(v.debit, { stored: true }) || !amount(v.credit, { stored: true })) return false;
  return (scaled(v.debit, 2)! > BigInt(0)) !== (scaled(v.credit, 2)! > BigInt(0));
}
export function isJournal(v: unknown): v is Journal {
  if (!record(v) || !advancedId(v.id) || !present(v.entry_number) || !advancedDate(v.entry_date) || !currency(v.functional_currency)
    || !present(v.status) || !present(v.source_type) || !nullableId(v.source_id) || !nullable(v.reference) || !nullable(v.memo)
    || !present(v.created_at) || !present(v.posted_at) || !amount(v.total_debit) || !amount(v.total_credit)
    || !Array.isArray(v.lines) || !v.lines.every(isLine) || !unique(v.lines, row => row.id)) return false;
  // Keep an actual unbalanced report visible; do not silently manufacture balance or an eligibility flag.
  return v.lines.reduce((sum, row) => sum + scaled(row.debit, 2)!, BigInt(0)) === scaled(v.total_debit, 2)
    && v.lines.reduce((sum, row) => sum + scaled(row.credit, 2)!, BigInt(0)) === scaled(v.total_credit, 2);
}
export function isJournalList(v: unknown): v is Journal[] { return Array.isArray(v) && v.length <= JOURNAL_CAP && v.every(isJournal) && unique(v, row => row.id); }
export function isCandidateList(v: unknown): v is Candidate[] {
  return Array.isArray(v) && v.length <= CANDIDATE_CAP && v.every(row => record(row) && correctionType(row.source_type) && advancedId(row.source_id)
    && present(row.number) && advancedDate(row.date) && amount(row.amount, { stored: true }) && currency(row.currency) && present(row.title) && text(row.subtitle))
    && unique(v, row => `${row.source_type}:${row.source_id}`);
}
export function isHistoryList(v: unknown): v is CorrectionHistory[] {
  return Array.isArray(v) && v.length <= HISTORY_CAP && v.every(row => record(row) && advancedId(row.id) && present(row.source_type)
    && nullableId(row.source_id) && present(row.action) && nullable(row.message) && nullable(row.reason)
    && (row.reversal_date === null || advancedDate(row.reversal_date)) && nullableId(row.reversal_journal_id) && present(row.status)
    && nullableId(row.actor_user_id) && present(row.created_at)) && unique(v, row => row.id);
}
export function isCorrectionResult(v: unknown): v is CorrectionResult {
  return record(v) && correctionType(v.source_type) && advancedId(v.source_id) && present(v.number) && advancedDate(v.reversal_date)
    && nullableId(v.reversal_journal_id) && text(v.accounting_note);
}
export function ledgerPayload(form: AccountForm, accounts: LedgerAccount[] | null) {
  const code = form.code.trim().toUpperCase(), name = form.name.trim(), subtype = form.subtype.trim();
  let error: string | null = null;
  if (!accounts) error = "Load the current company’s chart before creating an account.";
  else if (!code || code.length > 32 || !name || name.length > 180 || subtype.length > 48) error = "Enter a code (1–32 characters), name (1–180) and optional subtype (up to 48).";
  else if (!category(form.category) || !["debit", "credit"].includes(form.normal_balance) || typeof form.allow_manual_posting !== "boolean") error = "Choose a valid category, normal balance and posting setting.";
  else if (form.parent_id && !accounts.some(a => a.id === form.parent_id && a.category === form.category && a.is_active)) error = "Choose an active parent from the same category, or leave parent blank.";
  const body = { code, name, category: form.category, subtype: subtype || null, normal_balance: form.normal_balance, parent_id: form.parent_id || null, allow_manual_posting: form.allow_manual_posting, notes: form.notes.trim() || null };
  return { error, body: error ? null : body };
}
export function adjustmentPayload(form: AdjustmentForm, accounts: LedgerAccount[] | null) {
  const raw = decimalInput(form.amount), cents = raw === null ? null : transferCents(raw);
  const debit = accounts?.find(a => a.id === form.debit_account_id), credit = accounts?.find(a => a.id === form.credit_account_id);
  let error: string | null = null;
  if (!accounts) error = "Load verified ledger accounts before posting an adjustment.";
  else if (!advancedDate(form.entry_date) || !currency(form.currency)) error = "Choose a valid posting date and three-letter currency.";
  else if (!debit || !credit || debit.id === credit.id || ![debit, credit].every(a => a.is_active && a.allow_manual_posting)) error = "Choose two different active accounts that allow manual posting.";
  else if (cents === null || cents <= BigInt(0) || cents > MAX_STORED) error = "The positive amount must fit 16 whole digits and 2 decimal places after rounding.";
  else if (!form.memo.trim() || form.memo.trim().length > 500 || form.reference.length > 180) error = "Enter an adjustment reason (1–500 characters) and a reference of at most 180 characters.";
  const value = cents === null ? "" : centsText(cents), memo = form.memo.trim();
  // Existing two-line protocol: rate1 asks the backend to resolve foreign conversion by date.
  const body = { entry_date: form.entry_date, reference: form.reference || null, memo, lines: [
    { ledger_account_id: form.debit_account_id, description: memo, currency: form.currency, exchange_rate_to_base: 1, debit: value, credit: "0", original_amount: value },
    { ledger_account_id: form.credit_account_id, description: memo, currency: form.currency, exchange_rate_to_base: 1, debit: "0", credit: value, original_amount: value },
  ] };
  return { error, body: error ? null : body };
}
const cleaned = (value: string | null) => value?.trim() || null;
/** Acknowledgement is separate from identity verification; never navigate to a different saved account. */
export function ledgerMatchesPayload(value: unknown, body: NonNullable<ReturnType<typeof ledgerPayload>["body"]>): value is LedgerAccount {
  return isLedger(value) && value.code === body.code.trim().toUpperCase() && value.name === body.name.trim()
    && value.category === body.category && value.subtype === cleaned(body.subtype) && value.normal_balance === body.normal_balance
    && value.parent_id === body.parent_id && value.allow_manual_posting === body.allow_manual_posting && value.notes === cleaned(body.notes);
}
/** Match source amounts and directions; the server alone resolves functional-currency amounts and FX. */
export function adjustmentMatchesPayload(value: unknown, body: NonNullable<ReturnType<typeof adjustmentPayload>["body"]>): value is Journal {
  if (!isJournal(value) || value.source_type !== "manual" || value.status !== "posted" || value.source_id !== null
    || value.entry_date !== body.entry_date || value.reference !== cleaned(body.reference) || value.memo !== cleaned(body.memo)
    || value.lines.length !== 2 || body.lines.length !== 2 || scaled(value.total_debit, 2) !== scaled(value.total_credit, 2)) return false;
  const remaining = [...value.lines];
  return body.lines.every(expected => {
    const index = remaining.findIndex(line => line.ledger_account_id === expected.ledger_account_id
      && line.description === cleaned(expected.description) && line.currency === expected.currency.toUpperCase()
      && scaled(line.original_amount, 2) === scaled(expected.original_amount, 2)
      && (scaled(line.debit, 2)! > BigInt(0)) === (scaled(expected.debit, 2)! > BigInt(0))
      && (scaled(line.credit, 2)! > BigInt(0)) === (scaled(expected.credit, 2)! > BigInt(0)));
    if (index < 0) return false;
    remaining.splice(index, 1); return true;
  });
}
/** Existing reversal copies original currency/rate/amounts and swaps sides without selecting a new date. */
export function journalReversalMatches(value: unknown, original: Journal): value is Journal {
  if (!isJournal(value) || !isJournal(original) || value.id === original.id || value.status !== "posted" || value.source_type !== "reversal"
    || value.source_id !== original.id || value.entry_date !== original.entry_date || value.functional_currency !== original.functional_currency
    || value.reference !== original.reference || value.memo !== `Reversal of ${original.entry_number}` || value.lines.length !== original.lines.length
    || scaled(value.total_debit, 2) !== scaled(original.total_credit, 2) || scaled(value.total_credit, 2) !== scaled(original.total_debit, 2)) return false;
  const remaining = [...value.lines];
  return original.lines.every(expected => {
    const index = remaining.findIndex(line => line.ledger_account_id === expected.ledger_account_id
      && line.description === `Reversal: ${expected.description || original.entry_number}` && line.currency === expected.currency
      && scaled(line.exchange_rate_to_base, 8) === scaled(expected.exchange_rate_to_base, 8)
      && scaled(line.original_amount, 2) === scaled(expected.original_amount, 2)
      && scaled(line.debit, 2) === scaled(expected.credit, 2) && scaled(line.credit, 2) === scaled(expected.debit, 2));
    if (index < 0) return false;
    remaining.splice(index, 1); return true;
  });
}
export function sourceHref(item: Pick<CorrectionHistory, "source_type">) {
  if (item.source_type === "expense" || item.source_type === "money_entry") return "/dashboard/accounting/money-out";
  if (item.source_type === "customer_advance" || item.source_type === "customer_advance_application") return "/dashboard/accounting/money-in";
  if (item.source_type === "transfer") return "/dashboard/accounting/transfers";
  if (item.source_type === "payable_payment") return "/dashboard/accounting/payables";
  if (item.source_type === "loan_disbursement" || item.source_type === "loan_repayment") return "/dashboard/accounting/loans";
  if (item.source_type === "fixed_asset" || item.source_type === "asset_depreciation") return "/dashboard/accounting/assets";
  if (item.source_type === "tax_settlement") return "/dashboard/accounting/tax";
  if (item.source_type === "payroll_withholding_payment" || item.source_type === "payroll_run") return "/dashboard/payroll";
  if (item.source_type === "owner_equity") return "/dashboard/capital";
  return "/dashboard/accounting/invoices";
}
export function pageRows<T>(rows: T[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / ADVANCED_PAGE_SIZE));
  const current = Math.min(Number.isSafeInteger(page) && page > 0 ? page : 1, pages);
  return { rows: rows.slice((current - 1) * ADVANCED_PAGE_SIZE, current * ADVANCED_PAGE_SIZE), page: current, pages, total: rows.length };
}
