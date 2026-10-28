import type { MoneyInBrowse, Purpose, ReceiptKind } from "@/components/accounting-money-in/money-in-model";
export const MONEY_IN_PATH = "/dashboard/accounting/money-in";
export const moneyInPurpose = (raw: string | null): Purpose => ["invoice", "project", "order", "advance", "other"].includes(raw || "") ? raw as Purpose : "invoice";
export const moneyInKind = (raw: string | null): ReceiptKind => raw === "advance" || raw === "income" ? raw : "payment";
export function moneyInBrowse(raw: string | URLSearchParams): MoneyInBrowse { const p = new URLSearchParams(raw), cursor = (p.get("cursor") || "").slice(0, 4095), page = Number(p.get("page")); return { kind: moneyInKind(p.get("kind")), cursor, page: cursor ? Number.isSafeInteger(page) && page >= 2 ? page : 2 : 1, invoice_id: (p.get("filter_invoice") || "").slice(0, 200), focus: (p.get("focus") || "").slice(0, 200) }; }
export function moneyInListHref(b: Partial<MoneyInBrowse> = {}) { const p = new URLSearchParams(); if (b.kind && b.kind !== "payment")
    p.set("kind", b.kind); if (b.kind === undefined || b.kind === "payment") {
    if (b.cursor) {
        p.set("cursor", b.cursor);
        p.set("page", String(b.page || 2));
    }
    if (b.invoice_id)
        p.set("filter_invoice", b.invoice_id);
} if (b.focus)
    p.set("focus", b.focus); return MONEY_IN_PATH + (p.size ? `?${p}` : ""); }
export function safeMoneyInReturn(raw?: string | null) { return raw && (raw === MONEY_IN_PATH || raw.startsWith(MONEY_IN_PATH + "?")) ? moneyInListHref(moneyInBrowse(raw.split("?")[1] || "")) : MONEY_IN_PATH; }
export function moneyInCreateHref(purpose: Purpose, back?: string | null, invoiceId?: string | null) { const p = new URLSearchParams({ purpose, returnTo: safeMoneyInReturn(back) }); if (invoiceId)
    p.set("invoice_id", invoiceId); return `${MONEY_IN_PATH}/new?${p}`; }
export function moneyInReceiptHref(kind: ReceiptKind, id: string, back?: string | null) { return `${MONEY_IN_PATH}/receipts/${kind}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: safeMoneyInReturn(back) })}`; }
export function moneyInReadApi(b: MoneyInBrowse) { if (b.kind === "income")
    return "/api/accounting/money?kind=income&limit=50"; if (b.kind === "advance")
    return "/api/accounting/customer-advances?open_only=true"; const p = new URLSearchParams({ limit: "20" }); if (b.cursor)
    p.set("cursor", b.cursor); if (b.invoice_id)
    p.set("invoice_id", b.invoice_id); return `/api/finance/payment-page?${p}`; }
export function moneyInInvoiceApi(search: string, cursor: string) { const p = new URLSearchParams({ limit: "20", balance: "outstanding" }); if (search.trim())
    p.set("search", search.trim()); if (cursor)
    p.set("cursor", cursor); return `/api/finance/invoice-page?${p}`; }
