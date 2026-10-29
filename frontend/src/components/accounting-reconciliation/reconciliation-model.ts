import { transferCents } from "@/components/accounting-transfers/transfer-model";
import { centsText, decimalInput } from "@/components/accounting-money-out/money-out-model";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import type { ReconciliationAccount, ReconciliationBrowse, ReconciliationDetail, ReconciliationMeta, ReconciliationSelection, ReconciliationSession, ReconciliationTransaction, ReconciliationValues } from "./reconciliation-types";

export const reconciliationMoney = formatMoneyExact;
export const RECONCILIATION_LIST_CAP = 200, RECONCILIATION_TRANSACTION_CAP = 2000, RECONCILIATION_PAGE_SIZE = 20;
export const blankReconciliation = (): ReconciliationValues => ({ account_id: "", statement_end_date: "", statement_ending_balance: "", notes: "" });
export const reconciliationRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string";
export const reconciliationIdentity = (value: unknown): value is string => text(value) && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const id = reconciliationIdentity;
const nullableText = (value: unknown) => value === null || text(value);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const currency = (value: unknown): value is string => text(value) && /^[A-Z]{3}$/.test(value);
export function reconciliationDate(value: unknown): value is string {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Reuse the exact lexical decimal parser, adding the signed balances this contract supports. */
export function signedStatementAmount(value: string): string | null {
  const raw = value.trim(), negative = raw.startsWith("-");
  if (negative && raw[1] === "+") return null;
  const magnitude = decimalInput(negative ? raw.slice(1) : raw);
  return magnitude === null ? null : (negative ? "-" : "") + magnitude;
}
const MAX_CENTS = BigInt("999999999999999999"); // Existing Numeric(18, 2), not the smaller sales limit.
function amount(value: unknown): value is string | number {
  if (!text(value) && (typeof value !== "number" || !Number.isFinite(value))) return false;
  const canonical = signedStatementAmount(String(value));
  if (canonical === null || (canonical.split(".")[1]?.length || 0) > 2) return false;
  const cents = transferCents(canonical);
  return cents !== null && cents <= MAX_CENTS && cents >= -MAX_CENTS;
}
export function isReconciliationAccount(value: unknown): value is ReconciliationAccount {
  return reconciliationRecord(value) && id(value.id) && text(value.name) && text(value.account_type) && currency(value.currency)
    && (value.last_reconciled_date === null || reconciliationDate(value.last_reconciled_date))
    && (value.last_statement_balance === null || amount(value.last_statement_balance));
}
export function isReconciliationMeta(value: unknown): value is ReconciliationMeta {
  return reconciliationRecord(value) && Array.isArray(value.accounts) && value.accounts.every(isReconciliationAccount)
    && new Set(value.accounts.map(row => row.id)).size === value.accounts.length;
}
export function isReconciliationSession(value: unknown): value is ReconciliationSession {
  if (!reconciliationRecord(value) || !id(value.id) || !id(value.account_id) || !text(value.account_name) || !currency(value.currency)
    || value.statement_start_date !== null && !reconciliationDate(value.statement_start_date) || !reconciliationDate(value.statement_end_date)
    || typeof value.statement_start_date === "string" && value.statement_start_date > value.statement_end_date
    || !amount(value.statement_ending_balance) || !amount(value.cleared_book_balance) || !amount(value.difference)
    || value.status !== "draft" && value.status !== "finalized" || !count(value.matched_transactions)
    || !nullableText(value.notes) || !nullableText(value.finalized_at) || !text(value.created_at)) return false;
  return transferCents(value.statement_ending_balance)! - transferCents(value.cleared_book_balance)! === transferCents(value.difference);
}
export function isReconciliationList(value: unknown): value is ReconciliationSession[] {
  return Array.isArray(value) && value.length <= RECONCILIATION_LIST_CAP && value.every(isReconciliationSession)
    && new Set(value.map(row => row.id)).size === value.length;
}
export function isReconciliationTransaction(value: unknown): value is ReconciliationTransaction {
  return reconciliationRecord(value) && id(value.id) && reconciliationDate(value.transaction_date)
    && (value.direction === "credit" || value.direction === "debit") && amount(value.amount) && transferCents(value.amount)! >= BigInt(0)
    && currency(value.currency) && text(value.source_type) && nullableText(value.reference) && nullableText(value.description) && typeof value.selected === "boolean";
}
export function isReconciliationDetail(value: unknown): value is ReconciliationDetail {
  if (!reconciliationRecord(value)) return false;
  const rows = value.transactions, unmatched = value.unmatched_count;
  if (!isReconciliationSession(value)) return false;
  return Array.isArray(rows) && rows.length <= RECONCILIATION_TRANSACTION_CAP && rows.every(isReconciliationTransaction)
    && rows.every(row => row.currency === value.currency && row.transaction_date <= value.statement_end_date)
    && new Set(rows.map(row => row.id)).size === rows.length && count(unmatched)
    && unmatched === rows.filter(row => !row.selected).length;
}
export function reconciliationPreview(values: ReconciliationValues, meta: ReconciliationMeta | null) {
  const account = meta?.accounts.find(row => row.id === values.account_id) || null;
  const raw = signedStatementAmount(values.statement_ending_balance), cents = raw === null ? null : transferCents(raw);
  let error: string | null = null;
  if (!meta) error = "Load verified reconciliation accounts before continuing.";
  else if (!account) error = "Choose an account returned by the current company’s reconciliation setup.";
  else if (!reconciliationDate(values.statement_end_date)) error = "Enter a valid statement end date.";
  else if (account.last_reconciled_date && values.statement_end_date <= account.last_reconciled_date) error = `The statement end must follow ${account.last_reconciled_date}. The server checks this again.`;
  else if (cents === null || cents > MAX_CENTS || cents < -MAX_CENTS) error = "Enter a signed statement balance that fits 16 whole digits and 2 decimal places after rounding.";
  return { account, error, roundedBalance: cents === null ? null : centsText(cents) };
}
export function reconciliationCreateBody(values: ReconciliationValues) {
  // Keep the original API payload. Start date remains server-derived; notes are not silently trimmed.
  return JSON.stringify({ account_id: values.account_id, statement_end_date: values.statement_end_date, statement_ending_balance: values.statement_ending_balance, notes: values.notes || null });
}
export function matchesCreatedReconciliation(row: ReconciliationSession, values: ReconciliationValues, account: ReconciliationAccount) {
  return row.account_id === account.id && row.currency === account.currency && row.statement_end_date === values.statement_end_date
    && transferCents(row.statement_ending_balance) === transferCents(signedStatementAmount(values.statement_ending_balance) || "")
    && row.notes === (values.notes || null);
}
export function reconciliationFiltered(rows: ReconciliationSession[], browse: ReconciliationBrowse) {
  const search = browse.search.trim().toLocaleLowerCase();
  return rows.filter(row => (!browse.status || row.status === browse.status) && (!browse.account || row.account_id === browse.account)
    && (!search || [row.account_name, row.currency, row.statement_end_date, row.notes || "", row.id].some(value => value.toLocaleLowerCase().includes(search))));
}
export function reconciliationTransactions(rows: ReconciliationTransaction[], filter: ReconciliationSelection) {
  const search = filter.search.trim().toLocaleLowerCase();
  return rows.filter(row => (filter.filter === "all" || row.selected === (filter.filter === "matched"))
    && (!search || [row.transaction_date, row.reference || "", row.description || "", row.source_type, row.id].some(value => value.toLocaleLowerCase().includes(search))));
}
export function reconciliationPage<T>(rows: T[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / RECONCILIATION_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * RECONCILIATION_PAGE_SIZE, current * RECONCILIATION_PAGE_SIZE), page: current, pages, filteredCount: rows.length };
}
export const reconciliationZero = (value: string | number) => transferCents(value) === BigInt(0);
/** Only explicit application rejections release an unkeyed request. Timeouts,
 * rate-limit intermediaries and unknown statuses are not proof of no commit. */
export const reconciliationWriteRejected = (status: number) => [400, 401, 403, 404, 409, 422].includes(status);
