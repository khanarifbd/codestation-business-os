import { agingBuckets, type ReceivableBrowse } from "@/components/accounting-receivables/receivables-model";
export const RECEIVABLES_PATH = "/dashboard/accounting/receivables";
export function receivablesBrowse(raw: string | URLSearchParams): ReceivableBrowse { const p = new URLSearchParams(raw), cursor = (p.get("cursor") || "").slice(0, 4095), page = Number(p.get("page")), aging = p.get("aging"); return { search: (p.get("search") || "").slice(0, 300), aging: agingBuckets.includes(aging as never) ? aging as ReceivableBrowse["aging"] : "all", currency: /^[A-Za-z]{3}$/.test(p.get("currency") || "") ? p.get("currency")!.toUpperCase() : "", cursor, page: cursor ? Number.isSafeInteger(page) && page >= 2 ? page : 2 : 1, focus: (p.get("focus") || "").slice(0, 200) }; }
export function receivablesListHref(b: Partial<ReceivableBrowse> = {}) { const p = new URLSearchParams(); if (b.search)
    p.set("search", b.search); if (b.aging && b.aging !== "all")
    p.set("aging", b.aging); if (b.currency)
    p.set("currency", b.currency); if (b.cursor) {
    p.set("cursor", b.cursor);
    p.set("page", String(b.page || 2));
} if (b.focus)
    p.set("focus", b.focus); return RECEIVABLES_PATH + (p.size ? `?${p}` : ""); }
export function safeReceivablesReturn(raw?: string | null) { return raw && (raw === RECEIVABLES_PATH || raw.startsWith(RECEIVABLES_PATH + "?")) ? receivablesListHref(receivablesBrowse(raw.split("?")[1] || "")) : RECEIVABLES_PATH; }
export function creditApplyHref(invoiceId: string, back?: string) { return `${RECEIVABLES_PATH}/${encodeURIComponent(invoiceId)}/apply-credit?${new URLSearchParams({ returnTo: safeReceivablesReturn(back) })}`; }
export function receivablesReadApi(b: ReceivableBrowse) { const p = new URLSearchParams({ limit: "50" }); if (b.search.trim())
    p.set("search", b.search.trim()); if (b.aging !== "all")
    p.set("aging", b.aging); if (b.currency)
    p.set("currency", b.currency); if (b.cursor)
    p.set("cursor", b.cursor); return `/api/finance/receivable-page?${p}`; }
export const receivableInvoiceHref = (id: string) => `/dashboard/accounting/invoices/${encodeURIComponent(id)}`;
export const receivableCollectHref = (id?: string) => `/dashboard/accounting/money-in${id ? `?${new URLSearchParams({ invoice_id: id })}` : ""}`;
