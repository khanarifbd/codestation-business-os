"use client";

import { verifiedHRRejectionBody } from "@/lib/hr-rejection-body";

import { useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useHRSettingsIdentity } from "./use-hr-settings-identity";
import { timeError } from "@/components/hr-time/hr-time-model";
import { assignmentIntent, assignmentReceipt, isAssignmentMeta, type AssignmentIntent } from "@/components/hr-settings/settings-model";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { useHRTimeLifetime, useHRTimeResource } from "./use-hr-time-resource";
import { HR_ASSIGNMENT_CREATE, safeSettingsReturn } from "@/lib/hr-settings-navigation";

type AssignmentReceipt = { id: string };
type Phase = "idle" | "review" | "pending" | "rejected" | "acknowledged" | "confirmed" | "unknown";
const UNKNOWN = "The save outcome is unknown. This schedule assignment may already have been recorded. Do not submit it again.";
const ACK = "The server acknowledged the save, but a valid assignment reference was not returned. Do not submit it again.";
const knownRejection = (status: number, body: unknown) => [401, 403, 404, 422].includes(status) && verifiedHRRejectionBody(body, status === 422);

/** One reviewed assignment intent per page. An uncertain result is never made retryable by a later read. */
export function useHRSettingsAssignmentCreate() {
  const identity = useHRSettingsIdentity(), router = useRouter(), pathname = usePathname(), query = useSearchParams();
  const scope = JSON.stringify([identity.scope, pathname]);
  const { owner, current } = useHRTimeLifetime(scope);
  const canManage = identity.canManage && pathname === HR_ASSIGNMENT_CREATE;
  const meta = useHRTimeResource(scope, "/api/hr/meta", canManage, isAssignmentMeta);
  const reviewedContext = useRef<typeof meta.receipt>(null);
  const pending = useRef(false), lock = useRef<Phase>("idle"), reviewed = useRef<AssignmentIntent | null>(null), operation = useRef<object | null>(null);
  const [flight, setFlight] = useState({ owner, value: false });
  const [state, setState] = useState<{ owner: object; phase: Phase; message: string | null; intent: AssignmentIntent | null; receipt: AssignmentReceipt | null; dirty: boolean }>({ owner, phase: "idle", message: null, intent: null, receipt: null, dirty: false });
  useLayoutEffect(() => {
    pending.current = false; reviewedContext.current = null; lock.current = "idle"; reviewed.current = null; operation.current = null;
    return () => { operation.current = null; pending.current = false; };
  }, [owner]);
  const value = state.owner === owner ? state : { phase: "idle" as Phase, message: null, intent: null, receipt: null, dirty: false };
  const busy = flight.owner === owner && flight.value, unresolved = value.phase === "unknown" || value.phase === "acknowledged";
  const navigation = useDocumentNavigationGuard(value.dirty || unresolved, { pendingRef: pending, isBusy: busy, documentLabel: "HR request", discardMessage: unresolved ? "This schedule assignment may already have been saved. Leaving or reloading can lose this memory-only result. Do not repeat the assignment based on a later list. Leave this page?" : "Discard these schedule assignment details and leave this page?" });
  const canEdit = () => current() && canManage && !pending.current && ["idle", "rejected"].includes(lock.current) && meta.isReady(meta.receipt);
  function changed() { if (canEdit()) setState(old => ({ ...old, owner, dirty: true })); }
  function review(form: HTMLFormElement) {
    if (!canEdit()) return false;
    const intent = assignmentIntent(new FormData(form), meta.value);
    if (!intent) {
      setState({ owner, phase: lock.current, message: "Choose an employee and an active schedule from the current company, and enter a valid effective date.", intent: null, receipt: null, dirty: true });
      return false;
    }
    reviewed.current = intent; reviewedContext.current = meta.receipt; lock.current = "review";
    setState({ owner, phase: "review", message: null, intent, receipt: null, dirty: true });
    return true;
  }
  function edit() {
    if (!current() || !canManage || pending.current || lock.current !== "review" || reviewed.current !== value.intent) return false;
    reviewed.current = null; reviewedContext.current = null; lock.current = "idle";
    setState(old => ({ ...old, owner, phase: "idle", message: null, dirty: true }));
    return true;
  }
  async function submit() {
    const intent = value.intent;
    if (!current() || !canManage || pending.current || lock.current !== "review" || !intent || reviewed.current !== intent || reviewedContext.current !== meta.receipt || !meta.isReady(meta.receipt)) return null;
    if (!meta.value?.employees.some(item => item.id === intent.employee_id) || !meta.value?.shifts.some(item => item.id === intent.shift_id)) return null;
    const token = {}; operation.current = token; pending.current = true; lock.current = "pending";
    setFlight({ owner, value: true });
    setState({ owner, phase: "pending", message: "Saving once. Keep this page open while the response settles.", intent, receipt: null, dirty: true });
    const belongs = () => current() && operation.current === token;
    const settle = (phase: Phase, message: string, receipt: AssignmentReceipt | null = null) => {
      if (!belongs()) return;
      lock.current = phase;
      setState({ owner, phase, message, intent, receipt, dirty: phase !== "confirmed" });
    };
    try {
      const payload = { employee_id: intent.employee_id, shift_id: intent.shift_id, effective_from: intent.effective_from };
      const response = await fetch("/api/hr/shift-assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!belongs()) return null;
      settle(response.ok ? "acknowledged" : "unknown", response.ok ? ACK : UNKNOWN);
      if (response.status === 401) router.replace("/login");
      const body: unknown = await response.json().catch(() => null);
      if (!belongs()) return null;
      if (response.ok) {
        if (response.status !== 201 || !assignmentReceipt(body)) return null;
        settle("confirmed", "Schedule assignment saved. The server returned a verified assignment reference.", body);
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
  return { reviewContextReady: () => reviewedContext.current === meta.receipt && meta.isReady(meta.receipt), scope, accessLoading: identity.accessLoading, canManage, accessError: identity.accessError, ...value, meta, busy, unresolved, canEdit, changed, review, edit, submit, returnHref: safeSettingsReturn(query.get("returnTo")) };
}
