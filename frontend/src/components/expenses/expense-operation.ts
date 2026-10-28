import { transferCents } from "@/components/accounting-transfers/transfer-model";
import { decimalInput } from "@/components/accounting-money-out/money-out-model";
import { expensePayload, type expensePreview } from "./expense-model";
import type { ExpenseDetail, ExpenseForm } from "./expense-types";

export type ExpenseOperation = {
  key: string;
  body: string;
  expected: {
    currency: string; accountCurrency: string; profitabilityCurrency: string;
    gross: string; tax: string; deduction: string; profitability: string; rate: string; profitabilityRate: string;
    clientId: string | null; projectId: string | null; orderId: string | null; invoiceId: string | null; paymentId: string | null;
  };
};
export function prepareExpenseOperation(values: ExpenseForm, preview: ReturnType<typeof expensePreview>, key: string): ExpenseOperation {
  if (!key || !preview.amounts || !preview.account || !preview.relationship.currency) throw new Error("Verified expense context and a retry key are required.");
  const payload = expensePayload(values, preview), relation = preview.relationship;
  return { key, body: JSON.stringify(payload), expected: {
    currency: preview.currency, accountCurrency: preview.account.currency, profitabilityCurrency: relation.currency!,
    gross: preview.amounts.gross, tax: preview.amounts.tax, deduction: preview.amounts.deduction, profitability: preview.amounts.profitability, rate: preview.amounts.rate, profitabilityRate: preview.amounts.profitabilityRate,
    clientId: relation.clientId || null, projectId: relation.project?.id || null, orderId: relation.order?.id || null, invoiceId: relation.invoice?.id || null, paymentId: relation.payment?.id || null,
  } };
}
/** Compare immutable posting facts. Metadata may be edited and status may be
 * voided before an idempotent replay; neither changes the original ledger facts. */
export function matchesExpenseOperation(document: ExpenseDetail, operation: ExpenseOperation) {
  const payload = JSON.parse(operation.body) as ReturnType<typeof expensePayload>, e = operation.expected;
  return document.account_id === payload.account_id
    && document.client_id === e.clientId && document.project_id === e.projectId && document.order_id === e.orderId && document.invoice_id === e.invoiceId && document.payment_id === e.paymentId
    && document.expense_currency === e.currency && document.account_currency === e.accountCurrency && document.profitability_currency === e.profitabilityCurrency
    && (!payload.expense_date || document.expense_date === payload.expense_date)
    && decimalInput(String(document.exchange_rate)) === decimalInput(e.rate) && decimalInput(String(document.profitability_exchange_rate)) === decimalInput(e.profitabilityRate)
    && [[document.expense_amount,e.gross],[document.tax_amount,e.tax],[document.account_amount,e.deduction],[document.profitability_amount,e.profitability]].every(([actual,expected]) => transferCents(actual) === transferCents(expected));
}
