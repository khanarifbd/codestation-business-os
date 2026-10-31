"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { knownTimeRejection, record, timeError, timeId } from "@/components/hr-time/hr-time-model";
type Phase = "idle" | "pending" | "rejected" | "acknowledged" | "confirmed" | "unknown";
export type TimeWriteIntent = {
  path: string;
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  recordId?: string;
  status?: string;
  current: () => boolean;
  onConflict?: () => void;
};
export type TimeReview = {
  owner: object;
  intent: TimeWriteIntent;
  title: string;
};
export function useHRTimeAction(owner: object, current: () => boolean, dirty: boolean, returnHref: string) {
  const router = useRouter(), pending = useRef(false), lock = useRef<Phase>("idle"), token = useRef<object | null>(null), armed = useRef<TimeReview | null>(null);
  const [state, setState] = useState<{
    owner: object;
    phase: Phase;
    message: string | null;
    id: string | null;
  }>({ owner, phase: "idle", message: null, id: null });
  const [flight, setFlight] = useState({ owner, value: false }), [review, setReview] = useState<TimeReview | null>(null);
  useLayoutEffect(() => { pending.current = false; lock.current = "idle"; token.current = null; armed.current = null; return () => { token.current = null; armed.current = null; pending.current = false; }; }, [owner]);
  const phase = state.owner === owner ? state.phase : "idle", busy = flight.owner === owner && flight.value, unresolved = phase === "unknown" || phase === "acknowledged";
  const nav = useDocumentNavigationGuard((phase !== "confirmed" && dirty) || unresolved || Boolean(review), { pendingRef: pending, isBusy: busy, discardMessage: unresolved ? "This HR operation may already have completed. Leaving loses the memory-only outcome. Do not repeat it without review; a later list is not this operation’s receipt." : "Discard this HR draft and leave?" });
  const canEdit = () => current() && !pending.current && !armed.current && ["idle", "rejected"].includes(lock.current);
  function reject(message: string) {
    if (canEdit()) {
      lock.current = "rejected";
      setState({ owner, phase: "rejected", message, id: null });
    }
  }
  async function send(intent: TimeWriteIntent) {
    if (!current() || pending.current || !["idle", "rejected"].includes(lock.current) || !intent.current())
      return false;
    const operation = {};
    token.current = operation;
    pending.current = true;
    lock.current = "pending";
    armed.current = null;
    setFlight({ owner, value: true });
    setState({ owner, phase: "pending", message: null, id: null });
    const valid = () => current() && token.current === operation;
    function outcome(next: Phase, message: string, id: string | null = null) {
      if (!valid())
        return; lock.current = next; setState({ owner, phase: next, message, id });
    }
    try {
      const response = await fetch(intent.path, { method: intent.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent.body) });
      if (!valid())
        return false;
      if (response.ok)
        outcome("acknowledged", "The server acknowledged this request. Result details are not verified yet; do not repeat it.");
      else
        outcome("unknown", "The outcome is unknown. The record or decision may already exist. Review current records before any separate new intent; this document will not resend it.");
      if (response.status === 401)
        router.replace("/login");
      const body: unknown = await response.json().catch(() => null);
      if (!valid())
        return false;
      if (response.ok) {
        const matched = record(body) && timeId(body.id) && (!intent.recordId || body.id === intent.recordId) && (!intent.status || body.status === intent.status);
        if (matched) {
          outcome("confirmed", intent.method === "POST" ? "Attendance record acknowledged by the server. This was a new record, not a correction." : `Leave request ${intent.status}. The server acknowledged this decision.`, String(body.id));
          nav.markClean();
        }
        return true;
      }
      if (knownTimeRejection(response.status, body)) {
        if (response.status === 409) intent.onConflict?.();
        outcome("rejected", timeError(body, "The request was rejected. Review the input or reload current details before trying deliberately."));
      }
      return false;
    }
    catch {
      if (valid() && !["acknowledged", "confirmed"].includes(lock.current))
        outcome("unknown", "The response was interrupted and the outcome is unknown. Do not resend. Current records are not a receipt for this specific request.");
      return false;
    }
    finally {
      if (valid()) {
        pending.current = false;
        setFlight({ owner, value: false });
        setReview(null);
      }
    }
  }
  function arm(intent: TimeWriteIntent, title: string) {
    if (!canEdit() || !intent.current())
      return false; const value = { owner, intent: { ...intent, body: { ...intent.body } }, title }; armed.current = value; setReview(value); return true;
  }
  function closeReview() {
    if (!current() || pending.current || !review || review.owner !== owner || armed.current !== review)
      return false; armed.current = null; setReview(null); return true;
  }
  function confirm() {
    if (!current() || !review || review.owner !== owner || armed.current !== review)
      return Promise.resolve(false); return send(review.intent);
  }
  return { phase, busy, unresolved, message: state.owner === owner ? state.message : null, id: state.owner === owner ? state.id : null, review: review?.owner === owner ? review : null, canEdit, reject, arm, closeReview, confirm, submit: (intent: TimeWriteIntent) => armed.current ? Promise.resolve(false) : send(intent), back: () => current() ? nav.navigate(returnHref) : false, open: (href: string) => current() ? nav.navigate(href, { discard: phase === "confirmed" }) : false };
}
export type HRTimeAction = ReturnType<typeof useHRTimeAction>;
