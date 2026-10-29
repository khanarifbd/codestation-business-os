"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useHRAccess } from "@/components/hr-access-context";
import { isHRTimeMeta, record, timeError, validHRAccess } from "@/components/hr-time/hr-time-model";
import { eventIntent, eventReceipt, type EventIntent, type EventReceipt } from "@/components/hr-records/event-create-model";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { useHRTimeLifetime, useHRTimeResource } from "./use-hr-time-resource";
import { HR_EVENT_CREATE, safeRecordsReturn } from "@/lib/hr-records-navigation";

type Phase = "idle" | "review" | "pending" | "rejected" | "acknowledged" | "confirmed" | "unknown";
const UNKNOWN = "The save outcome is unknown. This event may already have been recorded and any employment change may already have taken effect. Do not submit it again.";
const ACK = "The server acknowledged the save, but a valid event reference was not returned. Do not submit it again.";
const knownRejection = (status: number, body: unknown) => [400, 401, 403, 404, 422].includes(status) && record(body) && (typeof body.detail === "string" || status === 422 && Array.isArray(body.detail));

/** One reviewed intent per page. An uncertain result is never made retryable by a later read. */
export function useHRRecordsEventCreate() {
  const session = useDashboardSession(), cap = useHRAccess(), router = useRouter(), pathname = usePathname(), query = useSearchParams();
  const access = validHRAccess(cap.access) ? cap.access : null;
  const scope = JSON.stringify([session.tenant?.organization.id, session.tenant?.membership_id, session.tenant?.role_id, session.tenant?.status, session.tenant?.permissions, session.profile?.email, session.loading, cap.loading, access, pathname]);
  const { owner, current } = useHRTimeLifetime(scope);
  const canManage = Boolean(session.tenant) && !session.loading && !cap.loading && access?.can_view === true && access?.can_manage === true && pathname === HR_EVENT_CREATE;
  const meta = useHRTimeResource(scope, "/api/hr/meta", canManage, isHRTimeMeta);
  const pending = useRef(false), lock = useRef<Phase>("idle"), reviewed = useRef<EventIntent | null>(null), operation = useRef<object | null>(null);
  const [flight, setFlight] = useState({ owner, value: false });
  const [state, setState] = useState<{ owner: object; phase: Phase; message: string | null; intent: EventIntent | null; receipt: EventReceipt | null; dirty: boolean }>({ owner, phase: "idle", message: null, intent: null, receipt: null, dirty: false });
  useLayoutEffect(() => {
    pending.current = false; lock.current = "idle"; reviewed.current = null; operation.current = null;
    return () => { operation.current = null; pending.current = false; };
  }, [owner]);
  const value = state.owner === owner ? state : { phase: "idle" as Phase, message: null, intent: null, receipt: null, dirty: false };
  const busy = flight.owner === owner && flight.value, unresolved = value.phase === "unknown" || value.phase === "acknowledged";
  const navigation = useDocumentNavigationGuard(value.dirty || unresolved, { pendingRef: pending, isBusy: busy, documentLabel: "HR request", discardMessage: unresolved ? "This employment event may already have been saved. Leaving or reloading can lose this memory-only result. Do not repeat the event based on a later list. Leave this page?" : "Discard these employment event details and leave this page?" });
  const canEdit = () => current() && canManage && !pending.current && ["idle", "rejected"].includes(lock.current) && meta.isReady(meta.receipt);
  function changed() { if (canEdit()) setState(old => ({ ...old, owner, dirty: true })); }
  function review(form: HTMLFormElement) {
    if (!canEdit()) return false;
    const intent = eventIntent(new FormData(form), meta.value?.employees ?? []);
    if (!intent) {
      setState({ owner, phase: lock.current, message: "Choose a current company employee, an event type and a valid date. Enter a title of 1–180 characters and remove invalid text characters.", intent: null, receipt: null, dirty: true });
      return false;
    }
    reviewed.current = intent; lock.current = "review";
    setState({ owner, phase: "review", message: null, intent, receipt: null, dirty: true });
    return true;
  }
  function edit() {
    if (!current() || !canManage || pending.current || lock.current !== "review" || reviewed.current !== value.intent) return false;
    reviewed.current = null; lock.current = "idle";
    setState(old => ({ ...old, owner, phase: "idle", message: null, dirty: true }));
    return true;
  }
  async function submit() {
    const intent = value.intent;
    if (!current() || !canManage || pending.current || lock.current !== "review" || !intent || reviewed.current !== intent || !meta.isReady(meta.receipt)) return null;
    if (!meta.value?.employees.some(item => item.id === intent.employee_id)) return null;
    const token = {}; operation.current = token; pending.current = true; lock.current = "pending";
    setFlight({ owner, value: true });
    setState({ owner, phase: "pending", message: "Saving once. Keep this page open while the response settles.", intent, receipt: null, dirty: true });
    const belongs = () => current() && operation.current === token;
    const settle = (phase: Phase, message: string, receipt: EventReceipt | null = null) => {
      if (!belongs()) return;
      lock.current = phase;
      setState({ owner, phase, message, intent, receipt, dirty: phase !== "confirmed" });
    };
    try {
      const { employee_name: _displayName, ...payload } = intent;
      void _displayName;
      const response = await fetch("/api/hr/lifecycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!belongs()) return null;
      settle(response.ok ? "acknowledged" : "unknown", response.ok ? ACK : UNKNOWN);
      if (response.status === 401) router.replace("/login");
      const body: unknown = await response.json().catch(() => null);
      if (!belongs()) return null;
      if (response.ok) {
        if (response.status !== 201 || !eventReceipt(body)) return null;
        settle("confirmed", "Employment event saved. The server returned a verified event reference.", body);
        navigation.markClean();
        return body;
      }
      if (knownRejection(response.status, body)) {
        reviewed.current = null;
        settle("rejected", timeError(body, "The save was rejected. Review the details before trying deliberately."));
      }
      return null;
    } catch {
      if (belongs() && !["acknowledged", "confirmed"].includes(lock.current)) settle("unknown", UNKNOWN);
      return null;
    } finally { if (belongs()) { pending.current = false; setFlight({ owner, value: false }); } }
  }
  return { scope, accessLoading: session.loading || cap.loading, canManage, accessError: cap.error, ...value, meta, busy, unresolved, canEdit, changed, review, edit, submit, returnHref: safeRecordsReturn(query.get("returnTo")) };
}
