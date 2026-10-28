import type { PayablesBrowse } from "@/components/accounting-payables/payables-model";
export const PAYABLES_PATH = "/dashboard/accounting/payables";
export function payablesBrowse(raw: string | URLSearchParams): PayablesBrowse { const p = new URLSearchParams(raw), cursor = (p.get("cursor") || "").slice(0, 4095), page = Number(p.get("page")), status = p.get("status"); return { search: (p.get("search") || "").slice(0, 300), status: ["all", "open", "overdue", "partial", "paid"].includes(status || "") ? status as PayablesBrowse["status"] : "open", currency: /^[A-Za-z]{3}$/.test(p.get("currency") || "") ? p.get("currency")!.toUpperCase() : "", cursor, page: cursor ? Number.isSafeInteger(page) && page >= 2 ? page : 2 : 1, focus: (p.get("focus") || "").slice(0, 200) }; }
export function payablesListHref(b: Partial<PayablesBrowse> = {}) { const p = new URLSearchParams(); if (b.search)
    p.set("search", b.search); if (b.status && b.status !== "open")
    p.set("status", b.status); if (b.currency)
    p.set("currency", b.currency); if (b.cursor) {
    p.set("cursor", b.cursor);
    p.set("page", String(b.page || 2));
} if (b.focus)
    p.set("focus", b.focus); return PAYABLES_PATH + (p.size ? `?${p}` : ""); }
export function safePayablesReturn(raw?: string | null) { return raw && (raw === PAYABLES_PATH || raw.startsWith(PAYABLES_PATH + "?")) ? payablesListHref(payablesBrowse(raw.split("?")[1] || "")) : PAYABLES_PATH; }
export function payableDetailHref(id: string, back?: string | null) { return `${PAYABLES_PATH}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: safePayablesReturn(back) })}`; }
export function payableCreateHref(back?: string | null) { return `${PAYABLES_PATH}/new?${new URLSearchParams({ returnTo: safePayablesReturn(back) })}`; }
export function payablePayHref(id: string, back?: string | null) { return `${PAYABLES_PATH}/${encodeURIComponent(id)}/pay?${new URLSearchParams({ returnTo: safePayablesReturn(back) })}`; }
export function payablesReadApi(b: PayablesBrowse) { const p = new URLSearchParams({ limit: "50", status: b.status }); if (b.search.trim())
    p.set("search", b.search.trim()); if (b.currency)
    p.set("currency", b.currency); if (b.cursor)
    p.set("cursor", b.cursor); return `/api/accounting/payables/workspace?${p}`; }
