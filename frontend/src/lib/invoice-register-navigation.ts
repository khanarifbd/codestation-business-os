export const INVOICE_STATUSES = ["all", "draft", "sent", "partially_paid", "paid", "overdue", "cancelled"] as const;
export type InvoiceRegisterFilters = { search: string; status: string; currency: string; balance: "all" | "overdue" | "outstanding" | "paid" };
export const blankInvoiceFilters = (): InvoiceRegisterFilters => ({ search: "", status: "all", currency: "all", balance: "all" });
export function invoiceRegisterUrl(filters: InvoiceRegisterFilters, cursor?: string | null) {
  const params = new URLSearchParams({ limit: "100" });
  if (filters.search.trim()) params.set("search", filters.search.trim());
  const status = filters.balance === "overdue" ? "overdue" : filters.status;
  if (status !== "all" && (INVOICE_STATUSES as readonly string[]).includes(status)) params.set("status", status);
  if (filters.currency !== "all") params.set("currency", filters.currency);
  if (filters.balance === "outstanding" || filters.balance === "paid") params.set("balance", filters.balance);
  if (cursor) params.set("cursor", cursor);
  return `/api/finance/invoice-page?${params}`;
}
export function verifiedInvoicePage<T extends { id: string; invoice_number: string }>(value: unknown): { items: T[]; next_cursor: string | null } {
  if (!value || typeof value !== "object") throw new Error("Invoice register could not be verified. Retry loading.");
  const page = value as { items?: T[]; next_cursor?: unknown };
  if (!Array.isArray(page.items) || page.items.some(row => !row || typeof row.id !== "string" || !row.id || typeof row.invoice_number !== "string") || (page.next_cursor != null && (typeof page.next_cursor !== "string" || !page.next_cursor))) throw new Error("Invoice register could not be verified. Retry loading.");
  return { items: page.items, next_cursor: typeof page.next_cursor === "string" ? page.next_cursor : null };
}
export function appendUniqueInvoices<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map(row => row.id));
  return [...existing, ...incoming.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; })];
}
export type InvoiceRegisterLocation = { filters: InvoiceRegisterFilters; cursor: string | null };
export function invoiceLocationKey(location: InvoiceRegisterLocation) {
  const { filters, cursor } = location;
  return JSON.stringify([filters.search, filters.status, filters.currency, filters.balance, cursor || ""]);
}
