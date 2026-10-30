export type FinanceSummary = {
  invoice_count: number; draft_count: number; sent_count: number; partially_paid_count: number; paid_count: number; overdue_count: number; payment_count: number; account_count: number;
  by_currency: { currency: string; invoiced: string | number; paid: string | number; outstanding: string | number }[];
};
export function verifiedFinanceSummary(value: unknown): FinanceSummary {
  const error = () => new Error("Company-wide finance summary could not be verified. Retry this read.");
  if (!value || typeof value !== "object") throw error();
  const v = value as FinanceSummary;
  for (const key of ["invoice_count", "draft_count", "sent_count", "partially_paid_count", "paid_count", "overdue_count", "payment_count", "account_count"] as const) if (!Number.isSafeInteger(v[key]) || v[key] < 0) throw error();
  if (!Number.isSafeInteger(v.sent_count + v.partially_paid_count) || !Array.isArray(v.by_currency)) throw error();
  const decimal = (n: unknown) => typeof n === "string" ? /^-?\d+(?:\.\d+)?$/.test(n) : typeof n === "number" && Number.isFinite(n);
  if (v.by_currency.some(row => !row || !/^[A-Z]{3}$/.test(row.currency) || !decimal(row.invoiced) || !decimal(row.paid) || !decimal(row.outstanding))) throw error();
  return v;
}
export function financeOpenCount(summary: FinanceSummary) {
  // overdue_count is a subset of sent/partially_paid, not a third status group.
  return summary.sent_count + summary.partially_paid_count;
}
