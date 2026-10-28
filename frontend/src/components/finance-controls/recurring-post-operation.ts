/** The existing manual recurring-post API, not the separate Auto Post retry action. */
export type RecurringPostPayload = {
  expense_date: string | null; expense_amount: string | null;
  account_amount: string | null; profitability_amount: string | null;
  reference: string | null; notes: string | null;
};
export type RecurringPostTarget = {
  id: string; name: string; is_active: boolean; next_due_date: string;
  expense_amount: string | number; expense_currency: string;
  account_name: string; account_currency: string;
  project_id: string | null; client_id: string | null;
  reference: string | null; notes: string | null;
};
export type RecurringPostOperation = {
  scope: string; key: string; path: string; body: string;
  target: RecurringPostTarget;
};
export type RecurringPostReceipt = {
  expense_id: string; expense_number: string; posted_date: string;
  next_due_date: string; is_active: boolean;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function recurringPostId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\u0000-\u0020/\\?#]/.test(value) && value !== "." && value !== "..";
}
function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function recurringPostBody(payload: RecurringPostPayload) {
  // Preserve the six existing fields, nulls and decimal strings; never derive a retry from fresh defaults.
  return JSON.stringify({ expense_date: payload.expense_date, expense_amount: payload.expense_amount,
    account_amount: payload.account_amount, profitability_amount: payload.profitability_amount,
    reference: payload.reference, notes: payload.notes });
}
export function prepareRecurringPost(scope: string, target: RecurringPostTarget, body: string, key: string): RecurringPostOperation {
  if (!scope || !recurringPostId(target.id) || !target.is_active || key.length < 8 || key.length > 128) throw new Error("Verified schedule, workspace and operation key are required.");
  return { scope, key, path: `/api/finance-controls/recurring-expenses/${encodeURIComponent(target.id)}/post`, body, target: { ...target } };
}
export function recurringPostReceipt(value: unknown, operation: RecurringPostOperation): RecurringPostReceipt | null {
  if (!object(value) || !object(value.recurring_expense) || value.recurring_expense.id !== operation.target.id
    || !recurringPostId(value.expense_id) || typeof value.expense_number !== "string" || !value.expense_number.trim()
    || !date(value.posted_date) || !date(value.next_due_date) || typeof value.is_active !== "boolean") return null;
  const sent = JSON.parse(operation.body) as RecurringPostPayload;
  if (sent.expense_date && value.posted_date !== sent.expense_date) return null;
  // Replay returns the ORIGINAL expense and CURRENT schedule. Never compare its new due date/active flag with the old snapshot.
  return { expense_id: value.expense_id, expense_number: value.expense_number, posted_date: value.posted_date, next_due_date: value.next_due_date, is_active: value.is_active };
}
