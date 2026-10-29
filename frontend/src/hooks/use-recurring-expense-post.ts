"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiErrorMessage } from "@/lib/api-error";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { prepareRecurringPost, recurringPostBody, recurringPostId, recurringPostReceipt, type RecurringPostOperation, type RecurringPostPayload, type RecurringPostReceipt, type RecurringPostTarget } from "@/components/finance-controls/recurring-post-operation";

const UNKNOWN_EXIT = "This recurring expense may already be posted. Leaving loses this tab’s original retry key. Verify company expense records before recording any replacement. Leave anyway?";
export function useRecurringExpensePost(scope: string, canPost: boolean) {
  const router = useRouter();
  const [target, setTarget] = useState<RecurringPostTarget | null>(null), [payload, setPayload] = useState<RecurringPostPayload | null>(null);
  const [phase, setPhase] = useState<"idle" | "uncertain" | "confirmed">("idle"), [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false), [confirmationVersion, setConfirmationVersion] = useState(0);
  const [error, setError] = useState<string | null>(null), [receipt, setReceipt] = useState<RecurringPostReceipt | null>(null);
  const mounted = useRef(true), pending = useRef(false), committed = useRef(false), uncertain = useRef(false), dirtyRef = useRef(false);
  const targetRef = useRef<RecurringPostTarget | null>(null), operation = useRef<RecurringPostOperation | null>(null);
  const reviewRef = useRef<{ body: string; payload: RecurringPostPayload; target: RecurringPostTarget } | null>(null);
  const sequence = useRef(0), confirmation = useRef(0), generation = useRef(0);
  const current = useRef({ scope, canPost });
  useLayoutEffect(() => { current.current = { scope, canPost }; }, [scope, canPost]);
  const navigation = useDocumentNavigationGuard(dirty || phase === "uncertain", { enabled: Boolean(target), documentLabel: "expense", isBusy: saving, pendingRef: pending, discardMessage: phase === "uncertain" ? UNKNOWN_EXIT : undefined });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; confirmation.current = 0; }; }, []);
  const allowed = () => mounted.current && current.current.scope === scope && current.current.canPost;
  function confirmClose() {
    if (!allowed() || pending.current) return false;
    if (uncertain.current) { setError("Keep this operation open to retain its retry identity. Use a same-operation retry or inspect expense records; do not create a replacement."); return false; }
    return committed.current || !dirtyRef.current || window.confirm("Discard this unposted recurring expense form?");
  }
  function close() {
    if (!confirmClose()) return false;
    generation.current += 1; confirmation.current = 0; targetRef.current = null; reviewRef.current = null;
    dirtyRef.current = false; navigation.markClean(); setDirty(false); setTarget(null); setPayload(null); setConfirmOpen(false);
    return true;
  }
  function open(next: RecurringPostTarget) {
    if (!allowed() || pending.current || uncertain.current || !next.is_active || !recurringPostId(next.id) || targetRef.current && !confirmClose()) return false;
    generation.current += 1; confirmation.current = 0; committed.current = false; operation.current = null; reviewRef.current = null;
    const copy = { ...next }; targetRef.current = copy; dirtyRef.current = false; navigation.markClean();
    setTarget(copy); setPayload(null); setReceipt(null); setError(null); setDirty(false); setPhase("idle"); setConfirmOpen(false);
    return true;
  }
  function edit() {
    if (!allowed() || !targetRef.current || pending.current || committed.current || uncertain.current) return false;
    confirmation.current = 0; reviewRef.current = null; dirtyRef.current = true;
    setDirty(true); setConfirmOpen(false); setPayload(null); setError(null); return true;
  }
  function review(next: RecurringPostPayload) {
    if (!allowed() || !targetRef.current || pending.current || committed.current || uncertain.current) return false;
    const body = recurringPostBody(next), copy = JSON.parse(body) as RecurringPostPayload;
    reviewRef.current = { body, payload: copy, target: { ...targetRef.current } };
    confirmation.current = ++sequence.current; dirtyRef.current = true;
    setConfirmationVersion(confirmation.current); setDirty(true); setPayload(copy); setError(null); setConfirmOpen(true); return true;
  }
  function retryReview() {
    const op = operation.current;
    if (!allowed() || pending.current || committed.current || !uncertain.current || !op || op.scope !== scope) return false;
    const copy = JSON.parse(op.body) as RecurringPostPayload;
    reviewRef.current = { body: op.body, payload: copy, target: op.target };
    confirmation.current = ++sequence.current; setConfirmationVersion(confirmation.current); setPayload(copy); setError(null); setConfirmOpen(true); return true;
  }
  function cancelReview() { if (allowed() && !pending.current && confirmation.current === confirmationVersion) { confirmation.current = 0; setConfirmOpen(false); } }
  async function post() {
    const reviewed = reviewRef.current;
    if (!allowed() || !reviewed || !confirmOpen || !confirmationVersion || confirmation.current !== confirmationVersion || pending.current || committed.current
      || reviewed.target.id !== targetRef.current?.id || operation.current && operation.current.scope !== scope) return false;
    if (uncertain.current && (!operation.current || operation.current.body !== reviewed.body || operation.current.target.id !== reviewed.target.id)) return false;
    pending.current = true; confirmation.current = 0; setSaving(true); setError(null);
    const token = generation.current; let attempted = false, classified = false;
    try {
      if (!operation.current || operation.current.body !== reviewed.body || operation.current.target.id !== reviewed.target.id) {
        operation.current = prepareRecurringPost(scope, reviewed.target, reviewed.body, window.crypto.randomUUID());
      }
      const op = operation.current; attempted = true;
      const response = await fetch(op.path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": op.key }, body: op.body });
      // Acknowledgement survives malformed JSON, a failed readback, or subsequent navigation.
      if (response.ok) committed.current = true;
      const body: unknown = await response.json().catch(() => null);
      if (!allowed() || token !== generation.current) return false;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) {
        classified = true;
        if (uncertain.current || response.status >= 500 || [408,409,429].includes(response.status)) { uncertain.current = true; setPhase("uncertain"); }
        // Keep an unchanged rejected request's operation/body/key. An edited authoritative rejection is a new intent, not a retry.
        throw new Error(getApiErrorMessage(body, "Recurring expense posting was not confirmed."));
      }
      uncertain.current = false; dirtyRef.current = false; setPhase("confirmed"); setDirty(false); setConfirmOpen(false); navigation.markClean();
      const verified = recurringPostReceipt(body, op); setReceipt(verified);
      if (!verified) setError("Posting was acknowledged, but the returned expense identity could not be verified. Inspect existing company records; do not post again.");
      return true;
    } catch (reason) {
      if (!allowed() || token !== generation.current) return false;
      if (attempted && !classified && !committed.current) { uncertain.current = true; setPhase("uncertain"); }
      if (committed.current) { setPhase("confirmed"); dirtyRef.current = false; setDirty(false); navigation.markClean(); }
      setConfirmOpen(false); setError(reason instanceof Error ? reason.message : "The recurring expense outcome is uncertain."); return false;
    } finally { pending.current = false; if (mounted.current && current.current.scope === scope && token === generation.current) setSaving(false); }
  }
  function canStartOtherAction() { return mounted.current && current.current.scope === scope && !pending.current && !uncertain.current; }
  return { target, payload, phase, saving, dirty, confirmOpen, error, receipt, open, close, edit, review, retryReview, cancelReview, post,
    locked: Boolean(target) && (saving || phase !== "idle"), canPost, canStartOtherAction,
    navigateToExpenses: () => navigation.navigate("/dashboard/expenses"),
    navigateToReceipt: () => receipt && committed.current ? navigation.navigate(`/dashboard/expenses/${encodeURIComponent(receipt.expense_id)}`, { discard: true }) : false };
}
