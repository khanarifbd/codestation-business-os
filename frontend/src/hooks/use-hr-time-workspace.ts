"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useHRAccess } from "@/components/hr-access-context";
import { attendanceDefaults, attendanceError, attendancePayload, isHRTimeMeta, isHRTimeSummary, timePageValidator, validHRAccess, type AttendanceDraft, type LeaveRow } from "@/components/hr-time/hr-time-model";
import { HR_TIME, previousTimeCursor, rememberTimeCursor, safeTimeReturn, timeBrowse, timeBrowseHref, timeCreateHref, timeDocumentHref, timePageApi, timeRoute, type TimeBrowse } from "@/lib/hr-time-navigation";
import { useHRTimeLifetime, useHRTimeResource } from "./use-hr-time-resource";
import { useHRTimeAction } from "./use-hr-time-action";
export function hrTimeScope(tenant: ReturnType<typeof useDashboardSession>["tenant"]) { return JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.status, tenant?.permissions]); }
export function useHRTimeWorkspace() {
  const { tenant } = useDashboardSession(), accessState = useHRAccess(), pathname = usePathname(), query = useSearchParams(), router = useRouter();
  const access = validHRAccess(accessState.access) ? accessState.access : null, route = timeRoute(pathname), browse = timeBrowse(query.toString()), scope = hrTimeScope(tenant), returnHref = safeTimeReturn(query.get("returnTo"));
  const lifetime = useHRTimeLifetime(JSON.stringify([scope, pathname, query.toString(), access?.can_view, access?.can_manage]));
  const canView = Boolean(tenant) && access?.can_view === true, canManage = access?.can_manage === true, kind = route.mode.startsWith("leave") ? "leave" : route.mode.startsWith("attendance") ? "attendance" : browse.view === "leave" ? "leave" : "attendance";
  const recordId = `${route.id}`;
  const selected: TimeBrowse = { ...browse, view: kind };
  const validator = useMemo(() => timePageValidator(kind, recordId), [kind, recordId]);
  const summary = useHRTimeResource(scope, "/api/hr/workspace-summary", canView && ["register", "attendance_new"].includes(route.mode), isHRTimeSummary);
  const meta = useHRTimeResource(scope, "/api/hr/meta", canView && ["register", "attendance_new"].includes(route.mode), isHRTimeMeta);
  const page = useHRTimeResource(scope, timePageApi(selected, route.id), canView && route.mode !== "attendance_new" && route.mode !== "unavailable", validator);
  const [draft, setDraft] = useState<AttendanceDraft>(attendanceDefaults), draftRef = useRef(draft);
  const [baseline, setBaseline] = useState<AttendanceDraft>(attendanceDefaults), baselineRef = useRef(baseline);
  const [decision, setDecision] = useState<"" | "approved" | "rejected">("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || Boolean(decision), action = useHRTimeAction(lifetime.owner, lifetime.current, dirty, route.mode === "register" ? "/dashboard/hr" : returnHref);
  const seeded = useRef(false), isCurrent = lifetime.current;
  useEffect(() => {
    if (route.mode !== "attendance_new" || !summary.value?.today || seeded.current)
      return;
    let active = true;
    const today = summary.value.today;
    queueMicrotask(() => {
      if (!active || !isCurrent() || seeded.current)
        return;
      seeded.current = true;
      if (JSON.stringify(draftRef.current) !== JSON.stringify(baselineRef.current)) return;
      const next = { ...draftRef.current, attendance_date: today };
      draftRef.current = next;
      baselineRef.current = next;
      setBaseline(next);
      setDraft(next);
    });
    return () => { active = false; };
  }, [route.mode, summary.value?.today, isCurrent]);
  const row = route.id ? page.value?.items[0] ?? null : null;
  const loaded = page.value?.items ?? [], needle = browse.search.trim().toLowerCase();
  const rows = loaded.filter(row => !needle || [row.employee_name, row.status, "attendance_date" in row ? row.attendance_date : `${row.leave_type_name} ${row.start_date}`, "attendance_mode" in row ? row.attendance_mode : ""].join(" ").toLowerCase().includes(needle));
  const canCreate = canView && canManage && meta.isReady(meta.receipt) && route.mode === "attendance_new";
  const canReview = canView && canManage && route.mode === "leave_review" && page.isReady(page.receipt) && row?.status === "pending";
  function change(field: keyof AttendanceDraft, value: string) {
    if (!canCreate || !action.canEdit())
      return;
    const next = { ...draftRef.current, [field]: value };
    draftRef.current = next;
    setDraft(next);
  }
  function choose(value: "approved" | "rejected") {
    if (canReview && action.canEdit())
      setDecision(value);
  }
  function submitAttendance() {
    if (!canCreate || !action.canEdit())
      return Promise.resolve(false);
    const error = attendanceError(draftRef.current, meta.value);
    if (error) {
      action.reject(error);
      return Promise.resolve(false);
    }
    const receipt = meta.receipt;
    return action.submit({ path: "/api/hr/attendance", method: "POST", body: attendancePayload(draftRef.current), current: () => lifetime.current() && canManage && meta.isReady(receipt) });
  }
  function reviewLeave() {
    if (!canReview || !decision || !row || !action.canEdit())
      return false;
    const receipt = page.receipt, leave = row as LeaveRow;
    return action.arm({ path: `/api/hr/leave-requests/${encodeURIComponent(leave.id)}`, method: "PATCH", body: { status: decision, expected_status: leave.status }, recordId: leave.id, status: decision, onConflict: () => page.invalidate(receipt), current: () => lifetime.current() && canManage && page.isReady(receipt) && leave.status === "pending" }, `${decision === "approved" ? "Approve" : "Reject"} this leave request?`);
  }
  function browseTo(patch: Partial<TimeBrowse>) {
    if (!lifetime.current())
      return;
    router.push(timeBrowseHref({ ...browse, ...patch, cursor: "" }));
  }
  const pageNav = useRef(false);
  function nextPage() {
    if (!lifetime.current() || pageNav.current || !page.isReady(page.receipt) || !page.value?.next_cursor)
      return;
    pageNav.current = true;
    rememberTimeCursor(scope, browse, page.value.next_cursor);
    router.push(timeBrowseHref({ ...browse, cursor: page.value.next_cursor }));
  }
  const previous = previousTimeCursor(scope, browse);
  function previousPage() {
    if (!lifetime.current() || pageNav.current || previous === undefined)
      return;
    pageNav.current = true;
    router.push(timeBrowseHref({ ...browse, cursor: previous }));
  }
  return { access, accessLoading: accessState.loading, accessError: accessState.error, canView, canManage, route, browse, scope, summary, meta, page, rows, row, draft, decision, dirty, action, canCreate, canReview, change, choose, submitAttendance, reviewLeave, browseTo, nextPage, previousPage, previous, returnHref, listHref: timeBrowseHref(browse), createHref: timeCreateHref(timeBrowseHref(browse)), documentHref: (id: string, review = false) => timeDocumentHref(kind, id, route.mode === "register" ? timeBrowseHref(browse) : returnHref, review), savedHref: action.id ? timeDocumentHref(kind, action.id, returnHref) : null, refresh: () => !action.busy ? Promise.all([summary.refresh(), meta.refresh(), route.mode !== "attendance_new" ? page.refresh() : Promise.resolve(null)]) : Promise.resolve([]), nativeEntry: (href: string) => action.open(href), timePath: HR_TIME };
}
export type HRTimeWorkspaceState = ReturnType<typeof useHRTimeWorkspace>;
