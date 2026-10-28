"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isReconciliationDetail, reconciliationPage, reconciliationTransactions, reconciliationWriteRejected, reconciliationZero } from "@/components/accounting-reconciliation/reconciliation-model";
import type { ReconciliationDetail, ReconciliationOperation, ReconciliationSelection } from "@/components/accounting-reconciliation/reconciliation-types";
import { reconciliationDocumentHref, reconciliationSelection } from "@/lib/reconciliation-navigation";
import { getApiErrorMessage } from "@/lib/api-error";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { useReconciliationPermissions, useReconciliationResource } from "./use-reconciliation-resource";

type Phase = "idle" | "uncertain" | "acknowledged" | "discarded";
export function useReconciliationDocument(id: string, matching: boolean, returnHref: string) {
  const { canView, canManage } = useReconciliationPermissions(), router = useRouter(), query = useSearchParams();
  const validate = useCallback((value: unknown): value is ReconciliationDetail => isReconciliationDetail(value) && value.id === id, [id]);
  const resource = useReconciliationResource(`/api/accounting/reconciliations/${encodeURIComponent(id)}`, canView, validate);
  const document = resource.value, selection = reconciliationSelection(query.toString());
  const page = reconciliationPage(reconciliationTransactions(document?.transactions || [], selection), selection.page);
  const [phase, setPhase] = useState<Phase>("idle"), [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<ReconciliationOperation | null>(null), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<"finalize" | "discard" | null>(null), [version, setVersion] = useState(0);
  const mounted = useRef(true), inFlight = useRef(false), phaseRef = useRef<Phase>("idle");
  const pending = useRef<ReconciliationOperation | null>(null), reviewed = useRef<ReconciliationOperation | null>(null);
  const sequence = useRef(0), confirmation = useRef(0), recoveryEpoch = useRef(0);
  const dirty = phase === "uncertain" || phase === "acknowledged";
  const navigation = useDocumentNavigationGuard(dirty, { documentLabel: "reconciliation", enabled: matching, isBusy: busy, pendingRef: inFlight,
    discardMessage: dirty ? "The last reconciliation action still needs verification. Leaving loses this tab’s retained action; inspect the account’s current statement before repeating it. Leave anyway?" : undefined });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; recoveryEpoch.current += 1; }; }, []);
  const viewHref = reconciliationDocumentHref(id, returnHref, false, selection), matchingHref = reconciliationDocumentHref(id, returnHref, true, selection);
  const ready = canView && canManage && matching && document?.status === "draft" && !resource.loading && !resource.error;
  const editable = Boolean(ready && !busy && phase === "idle" && !confirmKind);
  function updatePhase(value: Phase) { phaseRef.current = value; setPhase(value); }
  function clearConfirmation() { confirmation.current = 0; reviewed.current = null; setConfirmKind(null); }
  function baseOperation(kind: ReconciliationOperation["kind"], transactionId?: string): ReconciliationOperation | null {
    if (!document || document.id !== id) return null;
    const tx = transactionId ? document.transactions.find(row => row.id === transactionId) : null;
    if (transactionId && !tx) return null;
    return { sessionId: id, kind, ...(transactionId ? { transactionId } : {}), label: tx?.reference || tx?.description || (tx ? tx.id : document.account_name), amount: tx?.amount ?? document.statement_ending_balance, currency: document.currency, account: document.account_name, statementEnd: document.statement_end_date };
  }
  function reviewAction(kind: "finalize" | "discard") {
    if (!mounted.current || !ready || inFlight.current || pending.current || phaseRef.current !== "idle" || kind === "finalize" && !reconciliationZero(document!.difference)) return;
    const op = baseOperation(kind); if (!op) return;
    confirmation.current = ++sequence.current; reviewed.current = op; setVersion(confirmation.current); setOperation(op); setConfirmKind(kind); setError(null); setMessage(null);
  }
  function cancelReview() {
    if (!inFlight.current && confirmation.current === version) { clearConfirmation(); if (!pending.current) setOperation(null); }
  }
  /** A missing transaction in the oldest-2,000 slice is NOT evidence that it is
   * unmatched. Only a returned matching identity/desired state releases a latch. */
  async function verifyOperation(op: ReconciliationOperation) {
    const request = ++recoveryEpoch.current;
    const result = await resource.refresh();
    if (!mounted.current || request !== recoveryEpoch.current || !result.current || pending.current !== op) return;
    if (op.kind === "discard" && result.status === 404) {
      pending.current = null; updatePhase("discarded"); navigation.markClean(); setError(null); setMessage("This statement is no longer present. No request was replayed; its financial transactions are not deleted by discarding a draft."); return;
    }
    const row = result.value;
    if (!row) { setError(result.error || "The retained action still needs a verified statement read. Do not repeat it based on this read failure."); return; }
    let verified = false;
    if (op.kind === "finalize") verified = row.status === "finalized";
    else if (op.kind === "match" || op.kind === "unmatch") {
      const tx = row.transactions.find(value => value.id === op.transactionId);
      if (!tx) { setError("The target transaction is absent from this capped response. Absence does not prove its matching state; inspect the account’s records before repeating or reversing the action."); return; }
      verified = tx.selected === (op.kind === "match");
    }
    if (verified) {
      pending.current = null; setOperation(null); updatePhase("idle"); navigation.markClean(); setError(null);
      setMessage(op.kind === "finalize" ? "The server now reports finalized selections. No request was replayed; historical totals can still recalculate." : "The current server selection matches the requested state. No write was replayed; this does not identify who applied it.");
    } else setError("The latest read does not establish the requested outcome. The original action remains retained; no automatic retry or opposite selection is allowed.");
  }
  async function perform(op: ReconciliationOperation) {
    if (!mounted.current || !ready || inFlight.current || pending.current || phaseRef.current !== "idle" || op.sessionId !== id) return;
    if (op.kind === "finalize" && !reconciliationZero(document!.difference)) return;
    inFlight.current = true; pending.current = op; clearConfirmation(); setOperation(op); setBusy(true); setError(null); setMessage(null);
    let acknowledged = false, classified = false;
    try {
      const base = `/api/accounting/reconciliations/${encodeURIComponent(id)}`;
      const url = op.kind === "match" || op.kind === "unmatch" ? `${base}/transactions/${encodeURIComponent(op.transactionId!)}` : op.kind === "finalize" ? `${base}/finalize` : base;
      const response = await fetch(url, { method: op.kind === "unmatch" || op.kind === "discard" ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, ...(op.kind === "finalize" ? { body: "{}" } : {}) });
      if (response.ok) { acknowledged = true; phaseRef.current = op.kind === "discard" ? "discarded" : "acknowledged"; }
      const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
      if (!mounted.current) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) {
        classified = true;
        if (reconciliationWriteRejected(response.status)) {
          pending.current = null; setOperation(null); updatePhase("idle");
          setError(getApiErrorMessage(body, "The reconciliation action was rejected. Current statement state must be read before another action."));
          await resource.refresh();
        } else { updatePhase("uncertain"); setError(getApiErrorMessage(body, "The action may have completed. Recheck the statement without repeating it.")); }
        return;
      }
      if (op.kind === "discard") {
        pending.current = null; updatePhase("discarded"); navigation.markClean(); setMessage("The draft deletion was acknowledged. No financial transactions or account balances were deleted by this action."); return;
      }
      updatePhase("acknowledged"); setMessage("The action was acknowledged. Checking the current statement before allowing another selection…");
      await verifyOperation(op);
    } catch (reason) {
      if (!mounted.current) return;
      if (!acknowledged && !classified) updatePhase("uncertain");
      else if (acknowledged) updatePhase(op.kind === "discard" ? "discarded" : "acknowledged");
      setError(reason instanceof Error ? reason.message : "The action outcome is uncertain. Verify current state before repeating it.");
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function confirmAction() {
    if (!confirmKind || !reviewed.current || !version || confirmation.current !== version || reviewed.current.kind !== confirmKind) return;
    return perform(reviewed.current);
  }
  function toggle(transactionId: string) {
    if (!ready || inFlight.current || pending.current || reviewed.current || phaseRef.current !== "idle") return;
    const tx = document!.transactions.find(row => row.id === transactionId); if (!tx) return;
    const op = baseOperation(tx.selected ? "unmatch" : "match", tx.id); if (op) return perform(op);
  }
  async function recheck() {
    if (!mounted.current || inFlight.current || !canView) return;
    if (!pending.current) { clearConfirmation(); setOperation(null); await resource.refresh(); return; }
    inFlight.current = true; setBusy(true);
    try { await verifyOperation(pending.current); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function changeSelection(patch: Partial<ReconciliationSelection>) {
    if (inFlight.current || pending.current || reviewed.current) return;
    router.replace(reconciliationDocumentHref(id, returnHref, matching, { ...selection, page: 1, ...patch }));
  }
  function back() { return navigation.navigate(phaseRef.current === "discarded" ? returnHref : matching ? viewHref : returnHref, { replace: phaseRef.current === "discarded" }); }
  return { canView, canManage, matching, resource, document, selection, page, changeSelection, editable, busy, phase, operation, error, message,
    confirmKind, reviewAction, cancelReview, confirmAction, toggle, recheck, refresh: recheck, back, viewHref, matchingHref,
  };
}
export type ReconciliationDocumentState = ReturnType<typeof useReconciliationDocument>;
