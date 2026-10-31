"use client";
import { isDefiniteExpenseRejection } from "@/components/expenses/expense-write-outcome";

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { isAccounts } from "@/components/accounting-money-out/money-out-model";
import { blankExpense, changeExpenseValue, expensePreview } from "@/components/expenses/expense-model";
import { isExpenseDetail, isExpenseMeta, record } from "@/components/expenses/expense-read-model";
import { matchesExpenseOperation, prepareExpenseOperation, type ExpenseOperation } from "@/components/expenses/expense-operation";
import type { ExpenseDetail, ExpenseForm } from "@/components/expenses/expense-types";
import { expenseDocumentHref } from "@/lib/expense-navigation";
import { getApiErrorMessage } from "@/lib/api-error";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { useExpenseResource } from "./use-expense-resource";

export function useExpensePosting(returnHref: string) {
  const { tenant } = useDashboardSession(), router = useRouter();
  const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view"));
  const canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
  const metadata = useExpenseResource("/api/finance/expense-meta", canView, isExpenseMeta);
  const accounts = useExpenseResource("/api/finance/accounts", canView, isAccounts);
  const [values, setValues] = useState<ExpenseForm>(() => ({ ...blankExpense(), expense_currency: tenant?.organization.currency || "USD" }));
  const [initial] = useState(values);
  const [phase, setPhase] = useState<"idle" | "uncertain" | "confirmed">("idle"), [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false), [confirmationVersion, setConfirmationVersion] = useState(0);
  const [writeError, setWriteError] = useState<string | null>(null), [operationState, setOperationState] = useState<ExpenseOperation | null>(null);
  const [candidateId, setCandidateId] = useState(""), [document, setDocument] = useState<ExpenseDetail | null>(null);
  const [recovering, setRecovering] = useState(false), [recoveryError, setRecoveryError] = useState<string | null>(null);
  const mounted = useRef(true), inFlight = useRef(false), uncertain = useRef(false), committed = useRef(false), operation = useRef<ExpenseOperation | null>(null);
  const lifecycle = useRef(0);
  const sequence = useRef(0), confirmation = useRef(0), readEpoch = useRef(0), valuesRef = useRef(values), knownId = useRef(""), verifiedId = useRef("");
  const preview = expensePreview(values, metadata.value, accounts.value);
  const dirty = phase !== "confirmed" && (phase === "uncertain" || JSON.stringify(values) !== JSON.stringify(initial));
  const navigation = useDocumentNavigationGuard(dirty, { documentLabel: "expense", isBusy: saving, pendingRef: inFlight,
    discardMessage: phase === "uncertain" ? "This expense may already be posted. Leaving loses this tab’s original body and retry key. Verify the current company’s expense history before creating any replacement. Leave anyway?" : undefined });
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; lifecycle.current += 1; readEpoch.current += 1; }; }, []);

  function change<K extends keyof ExpenseForm>(key: K, value: ExpenseForm[K]) {
    if (!mounted.current || !canManage || inFlight.current || uncertain.current || committed.current) return;
    confirmation.current = 0; setConfirmOpen(false); setWriteError(null);
    const next = changeExpenseValue(valuesRef.current, key, value, metadata.value);
    valuesRef.current = next; setValues(next);
  }
  async function refreshSetup() {
    if (!mounted.current || inFlight.current || uncertain.current || committed.current) return;
    confirmation.current = 0; setConfirmOpen(false);
    await Promise.all([metadata.refresh(), accounts.refresh()]);
  }
  function review() {
    if (!mounted.current || !canView || !canManage || inFlight.current || committed.current || !uncertain.current && (preview.error || !preview.amounts)) return;
    confirmation.current = ++sequence.current; setConfirmationVersion(confirmation.current); setConfirmOpen(true); setWriteError(null);
  }
  function cancelReview() { if (mounted.current && !inFlight.current && confirmation.current === confirmationVersion) { confirmation.current = 0; setConfirmOpen(false); } }
  async function verifyCandidate(id = knownId.current) {
    if (!mounted.current || !committed.current || !operation.current || !id) return;
    const token = ++readEpoch.current; setRecovering(true); setRecoveryError(null);
    try {
      const response = await fetch(`/api/finance/expenses/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current || token !== readEpoch.current) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) throw new Error(getApiErrorMessage(body, "The acknowledged expense could not be read."));
      if (!isExpenseDetail(body) || body.id !== id || !matchesExpenseOperation(body, operation.current)) throw new Error("The returned expense does not match this request. Do not post a replacement; verify company records.");
      verifiedId.current = id; setDocument(body);
    } catch (reason) {
      if (mounted.current && token === readEpoch.current) setRecoveryError(reason instanceof Error ? reason.message : "Expense verification is unavailable.");
    } finally { if (mounted.current && token === readEpoch.current) setRecovering(false); }
  }
  async function postExpense() {
    if (!mounted.current || !canView || !canManage || !confirmOpen || confirmation.current !== confirmationVersion || !confirmationVersion || inFlight.current || committed.current || !uncertain.current && (preview.error || !preview.amounts)) return;
    inFlight.current = true; confirmation.current = 0; setSaving(true); setWriteError(null);
    const owner = lifecycle.current;
    let attempted = false, classified = false;
    try {
      if (!operation.current) operation.current = prepareExpenseOperation(valuesRef.current, preview, window.crypto.randomUUID());
      const op = operation.current; setOperationState(op); attempted = true;
      const response = await fetch("/api/finance/expenses", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": op.key }, body: op.body });
      if (!mounted.current || owner !== lifecycle.current) return;
      if (response.ok) { committed.current = true; uncertain.current = false; }
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current || owner !== lifecycle.current) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) {
        classified = true;
        if (uncertain.current || !isDefiniteExpenseRejection(response.status, body)) { uncertain.current = true; setPhase("uncertain"); }
        else { operation.current = null; setOperationState(null); setPhase("idle"); }
        throw new Error(getApiErrorMessage(body, "The expense could not be confirmed."));
      }
      setPhase("confirmed"); navigation.markClean(); setConfirmOpen(false);
      const candidate = record(body) && typeof body.id === "string" ? body.id.trim() : "";
      knownId.current = candidate; setCandidateId(candidate);
      if (isExpenseDetail(body) && matchesExpenseOperation(body, op)) { verifiedId.current = body.id; setDocument(body); }
      else if (candidate) { setRecoveryError("Posting was acknowledged. Verify the returned document before opening it."); await verifyCandidate(candidate); }
      else setRecoveryError("Posting was acknowledged, but no verifiable document ID was returned. Do not post again; inspect the current company’s expense register.");
    } catch (reason) {
      if (!mounted.current || owner !== lifecycle.current) return;
      if (!committed.current && attempted && !classified) { uncertain.current = true; setPhase("uncertain"); }
      if (committed.current) { setPhase("confirmed"); navigation.markClean(); }
      setConfirmOpen(false); setWriteError(reason instanceof Error ? reason.message : "The expense outcome is uncertain.");
    } finally { if (mounted.current && owner === lifecycle.current) { inFlight.current = false; setSaving(false); } }
  }
  function openDocument() { if (mounted.current && committed.current && document && verifiedId.current === document.id) navigation.navigate(expenseDocumentHref(document.id, returnHref), { discard: true, replace: true }); }
  return { canView, canManage, values, change, preview, metadata, accounts, refreshSetup, phase, saving, dirty, locked: saving || phase !== "idle", confirmOpen, review, cancelReview, postExpense,
    operation: operationState, writeError, document, candidateId, recovering, recoveryError, verifyCandidate, openDocument,
    back: () => mounted.current && navigation.navigate(returnHref, { replace: phase === "confirmed" }),
  };
}
export type ExpensePostingState = ReturnType<typeof useExpensePosting>;
