"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { selfCheckInBody } from "@/hooks/use-self-service-attendance";
import { getApiErrorMessage } from "@/lib/api-error";
import { emptySelfResources, isSelfResource, selfEditorPayload, selfInitialValues, type SelfBrowse, type SelfResources, type SelfValues } from "@/components/self-service/self-service-model";
import { EMPLOYEE_HOME_PATH, selfBrowseHref, selfBrowseState, selfEditorHref, selfMode, selfReviewHref, safeSelfReturnHref } from "@/lib/self-service-navigation";

const CANCELLED_ACTION = Symbol("cancelled-self-service-action");
type ResourceKey = keyof SelfResources;
type ResourceErrors = Partial<Record<ResourceKey, string>>;
export function useSelfServiceWorkspace() {
  const { tenant } = useDashboardSession();
  const router = useRouter(), pathname = usePathname(), params = useSearchParams(), route = useParams<{ reviewId?: string }>();
  const mode = selfMode(pathname, params.get("kind")), reviewId = route.reviewId || "", browse = selfBrowseState(params.toString());
  const returnHref = safeSelfReturnHref(params.get("returnTo")), editing = ["leave", "remote", "correction", "review_edit"].includes(mode);
  const permissions = tenant?.permissions || [], canHR = permissions.includes("*") || permissions.includes("hr.self"), canWork = permissions.includes("*") || permissions.includes("projects.work");
  const [resources, setResources] = useState<SelfResources>(emptySelfResources), [readErrors, setReadErrors] = useState<ResourceErrors>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [actionKey, setActionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [values, setValues] = useState<SelfValues>(() => selfInitialValues(mode)), [initial, setInitial] = useState<SelfValues>(() => selfInitialValues(mode));
  const [committed, setCommitted] = useState(false), [savedId, setSavedId] = useState<string | null>(null);
  const mounted = useRef(true), epoch = useRef(0), inFlight = useRef(false), committedRef = useRef(false), draftInitialized = useRef(false);
  const review = resources.self?.performance.find(row => row.id === reviewId) || null;
  const dirty = editing && !committed && JSON.stringify(values) !== JSON.stringify(initial);
  const navigation = useDocumentNavigationGuard(dirty, { documentLabel: "HR request", isBusy: busy, enabled: editing || busy });
  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const requestEpoch = epoch.current;
    const response = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 401) { if (mounted.current && requestEpoch === epoch.current) router.replace("/login"); throw new Error("Authentication required"); }
    if (!response.ok) throw new Error(getApiErrorMessage(body, `Request failed (${response.status})`));
    return body as T;
  }, [router]);
  const load = useCallback(async (resetDraft = false) => {
    const current = ++epoch.current;
    setLoading(true);
    const targets: [ResourceKey, string][] = [];
    if (canHR) {
      targets.push(["self", "/api/hr/self"]);
      if (mode === "home" || mode === "register") targets.push(["home", "/api/hr/self/home"]);
      if (["home", "register", "remote", "correction"].includes(mode)) targets.push(["plan", "/api/hr/self/attendance-plan"]);
      if (mode === "register" || mode === "leave") targets.push(["meta", "/api/hr/self-meta"], ["balance", "/api/hr/self/leave-balance"]);
      if (mode === "register") targets.push(["acks", "/api/hr/self/policy-acknowledgements"], ["monthly", `/api/hr/self/attendance/monthly${browse.month ? `?month=${encodeURIComponent(browse.month)}` : ""}`]);
    }
    if (mode === "home" && canWork) targets.push(["work", "/api/workspace/me"]);
    const next = emptySelfResources(), errors: ResourceErrors = {};
    await Promise.all(targets.map(async ([key, url]) => {
      try {
        const body = await request<unknown>(url);
        if (!isSelfResource(key, body)) throw new Error("This response could not be verified. Retry loading.");
        Object.assign(next, { [key]: body });
      } catch (reason) { errors[key] = reason instanceof Error ? reason.message : "Unable to load this section."; }
    }));
    if (!mounted.current || current !== epoch.current) return false;
    setResources(next); setReadErrors(errors); setLoading(false);
    if (next.self && (resetDraft || !draftInitialized.current)) { const draft = selfInitialValues(mode, next.self.performance.find(row => row.id === reviewId)); setValues(draft); setInitial(draft); draftInitialized.current = true; }
    return Object.keys(errors).length === 0;
  }, [browse.month, canHR, canWork, mode, request, reviewId]);
  useEffect(() => {
    mounted.current = true; let active = true;
    void Promise.resolve().then(() => { if (active) void load(true); });
    return () => { active = false; mounted.current = false; epoch.current += 1; };
  }, [load]);
  useEffect(() => { if (!loading && browse.focus) document.getElementById(`self-row-${browse.focus}`)?.focus(); }, [browse.focus, loading]);
  const canSubmit = Boolean(canHR && resources.self && (mode === "leave" ? resources.meta?.leave_types.length : mode === "remote" || mode === "correction" ? resources.plan && resources.self.employee.employment_status === "active" : mode === "review_edit" ? review && review.status !== "completed" : false));
  function change(field: string, value: string) { if (!inFlight.current && !committedRef.current) setValues(old => ({ ...old, [field]: value })); }
  function changeBrowse(next: Partial<SelfBrowse>) { if (inFlight.current || !navigation.confirmLeave()) return; router.push(selfBrowseHref({ ...browse, ...next, focus: "" }), { scroll: false }); }
  function savedDestination(id: string | null = savedId) {
    if (mode === "review_edit") return selfReviewHref(reviewId, returnHref);
    const context = returnHref === EMPLOYEE_HOME_PATH ? {} : selfBrowseState(returnHref.split("?")[1] || "");
    return selfBrowseHref({ ...context, view: mode === "leave" ? "leave" : "attendance", focus: id || "" });
  }
  async function save() {
    if (!canSubmit || !editing || inFlight.current || committedRef.current) return;
    let payload: ReturnType<typeof selfEditorPayload>;
    try {
      payload = selfEditorPayload(mode, values);
      if (mode === "leave" && !resources.meta!.leave_types.some(row => row.id === values.leave_type_id)) throw new Error("Choose an available leave type.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Review the form."); return; }
    inFlight.current = true; setBusy(true); setActionKey("save"); setError(null); setMessage(null);
    try {
      const path = mode === "leave" ? "/api/hr/leave-requests" : mode === "review_edit" ? `/api/hr/self/performance/${encodeURIComponent(reviewId)}` : "/api/hr/self/attendance-requests";
      const result = await request<{ id?: string; status?: string }>(path, { method: mode === "review_edit" ? "PATCH" : "POST", body: JSON.stringify(payload) });
      committedRef.current = true;
      if (!mounted.current) return;
      const id = typeof result?.id === "string" ? result.id : null;
      setCommitted(true); setSavedId(id); navigation.markClean();
      setMessage(mode === "leave" ? `Leave request saved${result?.status ? ` · ${result.status}` : ""}.` : mode === "review_edit" ? "Self review saved." : "Attendance request submitted to HR.");
      navigation.navigate(savedDestination(id), { discard: true, replace: true });
    } catch (reason) { if (mounted.current) setError(committedRef.current ? "This change was saved. Open the saved result; do not submit it again." : reason instanceof Error ? reason.message : "Unable to save this request. Check its history before retrying if the response was interrupted."); }
    finally { inFlight.current = false; if (mounted.current) { setBusy(false); setActionKey(null); } }
  }
  async function runAction(key: string, action: () => Promise<unknown>, success: string, refresh = true) {
    if (inFlight.current || !canHR || !resources.self) return;
    inFlight.current = true; setBusy(true); setActionKey(key); setError(null); setMessage(null);
    let written = false;
    try {
      const result = await action();
      if (result === CANCELLED_ACTION) return;
      written = true;
      if (!mounted.current) return;
      setMessage(success);
      if (refresh && !await load(false) && mounted.current) setError("The action completed, but some updated information could not be loaded. Refresh the result before repeating an action.");
    } catch (reason) { if (mounted.current) setError(written ? "The action completed. Refresh its history before repeating it." : reason instanceof Error ? reason.message : "The result could not be confirmed. Check the latest record before retrying."); }
    finally { inFlight.current = false; if (mounted.current) { setBusy(false); setActionKey(null); } }
  }
  function attendanceAction(kind: "check-in" | "check-out") {
    if (editing || !resources.self || (kind === "check-in" && (!resources.plan || resources.plan.mode === "off" || resources.plan.attendance?.check_in_at))) return;
    return runAction(kind, async () => {
      const actionEpoch = epoch.current;
      const body = kind === "check-in" ? await selfCheckInBody(resources.plan!) : undefined;
      if (body === null || !mounted.current || actionEpoch !== epoch.current) return CANCELLED_ACTION;
      return request(`/api/hr/self/${kind}`, { method: "POST", body });
    }, kind === "check-in" ? "Checked in successfully." : "Checked out successfully.");
  }
  function cancelLeave(id: string) {
    if (editing || inFlight.current || !resources.self?.leave_requests.some(row => row.id === id && row.status === "pending")) return;
    if (!window.confirm("Cancel this pending leave request? This action will be recorded in the audit trail.")) return;
    return runAction(`leave:${id}`, () => request(`/api/hr/self/leave-requests/${encodeURIComponent(id)}/cancel`, { method: "POST" }), "Leave request cancelled.");
  }
  function acknowledge(id: string) {
    if (editing || !resources.acks || resources.acks[id] || !resources.self?.announcements.some(row => row.id === id && row.is_policy)) return;
    return runAction(`policy:${id}`, async () => {
      const result = await request<{ announcement_id: string; acknowledged_at: string }>(`/api/hr/self/announcements/${encodeURIComponent(id)}/acknowledge`, { method: "POST" });
      if (mounted.current && result?.announcement_id === id && typeof result.acknowledged_at === "string") setResources(old => ({ ...old, acks: { ...old.acks, [id]: result.acknowledged_at } }));
      return result;
    }, "Policy acknowledged.");
  }
  function back() { navigation.navigate(mode === "review_edit" ? selfReviewHref(reviewId, returnHref) : returnHref); }
  const currentReturn = mode === "home" ? EMPLOYEE_HOME_PATH : selfBrowseHref(browse);
  return { resources, readErrors, loading, busy, actionKey, error, message, mode, editing, review, reviewId, browse, returnHref, canHR, canWork, timezone: resources.plan?.timezone || tenant?.organization.timezone || "UTC", values, dirty, committed, canSubmit, change, changeBrowse, load, save, back, attendanceAction, cancelLeave, acknowledge,
    openEditor: (next: "leave" | "remote" | "correction") => navigation.navigate(selfEditorHref(next, currentReturn)),
    openReview: (id: string) => { if (!inFlight.current) router.push(selfReviewHref(id, selfBrowseHref({ ...browse, focus: id }))); },
    openReviewEditor: () => { if (review && review.status !== "completed") navigation.navigate(selfReviewHref(reviewId, returnHref, true)); },
    openSaved: () => navigation.navigate(savedDestination(), { discard: true, replace: true }) };
}
export type SelfServiceWorkspaceState = ReturnType<typeof useSelfServiceWorkspace>;
