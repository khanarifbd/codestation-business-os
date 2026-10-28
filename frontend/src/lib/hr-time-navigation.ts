import { dateOnly, timeId, validCursor } from "@/components/hr-time/hr-time-model";
export const HR_TIME = "/dashboard/hr/time";
export type TimeBrowse = {
  view: "attendance" | "leave";
  status: string;
  employee: string;
  from: string;
  to: string;
  search: string;
  cursor: string;
  size: number;
};
export type TimeRoute = {
  mode: "register" | "attendance_new" | "attendance_view" | "leave_view" | "leave_review" | "unavailable";
  id: string;
};
export function timeBrowse(raw: string | URLSearchParams): TimeBrowse {
  const q = new URLSearchParams(raw), one = (key: string) => q.getAll(key).length <= 1 ? q.get(key) ?? "" : "";
  const from = one("from"), to = one("to"), employee = one("employee"), cursor = one("cursor");
  return { view: one("view") === "leave" ? "leave" : "attendance", status: one("status").slice(0, 24), employee: timeId(employee) ? employee : "", from: dateOnly(from) ? from : "", to: dateOnly(to) ? to : "", search: one("search").slice(0, 300), cursor: validCursor(cursor) ? cursor : "", size: [20, 50, 100].includes(Number(one("size"))) ? Number(one("size")) : 50 };
}
export function timeBrowseHref(v: Partial<TimeBrowse> = {}) {
  const q = new URLSearchParams(); for (const k of ["view", "status", "employee", "from", "to", "search", "cursor"] as const)
    if (v[k] && !(k === "view" && v.view === "attendance"))
      q.set(k, v[k]!); if (v.size && v.size !== 50)
    q.set("size", String(v.size)); return HR_TIME + (q.size ? `?${q}` : "");
}
export function safeTimeReturn(raw?: string | null) { return raw && (raw === HR_TIME || raw.startsWith(HR_TIME + "?")) && !raw.includes("#") ? timeBrowseHref(timeBrowse(raw.split("?")[1] ?? "")) : HR_TIME; }
export function timeRoute(pathname: string): TimeRoute {
  if (pathname === HR_TIME)
    return { mode: "register", id: "" };
  if (pathname === HR_TIME + "/attendance/new")
    return { mode: "attendance_new", id: "" };
  if (!pathname.startsWith(HR_TIME + "/"))
    return { mode: "unavailable", id: "" };
  const parts = pathname.slice(HR_TIME.length + 1).split("/");
  let id = "";
  try {
    id = decodeURIComponent(parts[1] ?? "");
  }
  catch {
    return { mode: "unavailable", id: "" };
  }
  if (!timeId(id) || id === "new")
    return { mode: "unavailable", id: "" };
  if (parts[0] === "attendance" && parts.length === 2)
    return { mode: "attendance_view", id };
  if (parts[0] === "leave" && parts.length === 2)
    return { mode: "leave_view", id };
  if (parts[0] === "leave" && parts.length === 3 && parts[2] === "review")
    return { mode: "leave_review", id };
  return { mode: "unavailable", id: "" };
}
export function timeDocumentHref(kind: "attendance" | "leave", id: string, returnTo: string, review = false) { return `${HR_TIME}/${kind}/${encodeURIComponent(id)}${review && kind === "leave" ? "/review" : ""}?${new URLSearchParams({ returnTo: safeTimeReturn(returnTo) })}`; }
export function timeCreateHref(returnTo: string) { return `${HR_TIME}/attendance/new?${new URLSearchParams({ returnTo: safeTimeReturn(returnTo) })}`; }
export function timePageApi(browse: TimeBrowse, id = "") {
  const q = new URLSearchParams({ mode: "page", limit: String(browse.size) }); if (id)
    q.set("record_id", id);
  else {
    for (const [key, value] of [["status", browse.status], ["employee_id", browse.employee], ["date_from", browse.from], ["date_to", browse.to], ["cursor", browse.cursor]])
      if (value)
        q.set(key, value);
  } return `/api/hr/${browse.view === "attendance" ? "attendance" : "leave-requests"}?${q}`;
}
// Volatile cursor edges only. Native reload/share can lose Previous; never invent a predecessor.
const edges = new Map<string, string>();
const cursorKey = (scope: string, browse: TimeBrowse, cursor: string) => JSON.stringify([scope, browse.view, browse.status, browse.employee, browse.from, browse.to, browse.size, cursor]);
export function rememberTimeCursor(scope: string, browse: TimeBrowse, next: string) { edges.set(cursorKey(scope, browse, next), browse.cursor); }
export function previousTimeCursor(scope: string, browse: TimeBrowse) { return edges.get(cursorKey(scope, browse, browse.cursor)); }
