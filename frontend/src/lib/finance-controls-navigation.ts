import { controlId } from "@/components/finance-controls/control-model";
import { controlTabs } from "@/components/finance-controls/control-types";
import type { ControlBrowse, ControlTab } from "@/components/finance-controls/control-types";

export const CONTROL_PATH = "/dashboard/accounting/controls";
export const CONTROL_ALIASES = ["/dashboard/finance/controls", "/dashboard/finance/auto-post"] as const;
const statuses: Record<ControlTab, readonly string[]> = {
  recurring: ["all", "active", "paused"],
  automation: ["all", "enabled", "disabled", "needs_attention", "eligible", "ineligible"],
  periods: ["all", "open", "closed"],
};
const validTab = (value: unknown): value is ControlTab => controlTabs.includes(value as ControlTab);
const pageNumber = (value: string | null) => { const page = value && /^\d+$/.test(value) ? Number(value) : 1; return Number.isSafeInteger(page) && page > 0 ? page : 1; };
const params = (value: object) => new URLSearchParams(Object.entries(value).filter(([, v]) => v !== undefined).map(([key, v]) => [key, String(v)]));
export function controlBrowse(raw: string | URLSearchParams, defaultTab: ControlTab = "recurring"): ControlBrowse {
  const query = new URLSearchParams(raw), tab = validTab(query.get("tab")) ? query.get("tab") as ControlTab : validTab(defaultTab) ? defaultTab : "recurring";
  const status = query.get("status") || "all";
  return { tab, search: (query.get("search") || "").slice(0, 300), status: statuses[tab].includes(status) ? status : "all", page: pageNumber(query.get("page")), focus: controlId(query.get("focus")) ? query.get("focus")! : "" };
}
export function controlListHref(partial: Partial<ControlBrowse> = {}): string {
  const browse = controlBrowse(params(partial)), query = new URLSearchParams();
  if (browse.tab !== "recurring") query.set("tab", browse.tab);
  if (browse.search) query.set("search", browse.search);
  if (browse.status !== "all") query.set("status", browse.status);
  if (browse.page > 1) query.set("page", String(browse.page));
  if (browse.focus) query.set("focus", browse.focus);
  return CONTROL_PATH + (query.size ? `?${query}` : "");
}
/** Only register destinations; no external, hash, arbitrary route or editor-return loops. */
export function safeControlReturn(value: string | null | undefined, fallbackTab: ControlTab = "recurring"): string {
  const fallback = controlListHref({ tab: validTab(fallbackTab) ? fallbackTab : "recurring" });
  if (!value || value.includes("#")) return fallback;
  for (const path of [CONTROL_PATH, ...CONTROL_ALIASES]) {
    if (value !== path && !value.startsWith(path + "?")) continue;
    const aliasTab = path === "/dashboard/finance/auto-post" ? "automation" : "recurring";
    return controlListHref(controlBrowse(value.slice(path.length + 1), aliasTab));
  }
  return fallback;
}
export function controlDetailHref(kind: ControlTab, id: string, returnTo?: string | null): string {
  const tab = validTab(kind) ? kind : "recurring", back = safeControlReturn(returnTo, tab);
  return validTab(kind) && controlId(id) ? `${CONTROL_PATH}/${kind}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: back })}` : back;
}
export function controlActionHref(kind: ControlTab, id: string, action: string, returnTo?: string | null): string {
  const allowed: Record<ControlTab, readonly string[]> = { recurring: ["post", "status"], automation: ["configure", "retry"], periods: ["close", "reopen"] };
  const tab = validTab(kind) ? kind : "recurring", back = safeControlReturn(returnTo, tab);
  if (!validTab(kind) || !controlId(id) || !allowed[kind].includes(action)) return back;
  return `${CONTROL_PATH}/${kind}/${encodeURIComponent(id)}/${action}?${new URLSearchParams({ returnTo: back })}`;
}
export function controlCreateHref(kind: ControlTab, returnTo?: string | null): string {
  const tab = validTab(kind) ? kind : "recurring", back = safeControlReturn(returnTo, tab);
  return kind === "recurring" || kind === "periods" ? `${CONTROL_PATH}/${kind}/new?${new URLSearchParams({ returnTo: back })}` : back;
}
