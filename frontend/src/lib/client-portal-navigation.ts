import { portalId } from "@/components/client-portal/portal-model";
import type { PortalKind } from "@/components/client-portal/portal-types";

export const PORTAL_ROOT = "/dashboard/client";
export const PORTAL_PAGE_SIZE = 20;
export type PortalBrowse = { search: string; status: string; client: string; page: number; focus: string };
const defaults = (): PortalBrowse => ({ search: "", status: "all", client: "", page: 1, focus: "" });
function pageNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}
export function parsePortalBrowse(query: Pick<URLSearchParams, "get">): PortalBrowse {
  const status = query.get("status") || "all", client = query.get("client") || "", focus = query.get("focus") || "";
  return {
    search: (query.get("search") || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200),
    status: /^[a-z][a-z0-9_]{0,47}$/.test(status) ? status : "all",
    client: portalId(client) ? client : "",
    page: pageNumber(query.get("page")),
    focus: portalId(focus) ? focus : "",
  };
}
export function portalBrowseHref(kind: PortalKind, browse: Partial<PortalBrowse> = {}) {
  const state = { ...defaults(), ...browse }, query = new URLSearchParams();
  if (state.search) query.set("search", state.search);
  if (state.status && state.status !== "all") query.set("status", state.status);
  if (state.client) query.set("client", state.client);
  if (state.page !== 1) query.set("page", String(state.page));
  if (state.focus) query.set("focus", state.focus);
  const clean = parsePortalBrowse(query), canonical = new URLSearchParams();
  if (clean.search) canonical.set("search", clean.search);
  if (clean.status !== "all") canonical.set("status", clean.status);
  if (clean.client) canonical.set("client", clean.client);
  if (clean.page !== 1) canonical.set("page", String(clean.page));
  if (clean.focus) canonical.set("focus", clean.focus);
  return `${PORTAL_ROOT}/${kind}${canonical.size ? `?${canonical}` : ""}`;
}
export function portalDocumentHref(kind: PortalKind, id: string, browse: Partial<PortalBrowse> = {}) {
  if (!portalId(id)) return portalBrowseHref(kind, browse);
  const query = new URLSearchParams({ return_to: portalBrowseHref(kind, { ...browse, focus: id }) });
  return `${PORTAL_ROOT}/${kind}/${encodeURIComponent(id)}?${query}`;
}
export function portalBackHref(kind: PortalKind, rawReturn?: string | null) {
  const fallback = portalBrowseHref(kind);
  if (!rawReturn || !rawReturn.startsWith("/") || rawReturn.startsWith("//") || /[\u0000-\u0020\u007f\\]/.test(rawReturn)) return fallback;
  const rawPath = rawReturn.split(/[?#]/)[0];
  if (/%|\.\./.test(rawPath)) return fallback;
  try {
    const url = new URL(rawReturn, "https://portal.invalid");
    if (url.origin !== "https://portal.invalid" || url.pathname !== `${PORTAL_ROOT}/${kind}` || url.hash) return fallback;
    return portalBrowseHref(kind, parsePortalBrowse(url.searchParams));
  } catch { return fallback; }
}
/** Local pagination over every returned record, never a server cursor or a hidden collection cap. */
export function portalPageRows<T>(rows: T[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / PORTAL_PAGE_SIZE)), current = Math.min(pageNumber(page), pages);
  return { rows: rows.slice((current - 1) * PORTAL_PAGE_SIZE, current * PORTAL_PAGE_SIZE), page: current, pages, total: rows.length };
}
