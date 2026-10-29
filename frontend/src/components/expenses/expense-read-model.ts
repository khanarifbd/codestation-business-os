import { isExpense as baseExpense } from "@/components/accounting-money-out/money-out-model";
import { transferCents } from "@/components/accounting-transfers/transfer-model";
import type { Category, ExpenseDetail, ExpenseDoc, ExpensePage, ExpenseRow, Meta, Profitability, Summary, Vendor } from "./expense-types";

export const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown) => typeof value === "string" && Boolean(value.trim());
const fields = (value: Record<string, unknown>, keys: string[]) => keys.every(key => text(value[key]));
const nullableText = (value: unknown) => value === null || typeof value === "string";
const money = (value: unknown) => (typeof value === "string" || typeof value === "number") && transferCents(value) !== null;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const rows = (value: unknown, check: (row: unknown) => boolean) => Array.isArray(value) && value.every(check);
const unique = (value: unknown) => Array.isArray(value) && new Set(value.map(row => record(row) ? row.id : undefined)).size === value.length;

export function isVendors(value: unknown): value is Vendor[] {
  return rows(value, row => record(row) && fields(row, ["id", "name", "vendor_code", "created_at", "updated_at"]) && typeof row.is_active === "boolean" && ["contact_name", "email", "phone", "website", "tax_identifier", "country_code", "currency", "notes"].every(key => nullableText(row[key]))) && unique(value);
}
export function isCategories(value: unknown): value is Category[] {
  return rows(value, row => record(row) && fields(row, ["id", "name", "slug", "cost_type", "created_at", "updated_at"]) && typeof row.is_active === "boolean" && count(row.sort_order)) && unique(value);
}
export function isExpenseMeta(value: unknown): value is Meta {
  if (!record(value) || !isVendors(value.vendors) || !isCategories(value.categories)) return false;
  const project = (row: unknown) => record(row) && fields(row, ["id", "number", "name", "order_id", "client_id", "client_name", "currency", "status"]);
  const order = (row: unknown) => record(row) && fields(row, ["id", "number", "client_id", "client_name", "currency", "status"]) && money(row.total);
  const invoice = (row: unknown) => record(row) && fields(row, ["id", "number", "client_id", "client_name", "currency", "status"]) && nullableText(row.order_id) && nullableText(row.project_id) && money(row.total);
  if (!rows(value.accounts, row => record(row) && fields(row, ["id", "name", "currency"]) && money(row.current_balance) && typeof row.is_active === "boolean") || !rows(value.clients, row => record(row) && fields(row, ["id", "code", "name"]) && nullableText(row.currency)) || !rows(value.projects, project) || !rows(value.orders, order) || !rows(value.invoices, invoice) || !rows(value.payments, row => record(row) && fields(row, ["id", "number", "invoice_id", "invoice_number", "client_id", "client_name", "invoice_currency", "payment_date", "status"]) && money(row.invoice_amount))) return false;
  if (![value.accounts, value.clients, value.projects, value.orders, value.invoices, value.payments].every(unique)) return false;
  if (value.relationship_context === undefined) return true;
  const context = value.relationship_context;
  if (!record(context) || !rows(context.invoices, invoice) || !rows(context.projects, project) || !rows(context.orders, order)) return false;
  // A second representation of an ID could hide a conflicting currency/identity.
  return ["invoices", "projects", "orders"].every(key => unique([...(value[key] as unknown[]), ...(context[key] as unknown[])]));
}
export function isExpenseDocument(value: unknown, expenseId: string): value is ExpenseDoc {
  return record(value) && fields(value, ["id", "expense_id", "title", "document_type", "original_filename", "uploaded_by_user_id", "created_at"]) && value.expense_id === expenseId && count(value.size_bytes) && nullableText(value.content_type) && nullableText(value.notes);
}
export function isExpenseRow(value: unknown): value is ExpenseRow {
  if (!record(value)) return false;
  const row: Record<string, unknown> = value;
  return baseExpense(value) && ["posted", "voided"].includes(value.status)
    && fields(row, ["cost_type", "created_at"])
    && ["vendor_name", "client_name", "project_number", "project_name", "order_number", "invoice_number", "payment_number"].every(key => nullableText(row[key]));
}
export function isExpenseDetail(value: unknown): value is ExpenseDetail {
  if (!record(value)) return false;
  const detail: Record<string, unknown> = value;
  return isExpenseRow(value) && money(detail.profitability_exchange_rate) && nullableText(detail.notes) && nullableText(detail.voided_at) && rows(detail.documents, row => isExpenseDocument(row, value.id)) && unique(detail.documents);
}
export function isExpensePage(value: unknown): value is ExpensePage {
  return record(value) && rows(value.items, isExpenseRow) && unique(value.items) && (value.next_cursor === null || typeof value.next_cursor === "string" && Boolean(value.next_cursor.trim()));
}
export function isExpenseSummary(value: unknown): value is Summary {
  return record(value) && ["expense_count", "posted_count", "voided_count", "vendor_count", "receipt_count", "project_expense_count"].every(key => count(value[key])) && rows(value.by_currency, row => record(row) && fields(row, ["currency"]) && money(row.posted_expenses) && money(row.transfer_fees) && (row.stripe_processing_fees === undefined || money(row.stripe_processing_fees)));
}
export function isProfitability(value: unknown): value is Profitability {
  if (!record(value)) return false;
  const financial = (row: Record<string, unknown>, keys: string[]) => keys.every(key => money(row[key]));
  return rows(value.profit_loss_by_currency, row => record(row) && text(row.currency) && financial(row, ["invoice_revenue", "operating_expenses", "transfer_fees", "net_profit"]) && (row.stripe_processing_fees === undefined || money(row.stripe_processing_fees)))
    && rows(value.projects, row => record(row) && fields(row, ["project_id", "project_number", "project_name", "client_name", "currency"]) && financial(row, ["contract_value", "invoiced_revenue", "collected_revenue", "direct_expenses", "estimated_profit"]) && (row.margin_percent === null || money(row.margin_percent)))
    && rows(value.clients, row => record(row) && fields(row, ["client_id", "client_name", "currency"]) && financial(row, ["invoiced_revenue", "collected_revenue", "direct_expenses", "estimated_profit"]) && (row.margin_percent === null || money(row.margin_percent)));
}
