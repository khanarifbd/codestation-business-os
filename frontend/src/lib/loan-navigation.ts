import { loanId } from "@/components/accounting-loans/loan-model";
import { loanStatuses } from "@/components/accounting-loans/loan-types";
import type { LoanActionKind, LoanBrowse } from "@/components/accounting-loans/loan-types";
export const LOANS_PATH = "/dashboard/accounting/loans";
export function loanBrowse(raw: string | URLSearchParams): LoanBrowse { const p = new URLSearchParams(raw), page = Number(p.get("page")), status = p.get("status"); return { search: (p.get("search") || "").slice(0, 300), status: loanStatuses.includes(status as typeof loanStatuses[number]) ? status as LoanBrowse["status"] : "all", page: Number.isSafeInteger(page) && page > 0 ? page : 1, focus: loanId(p.get("focus")) ? p.get("focus")! : "" }; }
export function loanListHref(partial: Partial<LoanBrowse> = {}) { const raw = new URLSearchParams(); for (const [key,value] of Object.entries(partial)) if (value !== undefined) raw.set(key,String(value)); const b = loanBrowse(raw), p = new URLSearchParams(); if (b.search) p.set("search",b.search); if (b.status !== "all") p.set("status",b.status); if (b.page > 1) p.set("page",String(b.page)); if (b.focus) p.set("focus",b.focus); return LOANS_PATH + (p.size ? `?${p}` : ""); }
export function safeLoanReturn(raw?: string | null) { if (!raw || raw.includes("#") || !(raw === LOANS_PATH || raw.startsWith(LOANS_PATH + "?"))) return LOANS_PATH; return loanListHref(loanBrowse(raw.slice(LOANS_PATH.length + 1))); }
export const loanCreateHref = (back?: string | null) => `${LOANS_PATH}/new?${new URLSearchParams({ returnTo: safeLoanReturn(back) })}`;
export const loanDetailHref = (id: string, back?: string | null) => loanId(id) ? `${LOANS_PATH}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: safeLoanReturn(back) })}` : safeLoanReturn(back);
/** Action entry is intended for native anchors, keeping form exit/Back on the shared document guard boundary. */
export const loanActionHref = (id: string, kind: LoanActionKind, back?: string | null) => loanId(id) && ["approve","close","receive","repay"].includes(kind) ? `${LOANS_PATH}/${encodeURIComponent(id)}/${kind}?${new URLSearchParams({ returnTo: safeLoanReturn(back) })}` : safeLoanReturn(back);
