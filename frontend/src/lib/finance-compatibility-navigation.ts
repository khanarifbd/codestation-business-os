export const FINANCE_PATH = "/dashboard/finance";
export type FinanceTab = "invoices" | "payments" | "accounts";
export type FinanceBrowse = {
  tab: FinanceTab; client_id: string;
  invoice_search: string; invoice_status: string; invoice_currency: string; invoice_balance: string; invoice_cursor: string;
  payment_kind: string; payment_cursor: string; payment_page: number; payment_invoice: string; payment_focus: string;
  account_focus: string;
};
const tabs: FinanceTab[] = ["invoices", "payments", "accounts"];
export function financeBrowse(raw: string | URLSearchParams): FinanceBrowse {
  const p = new URLSearchParams(raw);
  const single = (key: string, max = 200) => p.getAll(key).length === 1 && p.get(key)!.length <= max ? p.get(key)! : "";
  const choice = (key: string, options: string[], fallback: string) => { const value = single(key); return options.includes(value) ? value : fallback; };
  const client = single("client_id"), cursor = single("payment_cursor", 4095), page = Number(single("payment_page"));
  return {
    tab: choice("tab", tabs, "invoices") as FinanceTab,
    client_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client) ? client.toLowerCase() : "",
    invoice_search: single("invoice_search", 500),
    invoice_status: choice("invoice_status", ["all", "draft", "sent", "partially_paid", "paid", "overdue", "cancelled"], "all"),
    invoice_currency: /^[A-Z]{3}$/.test(single("invoice_currency")) ? single("invoice_currency") : "all",
    invoice_balance: choice("invoice_balance", ["all", "overdue", "outstanding", "paid"], "all"),
    invoice_cursor: single("invoice_cursor", 4095),
    payment_kind: choice("payment_kind", ["payment", "advance", "income"], "payment"),
    payment_cursor: cursor,
    payment_page: cursor ? Number.isSafeInteger(page) && page >= 2 ? page : 2 : 1,
    payment_invoice: single("payment_invoice"), payment_focus: single("payment_focus"), account_focus: single("account_focus"),
  };
}
export function financeHref(state: Partial<FinanceBrowse> = {}, includeCreateIntent = false) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) if (value !== "" && value != null) p.set(key, String(value));
  const b = financeBrowse(p), normalized = new URLSearchParams({ tab: b.tab });
  for (const key of ["invoice_search", "invoice_cursor", "payment_focus", "account_focus"] as const) if (b[key]) normalized.set(key, b[key]);
  for (const key of ["invoice_status", "invoice_currency", "invoice_balance"] as const) if (b[key] !== "all") normalized.set(key, b[key]);
  if (b.payment_kind !== "payment") normalized.set("payment_kind", b.payment_kind);
  else {
    if (b.payment_cursor) { normalized.set("payment_cursor", b.payment_cursor); normalized.set("payment_page", String(b.payment_page)); }
    if (b.payment_invoice) normalized.set("payment_invoice", b.payment_invoice);
  }
  // A return link must never reopen or replace a draft.
  if (includeCreateIntent && b.client_id) normalized.set("client_id", b.client_id);
  return `${FINANCE_PATH}?${normalized}`;
}
export function safeFinanceReturn(raw?: string | null, allowedTabs: FinanceTab[] = tabs): string | null {
  if (!raw || raw.includes("#") || raw.includes("\\") || (raw !== FINANCE_PATH && !raw.startsWith(`${FINANCE_PATH}?`))) return null;
  const browse = financeBrowse(raw.split("?").slice(1).join("?"));
  return allowedTabs.includes(browse.tab) ? financeHref(browse) : null;
}
export function financePaymentQuery(raw: string | URLSearchParams) {
  const b = financeBrowse(raw), p = new URLSearchParams({ kind: b.payment_kind });
  if (b.payment_kind === "payment") {
    if (b.payment_cursor) { p.set("cursor", b.payment_cursor); p.set("page", String(b.payment_page)); }
    if (b.payment_invoice) p.set("filter_invoice", b.payment_invoice);
  }
  if (b.payment_focus) p.set("focus", b.payment_focus);
  return p.toString();
}
export function invoiceDetailHref(id: string, returnTo?: string | null) {
  const back = safeFinanceReturn(returnTo, ["invoices", "payments"]);
  return `/dashboard/accounting/invoices/${encodeURIComponent(id)}${back ? `?${new URLSearchParams({ returnTo: back })}` : ""}`;
}
export function invoiceCollectionHref(id: string, returnTo?: string | null) {
  const back = safeFinanceReturn(returnTo, ["invoices", "payments"]);
  return back ? `/dashboard/accounting/money-in/new?${new URLSearchParams({ purpose: "invoice", returnTo: back, invoice_id: id })}` : `/dashboard/accounting/money-in?invoice_id=${encodeURIComponent(id)}`;
}
