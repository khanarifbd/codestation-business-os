import { taxDate, taxId } from "@/components/accounting-tax/tax-model";
import { settlementTypes, taxKinds } from "@/components/accounting-tax/tax-types";
import type { SettlementBrowse, TaxCodeBrowse, TaxReportBrowse } from "@/components/accounting-tax/tax-types";
export const TAX_PATH = "/dashboard/accounting/tax", TAX_CODES_PATH = TAX_PATH + "/codes", TAX_SETTLEMENTS_PATH = TAX_PATH + "/settlements";
const pageNumber = (value: string | null) => { const page = Number(value); return Number.isSafeInteger(page) && page > 0 ? page : 1; };
const params = (value: object) => new URLSearchParams(Object.entries(value).filter(([,v]) => v !== undefined).map(([key,v]) => [key,String(v)]));
export function taxReportBrowse(raw: string | URLSearchParams, defaults: Partial<TaxReportBrowse> = {}): TaxReportBrowse { const p = new URLSearchParams(raw), from = p.has("date_from") ? p.get("date_from") : defaults.date_from, to = p.has("date_to") ? p.get("date_to") : defaults.date_to; return { date_from: taxDate(from) ? from : "", date_to: taxDate(to) ? to : "" }; }
export function taxReportHref(partial: Partial<TaxReportBrowse> = {}) { const b = taxReportBrowse(params(partial)), p = new URLSearchParams(); if (b.date_from) p.set("date_from",b.date_from); if (b.date_to) p.set("date_to",b.date_to); return TAX_PATH + (p.size ? `?${p}` : ""); }
export function taxCodeBrowse(raw: string | URLSearchParams): TaxCodeBrowse { const p = new URLSearchParams(raw), kind = p.get("kind"), active = p.get("active"); return { search: (p.get("search") || "").slice(0,300), kind: taxKinds.includes(kind as typeof taxKinds[number]) ? kind as TaxCodeBrowse["kind"] : "all", active: active === "active" || active === "inactive" ? active : "all", page: pageNumber(p.get("page")), focus: taxId(p.get("focus")) ? p.get("focus")! : "" }; }
export function taxCodeListHref(partial: Partial<TaxCodeBrowse> = {}) { const b = taxCodeBrowse(params(partial)), p = new URLSearchParams(); if (b.search) p.set("search",b.search); if (b.kind !== "all") p.set("kind",b.kind); if (b.active !== "all") p.set("active",b.active); if (b.page > 1) p.set("page",String(b.page)); if (b.focus) p.set("focus",b.focus); return TAX_CODES_PATH + (p.size ? `?${p}` : ""); }
export function settlementBrowse(raw: string | URLSearchParams): SettlementBrowse { const p = new URLSearchParams(raw), type = p.get("type"), currency = (p.get("currency") || "").toUpperCase(); return { search: (p.get("search") || "").slice(0,300), type: settlementTypes.includes(type as typeof settlementTypes[number]) ? type as SettlementBrowse["type"] : "all", currency: /^[A-Z]{3}$/.test(currency) ? currency : "", page: pageNumber(p.get("page")), focus: taxId(p.get("focus")) ? p.get("focus")! : "" }; }
export function settlementListHref(partial: Partial<SettlementBrowse> = {}) { const b = settlementBrowse(params(partial)), p = new URLSearchParams(); if (b.search) p.set("search",b.search); if (b.type !== "all") p.set("type",b.type); if (b.currency) p.set("currency",b.currency); if (b.page > 1) p.set("page",String(b.page)); if (b.focus) p.set("focus",b.focus); return TAX_SETTLEMENTS_PATH + (p.size ? `?${p}` : ""); }
export function safeTaxReturn(raw?: string | null, fallback: string = TAX_PATH) {
  const safeFallback = [TAX_PATH, TAX_CODES_PATH, TAX_SETTLEMENTS_PATH].includes(fallback) ? fallback : TAX_PATH;
  if (!raw || raw.includes("#")) return safeFallback;
  for (const path of [TAX_PATH, TAX_CODES_PATH, TAX_SETTLEMENTS_PATH]) {
    if (raw !== path && !raw.startsWith(path + "?")) continue;
    const query = raw.slice(path.length + 1);
    if (path === TAX_PATH) return taxReportHref(taxReportBrowse(query));
    if (path === TAX_CODES_PATH) return taxCodeListHref(taxCodeBrowse(query));
    return settlementListHref(settlementBrowse(query));
  }
  return safeFallback;
}
export const taxCodeDetailHref = (id: string, back?: string | null) => taxId(id) ? `${TAX_CODES_PATH}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: safeTaxReturn(back,TAX_CODES_PATH) })}` : safeTaxReturn(back,TAX_CODES_PATH);
export const taxCodeCreateHref = (back?: string | null) => `${TAX_CODES_PATH}/new?${new URLSearchParams({ returnTo: safeTaxReturn(back,TAX_CODES_PATH) })}`;
export const taxCodeEditHref = (id: string, back?: string | null) => taxId(id) ? `${TAX_CODES_PATH}/${encodeURIComponent(id)}/edit?${new URLSearchParams({ returnTo: safeTaxReturn(back,TAX_CODES_PATH) })}` : safeTaxReturn(back,TAX_CODES_PATH);
export const settlementDetailHref = (id: string, back?: string | null) => taxId(id) ? `${TAX_SETTLEMENTS_PATH}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: safeTaxReturn(back,TAX_SETTLEMENTS_PATH) })}` : safeTaxReturn(back,TAX_SETTLEMENTS_PATH);
export const settlementCreateHref = (back?: string | null) => `${TAX_SETTLEMENTS_PATH}/new?${new URLSearchParams({ returnTo: safeTaxReturn(back,TAX_SETTLEMENTS_PATH) })}`;
