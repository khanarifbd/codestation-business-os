"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { blankReconciliation, isReconciliationDetail, isReconciliationMeta, isReconciliationSession, matchesCreatedReconciliation, reconciliationCreateBody, reconciliationIdentity, reconciliationPreview, reconciliationRecord, reconciliationWriteRejected } from "@/components/accounting-reconciliation/reconciliation-model";
import type { ReconciliationAccount, ReconciliationSession, ReconciliationValues } from "@/components/accounting-reconciliation/reconciliation-types";
import { reconciliationDocumentHref } from "@/lib/reconciliation-navigation";
import { getApiErrorMessage } from "@/lib/api-error";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { useReconciliationPermissions, useReconciliationResource } from "./use-reconciliation-resource";

type CreationOperation = { values: ReconciliationValues; account: ReconciliationAccount; body: string };
export function useReconciliationCreate(returnHref: string) {
  const { canView, canManage } = useReconciliationPermissions(), router = useRouter();
  const meta = useReconciliationResource("/api/accounting/reconciliations/meta", canView, isReconciliationMeta);
  const [values, setValues] = useState<ReconciliationValues>(blankReconciliation);
  const [phase, setPhase] = useState<"idle" | "uncertain" | "confirmed">("idle"), [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false), [version, setVersion] = useState(0), [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<ReconciliationSession | null>(null), [candidateId, setCandidateId] = useState("");
  const [recovering, setRecovering] = useState(false), [recoveryError, setRecoveryError] = useState<string | null>(null);
  const mounted = useRef(true), inFlight = useRef(false), committed = useRef(false), uncertain = useRef(false);
  const sequence = useRef(0), confirmation = useRef(0), readEpoch = useRef(0), valuesRef = useRef(values);
  const operation = useRef<CreationOperation | null>(null), candidate = useRef(""), verified = useRef("");
  const preview = reconciliationPreview(values, meta.value);
  const dirty = phase !== "confirmed" && (phase === "uncertain" || JSON.stringify(values) !== JSON.stringify(blankReconciliation()));
  const navigation = useDocumentNavigationGuard(dirty, { documentLabel: "reconciliation", isBusy: saving, pendingRef: inFlight,
    discardMessage: phase === "uncertain" ? "This reconciliation draft may already exist. Leaving loses this tab’s retained request. Verify the account’s statements before creating another draft. Leave anyway?" : undefined });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readEpoch.current += 1; }; }, []);

  function change<K extends keyof ReconciliationValues>(key: K, value: ReconciliationValues[K]) {
    if (!mounted.current || !canManage || inFlight.current || committed.current || uncertain.current) return;
    confirmation.current = 0; setConfirmOpen(false); setError(null);
    valuesRef.current = { ...valuesRef.current, [key]: value }; setValues(valuesRef.current);
  }
  function review() {
    const current = reconciliationPreview(valuesRef.current, meta.value);
    if (!mounted.current || !canView || !canManage || inFlight.current || committed.current || uncertain.current || current.error) return;
    confirmation.current = ++sequence.current; setVersion(confirmation.current); setConfirmOpen(true); setError(null);
  }
  function cancelReview() { if (!inFlight.current && confirmation.current === version) { confirmation.current = 0; setConfirmOpen(false); } }
  async function refreshMeta() {
    if (inFlight.current || committed.current || uncertain.current) return;
    confirmation.current = 0; setConfirmOpen(false); await meta.refresh();
  }
  async function verifyCandidate(id = candidate.current) {
    if (!mounted.current || !committed.current || !operation.current || !reconciliationIdentity(id) || !canView) return;
    const request = ++readEpoch.current; setRecovering(true); setRecoveryError(null);
    try {
      const response = await fetch(`/api/accounting/reconciliations/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current || request !== readEpoch.current) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) throw new Error(getApiErrorMessage(body, "The acknowledged statement could not be read."));
      if (!isReconciliationDetail(body) || body.id !== id || !matchesCreatedReconciliation(body, operation.current.values, operation.current.account)) throw new Error("The returned statement does not match this creation request. Do not create a replacement; inspect the account’s records.");
      verified.current = body.id; setDocument(body);
    } catch (reason) {
      if (mounted.current && request === readEpoch.current) setRecoveryError(reason instanceof Error ? reason.message : "Statement verification is unavailable.");
    } finally { if (mounted.current && request === readEpoch.current) setRecovering(false); }
  }
  async function create() {
    const current = reconciliationPreview(valuesRef.current, meta.value);
    if (!mounted.current || !canView || !canManage || inFlight.current || committed.current || uncertain.current || !confirmOpen || !version || confirmation.current !== version || current.error || !current.account) return;
    inFlight.current = true; confirmation.current = 0; setSaving(true); setError(null);
    let attempted = false, classified = false;
    try {
      const snapshot = { ...valuesRef.current };
      operation.current = { values: snapshot, account: { ...current.account }, body: reconciliationCreateBody(snapshot) };
      attempted = true;
      const response = await fetch("/api/accounting/reconciliations", { method: "POST", headers: { "Content-Type": "application/json" }, body: operation.current.body });
      // This POST is not keyed: latch a known commit before parsing or navigation.
      if (response.ok) { committed.current = true; uncertain.current = false; }
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) {
        classified = true;
        if (!reconciliationWriteRejected(response.status, body)) { uncertain.current = true; setPhase("uncertain"); }
        else { operation.current = null; setPhase("idle"); }
        throw new Error(getApiErrorMessage(body, "The reconciliation draft could not be confirmed."));
      }
      setPhase("confirmed"); navigation.markClean(); setConfirmOpen(false);
      const id = reconciliationRecord(body) && reconciliationIdentity(body.id) ? body.id : "";
      candidate.current = id; setCandidateId(id);
      if (isReconciliationSession(body) && matchesCreatedReconciliation(body, snapshot, current.account)) { verified.current = body.id; setDocument(body); }
      else if (id) { setRecoveryError("Creation was acknowledged. Verify the returned statement before opening it."); await verifyCandidate(id); }
      else setRecoveryError("Creation was acknowledged without a verifiable statement ID. Do not create another draft; inspect the current company’s register.");
    } catch (reason) {
      if (!mounted.current) return;
      if (!committed.current && attempted && !classified) { uncertain.current = true; setPhase("uncertain"); }
      if (committed.current) { setPhase("confirmed"); navigation.markClean(); }
      setConfirmOpen(false); setError(reason instanceof Error ? reason.message : "The creation outcome is uncertain.");
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  function openDocument(matching = false) {
    if (!committed.current || !document || verified.current !== document.id) return;
    const opened = navigation.navigate(reconciliationDocumentHref(document.id, returnHref, matching && canManage && document.status === "draft"), { discard: true, replace: true });
    if (!opened) setRecoveryError("The acknowledged statement is retained. Try opening it again; do not create another draft.");
  }
  return { canView, canManage, meta, values, change, preview, phase, saving, locked: saving || phase !== "idle", dirty, confirmOpen,
    review, cancelReview, create, error, document, candidateId, recovering, recoveryError, verifyCandidate, openDocument, refreshMeta,
    back: () => navigation.navigate(returnHref, { replace: committed.current }),
  };
}
export type ReconciliationCreateState = ReturnType<typeof useReconciliationCreate>;
