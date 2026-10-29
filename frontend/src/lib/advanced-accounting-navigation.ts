import { advancedDate, advancedId, correctionType } from "@/components/accounting-advanced/advanced-model";
import { categories } from "@/components/accounting-advanced/advanced-types";
import type { AdvancedBrowse, Category, CorrectionBrowse, CorrectionType } from "@/components/accounting-advanced/advanced-types";
export const ADVANCED_PATH = "/dashboard/accounting/advanced", CORRECTIONS_PATH = ADVANCED_PATH + "/corrections";
const page = (raw: string | null) => { const n = Number(raw); return Number.isSafeInteger(n) && n > 0 ? n : 1; };
export function advancedBrowse(raw: string | URLSearchParams): AdvancedBrowse {
  const q = new URLSearchParams(raw), tab = q.get("tab"), source = q.get("source"), status = q.get("status"), category = q.get("category"), asOf = q.get("asOf");
  return { tab: tab === "journals" || tab === "chart" ? tab : "trial", search: (q.get("search") || "").slice(0, 300), asOf: advancedDate(asOf) ? asOf : "", source: source === "manual" || source === "operational" || source === "reversal" ? source : "all", category: categories.includes(category as Category) ? category as Category : "all", status: status === "active" || status === "inactive" ? status : "all", page: page(q.get("page")), focus: advancedId(q.get("focus")) ? q.get("focus")! : "" };
}
export function advancedListHref(value: Partial<AdvancedBrowse> = {}) {
  const v = advancedBrowse(new URLSearchParams(Object.entries(value).filter(([, val]) => val !== undefined).map(([key, val]) => [key, String(val)]))), q = new URLSearchParams();
  if (v.tab !== "trial") q.set("tab", v.tab); if (v.search) q.set("search", v.search); if (v.asOf) q.set("asOf", v.asOf);
  if (v.source !== "all") q.set("source", v.source); if (v.category !== "all") q.set("category", v.category); if (v.status !== "all") q.set("status", v.status);
  if (v.page > 1) q.set("page", String(v.page)); if (v.focus) q.set("focus", v.focus);
  return ADVANCED_PATH + (q.size ? `?${q}` : "");
}
export function safeAdvancedReturn(raw?: string | null) {
  return raw && !raw.includes("#") && (raw === ADVANCED_PATH || raw.startsWith(ADVANCED_PATH + "?")) ? advancedListHref(advancedBrowse(raw.slice(ADVANCED_PATH.length + 1))) : ADVANCED_PATH;
}
export function advancedJournalHref(id: string, back?: string | null, reverse = false) {
  if (!advancedId(id)) return safeJournalReturn(back);
  return `${ADVANCED_PATH}/journals/${encodeURIComponent(id)}${reverse ? "/reverse" : ""}?${new URLSearchParams({ returnTo: safeJournalReturn(back) })}`;
}
export function advancedLedgerHref(back?: string | null) { return `${ADVANCED_PATH}/ledgers/new?${new URLSearchParams({ returnTo: safeAdvancedReturn(back) })}`; }
export function advancedAdjustmentHref(back?: string | null) { return `${ADVANCED_PATH}/adjustment?${new URLSearchParams({ returnTo: safeAdvancedReturn(back) })}`; }
export function correctionBrowse(raw: string | URLSearchParams): CorrectionBrowse {
  const q = new URLSearchParams(raw), type = q.get("type");
  return { tab: q.get("tab") === "history" ? "history" : "candidates", type: correctionType(type) ? type : "all", search: (q.get("search") || "").slice(0, 300), page: page(q.get("page")), focus: advancedId(q.get("focus")) ? q.get("focus")! : "" };
}
export function correctionListHref(value: Partial<CorrectionBrowse> = {}) {
  const v = correctionBrowse(new URLSearchParams(Object.entries(value).filter(([, val]) => val !== undefined).map(([key, val]) => [key, String(val)]))), q = new URLSearchParams();
  if (v.tab === "history") q.set("tab", "history"); if (v.type !== "all") q.set("type", v.type); if (v.search) q.set("search", v.search); if (v.page > 1) q.set("page", String(v.page)); if (v.focus) q.set("focus", v.focus);
  return CORRECTIONS_PATH + (q.size ? `?${q}` : "");
}
export function safeCorrectionReturn(raw?: string | null) {
  return raw && !raw.includes("#") && (raw === CORRECTIONS_PATH || raw.startsWith(CORRECTIONS_PATH + "?")) ? correctionListHref(correctionBrowse(raw.slice(CORRECTIONS_PATH.length + 1))) : CORRECTIONS_PATH;
}
export function correctionActionHref(type: CorrectionType | string, id: string, back?: string | null) {
  if (!correctionType(type) || !advancedId(id)) return safeCorrectionReturn(back);
  return `${CORRECTIONS_PATH}/${encodeURIComponent(type)}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: safeCorrectionReturn(back) })}`;
}

/** A journal may be opened from either existing register; never retain an editor or external URL. */
export function safeJournalReturn(raw?: string | null) {
  return raw && (raw === CORRECTIONS_PATH || raw.startsWith(CORRECTIONS_PATH + "?")) ? safeCorrectionReturn(raw) : safeAdvancedReturn(raw);
}
