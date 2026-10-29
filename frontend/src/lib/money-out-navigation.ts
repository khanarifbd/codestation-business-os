import type { MoneyOutBrowse, Purpose } from "@/components/accounting-money-out/money-out-model";
export const MONEY_OUT_PATH = "/dashboard/accounting/money-out";
export const moneyOutPurpose = (raw: string | null): Purpose => raw === "project" || raw === "client" ? raw : "company";
export function moneyOutBrowse(raw: string | URLSearchParams): MoneyOutBrowse { const p = new URLSearchParams(raw), cursor = (p.get("cursor") || "").slice(0, 4095), page = Number(p.get("page")); return { search: (p.get("search") || "").slice(0, 500), purpose: ["company", "project", "client"].includes(p.get("purpose") || "") ? p.get("purpose") as Purpose : "all", currency: (p.get("currency") || "").slice(0, 3).toUpperCase(), category_id: (p.get("category_id") || "").slice(0, 200), status: ["all", "posted", "voided"].includes(p.get("status") || "") ? p.get("status")! : "posted", size: [20, 50, 100].includes(Number(p.get("size"))) ? Number(p.get("size")) : 20, cursor, page: cursor ? Number.isSafeInteger(page) && page >= 2 ? page : 2 : 1, focus: (p.get("focus") || "").slice(0, 200) }; }
export function moneyOutListHref(b: Partial<MoneyOutBrowse> = {}) { const p = new URLSearchParams(); for (const k of ["search", "currency", "category_id", "focus"] as const)
    if (b[k])
        p.set(k, b[k]); if (b.purpose && b.purpose !== "all")
    p.set("purpose", b.purpose); if (b.status && b.status !== "posted")
    p.set("status", b.status); if (b.size && b.size !== 20)
    p.set("size", String(b.size)); if (b.cursor) {
    p.set("cursor", b.cursor);
    p.set("page", String(b.page || 2));
} return MONEY_OUT_PATH + (p.size ? `?${p}` : ""); }
export function safeMoneyOutReturn(raw?: string | null) { return raw && (raw === MONEY_OUT_PATH || raw.startsWith(MONEY_OUT_PATH + "?")) ? moneyOutListHref(moneyOutBrowse(raw.split("?")[1] || "")) : MONEY_OUT_PATH; }
export const moneyOutCreateHref = (purpose: Purpose, back?: string | null) => `${MONEY_OUT_PATH}/new?${new URLSearchParams({ purpose, returnTo: safeMoneyOutReturn(back) })}`;
export const moneyOutViewHref = (id: string, back?: string | null) => `${MONEY_OUT_PATH}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: safeMoneyOutReturn(back) })}`;
export function moneyOutPageApi(b: MoneyOutBrowse) { const p = new URLSearchParams({ limit: String(b.size) }); if (b.status !== "all")
    p.set("status", b.status); if (b.category_id)
    p.set("category_id", b.category_id); if (b.cursor)
    p.set("cursor", b.cursor); return `/api/finance/expenses?${p}`; }
