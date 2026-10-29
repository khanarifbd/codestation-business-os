import { transferCents } from "@/components/accounting-transfers/transfer-model";

/** Existing income-with-fee wire contract. Values are frozen, not recalculated here. */
export type ProjectIncomePayload = {
  entry_date: string;
  financial_account_id: string;
  income_category_ledger_account_id: string;
  gross_amount: number;
  fee_amount: number;
  fee_expense_category_id: string | null;
  fee_vendor_id: string | null;
  description: string;
  fee_description: string | null;
  reference: string | null;
  notes: string | null;
  source_type: "project";
  source_id: string;
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const cents = (value: unknown) => typeof value === "string" || typeof value === "number" ? transferCents(value) : null;
const id = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function returnedProjectIncomeId(value: unknown): string | null {
  return record(value) && record(value.income_entry) && id(value.income_entry.id) ? value.income_entry.id : null;
}

/** Correlation only: the original calculation and JSON Number payload remain unchanged. */
export function matchesProjectIncomeReceipt(value: unknown, payload: ProjectIncomePayload, currency: string): boolean {
  if (!record(value) || !record(value.income_entry)) return false;
  const gross = cents(payload.gross_amount), fee = cents(payload.fee_amount);
  if (gross === null || fee === null || value.currency !== currency || cents(value.gross_amount) !== gross || cents(value.fee_amount) !== fee || cents(value.net_amount) !== gross - fee) return false;
  const common = (entry: Record<string, unknown>, kind: string, amount: bigint) =>
    id(entry.id) && entry.kind === kind && entry.currency === currency && cents(entry.amount) === amount &&
    entry.entry_date === payload.entry_date && entry.financial_account_id === payload.financial_account_id &&
    entry.source_type === "project" && entry.source_id === payload.source_id && entry.project_id === payload.source_id &&
    entry.reference === payload.reference && entry.notes === payload.notes;
  const income = value.income_entry;
  if (!common(income, "income", gross) || income.category_ledger_account_id !== payload.income_category_ledger_account_id || income.description !== payload.description) return false;
  if (fee === BigInt(0)) return value.fee_entry === null;
  return record(value.fee_entry) && common(value.fee_entry, "expense", fee) &&
    value.fee_entry.id !== income.id && value.fee_entry.expense_category_id === payload.fee_expense_category_id &&
    value.fee_entry.vendor_id === payload.fee_vendor_id && value.fee_entry.description === payload.fee_description;
}
