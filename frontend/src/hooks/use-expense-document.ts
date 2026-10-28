"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { isExpenseDetail } from "@/components/expenses/expense-read-model";
import type { ExpenseDetail } from "@/components/expenses/expense-types";
import { getApiErrorMessage } from "@/lib/api-error";
import { useExpenseResource } from "./use-expense-resource";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";

export function useExpenseDocument(expenseId: string) {
  const { tenant } = useDashboardSession();
  const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view"));
  const canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
  const validate = useCallback((body: unknown): body is ExpenseDetail => isExpenseDetail(body) && body.id === expenseId, [expenseId]);
  const resource = useExpenseResource(`/api/finance/expenses/${encodeURIComponent(expenseId)}`, canView && Boolean(expenseId), validate);
  return { canView, canManage, resource };
}
type DocumentAction = { kind: "void" | "delete"; expenseId: string; documentId?: string; title: string; number: string; amount: string | number; currency: string };
export function useExpenseDocumentActions(document: ExpenseDetail | null, canManage: boolean, refresh: () => Promise<ExpenseDetail | null>) {
  const router = useRouter(), [action, setAction] = useState<DocumentAction | null>(null), [open, setOpen] = useState(false), [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uncertain" | "confirmed">("idle"), [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [confirmationVersion, setConfirmationVersion] = useState(0);
  const sequence = useRef(0), confirmation = useRef(0);
  const mounted = useRef(true), inFlight = useRef(false), locked = useRef(false), armed = useRef(false), current = useRef(document), operation = useRef<DocumentAction | null>(null), readEpoch = useRef(0);
  useEffect(() => { current.current = document; }, [document]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readEpoch.current += 1; }; }, []);
  const navigation = useDocumentNavigationGuard(phase === "uncertain", { enabled: saving || phase === "uncertain", documentLabel: "expense", isBusy: saving, pendingRef: inFlight,
    discardMessage: "This expense action has an uncertain result. Verify current status or document metadata before repeating it. Leave anyway?" });
  function review(kind: "void" | "delete", documentId?: string) {
    const d = current.current;
    if (!mounted.current || !canManage || !d || inFlight.current || locked.current || kind === "void" && d.status !== "posted") return;
    const receipt = kind === "delete" ? d.documents.find(row => row.id === documentId) : null;
    if (kind === "delete" && !receipt) return;
    const op = { kind, expenseId: d.id, documentId, title: receipt?.title || d.description, number: d.expense_number, amount: d.account_amount, currency: d.account_currency };
    operation.current = op; armed.current = true; confirmation.current = ++sequence.current; setConfirmationVersion(confirmation.current); setAction(op); setOpen(true); setError(null); setMessage(null);
  }
  function cancel() { if (!inFlight.current && confirmation.current === confirmationVersion) { armed.current = false; confirmation.current = 0; setOpen(false); } }
  async function recheck() {
    const op = operation.current; if (!op || !mounted.current) return;
    const epoch = ++readEpoch.current, fresh = await refresh();
    if (!mounted.current || epoch !== readEpoch.current || !fresh || fresh.id !== op.expenseId) return;
    current.current = fresh;
    const resolved = op.kind === "void" ? fresh.status === "voided" : !fresh.documents.some(row => row.id === op.documentId);
    if (resolved) {
      locked.current = false; setPhase("idle"); setAction(null); setError(null);
      setMessage(op.kind === "void" ? "Current document is voided. The original expense remains visible for audit; do not repeat the reversal." : "The document is no longer listed on the current expense. Do not repeat deletion. Storage cleanup itself is not independently verified here.");
    }
  }
  async function confirm() {
    const op = operation.current;
    if (!mounted.current || !canManage || !op || !armed.current || !confirmationVersion || confirmation.current !== confirmationVersion || inFlight.current || locked.current) return;
    armed.current = false; confirmation.current = 0; inFlight.current = true; setSaving(true); setError(null);
    let acknowledged = false, classified = false;
    try {
      const response = await fetch(op.kind === "void" ? `/api/finance/expenses/${encodeURIComponent(op.expenseId)}/void` : `/api/expense-documents/${encodeURIComponent(op.expenseId)}/${encodeURIComponent(op.documentId!)}`, { method: op.kind === "void" ? "POST" : "DELETE" });
      if (response.ok) { acknowledged = true; locked.current = true; }
      const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
      if (!mounted.current) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) { classified = response.status < 500; throw new Error(getApiErrorMessage(body, "The expense action could not be confirmed.")); }
      setPhase("confirmed"); setOpen(false); setMessage("Action acknowledged. Reading current expense state; a read failure must not cause another write."); await recheck();
    } catch (reason) {
      if (!mounted.current) return;
      if (acknowledged) { locked.current = true; setPhase("confirmed"); }
      else if (!classified) { locked.current = true; setPhase("uncertain"); }
      setError(reason instanceof Error ? reason.message : "The action outcome is uncertain."); setOpen(false);
      // Document deletion can commit its metadata before storage cleanup fails.
      if (!classified && !acknowledged) await recheck();
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  return { action, open, saving, phase, message, error, review, cancel, confirm, recheck, locked: saving || phase !== "idle",
    back: (href: string) => locked.current || inFlight.current ? navigation.navigate(href) : router.push(href),
  };
}
