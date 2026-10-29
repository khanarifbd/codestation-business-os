import type { ReconciliationBrowse, ReconciliationSelection } from "@/components/accounting-reconciliation/reconciliation-types";
import { reconciliationIdentity } from "@/components/accounting-reconciliation/reconciliation-model";
export const RECONCILIATION_PATH = "/dashboard/accounting/reconciliation";
const boundedPage = (value: string | null) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 1; };
export function reconciliationBrowse(raw: string | URLSearchParams): ReconciliationBrowse {
  const q = new URLSearchParams(raw), status = q.get("status");
  return { search: (q.get("search") || "").slice(0, 300), status: status === "draft" || status === "finalized" ? status : "", account: (q.get("account") || "").slice(0, 200), page: boundedPage(q.get("page")), focus: (q.get("focus") || "").slice(0, 200) };
}
export function reconciliationListHref(value: Partial<ReconciliationBrowse> = {}) {
  const q = new URLSearchParams();
  if (value.search) q.set("search", value.search);
  if (value.status) q.set("status", value.status);
  if (value.account) q.set("account", value.account);
  if (value.page && value.page > 1) q.set("page", String(value.page));
  if (value.focus) q.set("focus", value.focus);
  return RECONCILIATION_PATH + (q.size ? `?${q}` : "");
}
export function safeReconciliationReturn(raw?: string | null) {
  return raw && (raw === RECONCILIATION_PATH || raw.startsWith(RECONCILIATION_PATH + "?")) ? reconciliationListHref(reconciliationBrowse(raw.split("?").slice(1).join("?"))) : RECONCILIATION_PATH;
}
export function reconciliationSelection(raw: string | URLSearchParams): ReconciliationSelection {
  const q = new URLSearchParams(raw), filter = q.get("filter");
  return { search: (q.get("txSearch") || "").slice(0, 300), filter: filter === "matched" || filter === "unmatched" ? filter : "all", page: boundedPage(q.get("txPage")) };
}
export function reconciliationDocumentHref(id: string, back?: string | null, matching = false, selection?: ReconciliationSelection) {
  if (!reconciliationIdentity(id)) return safeReconciliationReturn(back);
  const q = new URLSearchParams({ returnTo: safeReconciliationReturn(back) });
  if (selection?.search) q.set("txSearch", selection.search);
  if (selection?.filter && selection.filter !== "all") q.set("filter", selection.filter);
  if (selection?.page && selection.page > 1) q.set("txPage", String(selection.page));
  return `${RECONCILIATION_PATH}/${encodeURIComponent(id)}${matching ? "/match" : ""}?${q}`;
}
export function reconciliationCreateHref(back?: string | null) { return `${RECONCILIATION_PATH}/new?${new URLSearchParams({ returnTo: safeReconciliationReturn(back) })}`; }
