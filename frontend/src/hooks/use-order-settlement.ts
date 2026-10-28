"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { getApiErrorMessage } from "@/lib/api-error";
import { initialSettlementDraft, isSettlementMeta, isSettlementOrder, isSettlementResult, isSettlementState, settlementPayload, settlementRecord, type SettlementDraft, type SettlementPayload, type SettlementResult, type SettlementSetup, type SettlementState } from "@/components/commercial/order-settlement-model";

export function settlementScope(tenant: ReturnType<typeof useDashboardSession>["tenant"], orderId: string) {
  return JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions, orderId]);
}
class SettlementReadError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function read(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new SettlementReadError(getApiErrorMessage(body, "Settlement information could not be loaded."), response.status);
  return body;
}
/** Independent read state: a failed read never means eligible, empty or unpaid. */
export function useOrderSettlementState(orderId: string) {
  const { tenant } = useDashboardSession(), router = useRouter();
  const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view"));
  const [value, setValue] = useState<SettlementState | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [denied, setDenied] = useState(false);
  const alive = useRef(true), epoch = useRef(0), identity = settlementScope(tenant, orderId), current = useRef(identity);
  useLayoutEffect(() => { current.current = identity; }, [identity]);
  useLayoutEffect(() => { alive.current = true; const tokens = [epoch]; return () => { alive.current = false; tokens.forEach(token => token.current++); }; }, []);
  const load = useCallback(async () => {
    if (!alive.current || current.current !== identity) return null;
    const e = ++epoch.current, scope = identity;
    const active = () => alive.current && epoch.current === e && current.current === scope;
    setValue(null); setError(null); setDenied(!canView);
    if (!canView) { setLoading(false); return null; }
    setLoading(true);
    try {
      const body = await read(`/api/finance/orders/${encodeURIComponent(orderId)}/settlement`);
      if (!active()) return null;
      if (!isSettlementState(body, orderId)) throw new Error("Settlement state or order identity could not be verified.");
      setValue(body); return body;
    } catch (reason) {
      if (!active()) return null;
      if (reason instanceof SettlementReadError && reason.status === 401) router.replace("/login");
      setDenied(reason instanceof SettlementReadError && reason.status === 403);
      setError(reason instanceof Error ? reason.message : "Settlement state unavailable."); return null;
    } finally { if (active()) setLoading(false); }
  }, [canView, identity, orderId, router]);
  return { value, loading, error, denied, canView, load };
}

type Phase = "idle" | "rejected" | "pending" | "unknown" | "acknowledged";
export type SettlementReview = { token: number; body: SettlementPayload; currency: string; orderNumber: string; total: string | number; accountName: string; categoryName: string | null };
const emptyDraft: SettlementDraft = { accountId: "", date: "", expenseAmount: "0.00", categoryId: "", description: "", reference: "", markSent: false };
export function useOrderSettlement(orderId: string, returnHref: string) {
  const { tenant } = useDashboardSession(), router = useRouter();
  const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view")), canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
  const identity = settlementScope(tenant, orderId), current = useRef(identity), alive = useRef(true), allowed = useRef(canView && canManage);
  const [setup, setSetup] = useState<SettlementSetup | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<SettlementDraft | null>(null), [submitted, setSubmitted] = useState<SettlementReview | null>(null);
  const [values, setValues] = useState<SettlementDraft>(emptyDraft), [phase, setPhase] = useState<Phase>("idle"), [review, setReview] = useState<SettlementReview | null>(null), [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SettlementResult | null>(null), [observed, setObserved] = useState<SettlementState | null>(null), [verifyError, setVerifyError] = useState<string | null>(null), [verifying, setVerifying] = useState(false);
  const pending = useRef(false), reading = useRef(false), phaseRef = useRef<Phase>("idle"), setupRef = useRef<SettlementSetup | null>(null), draft = useRef(values), baseline = useRef<SettlementDraft | null>(null), operation = useRef<{ review: SettlementReview; json: string; scope: string } | null>(null), nonce = useRef(0), armed = useRef(0), epoch = useRef(0), verifyEpoch = useRef(0);
  useLayoutEffect(() => { current.current = identity; allowed.current = canView && canManage; }, [identity, canView, canManage]);
  useLayoutEffect(() => { alive.current = true; const tokens = [epoch, verifyEpoch, armed]; return () => { alive.current = false; tokens.forEach(token => token.current++); }; }, []);
  const editable = () => alive.current && current.current === identity && allowed.current && !pending.current && (phaseRef.current === "idle" || phaseRef.current === "rejected");
  const dirty = phase === "unknown" || phase !== "acknowledged" && initial !== null && JSON.stringify(values) !== JSON.stringify(initial);
  const navigation = useDocumentNavigationGuard(dirty, { documentLabel: "order", isBusy: phase === "pending", pendingRef: pending, discardMessage: phase === "unknown" ? "This order settlement may already be recorded. Leaving loses this tab’s submitted context. Check the order’s invoice, payment and related expense before recording anything again. Leave this page?" : undefined });
  const load = useCallback(async () => {
    if (!alive.current || current.current !== identity) return;
    if (!canView || !canManage) { setLoading(false); return; }
    if (pending.current || !["idle", "rejected"].includes(phaseRef.current)) return;
    const e = ++epoch.current, scope = identity;
    const active = () => alive.current && current.current === scope && epoch.current === e;
    armed.current = 0; operation.current = null; setReview(null); setupRef.current = null; setSetup(null); setLoading(true); setLoadError(null);
    try {
      const [order, state, meta] = await Promise.all([
        read(`/api/sales/orders/${encodeURIComponent(orderId)}`), read(`/api/finance/orders/${encodeURIComponent(orderId)}/settlement`), read(`/api/finance/orders/${encodeURIComponent(orderId)}/settlement-meta`),
      ]);
      if (!active()) return;
      if (!isSettlementOrder(order, orderId) || !isSettlementState(state, orderId) || !isSettlementMeta(meta, orderId) || meta.currency !== order.currency || Number(meta.total) !== Number(order.total)) throw new Error("The order and settlement options could not be verified together.");
      const next = { order, state, meta }; setupRef.current = next; setSetup(next);
      if (baseline.current === null) { baseline.current = initialSettlementDraft(order); setInitial(baseline.current); draft.current = baseline.current; setValues(baseline.current); }
    } catch (reason) {
      if (!active()) return;
      if (reason instanceof SettlementReadError && reason.status === 401) router.replace("/login");
      setLoadError(reason instanceof Error ? reason.message : "Settlement setup unavailable.");
    } finally { if (active()) setLoading(false); }
  }, [canView, canManage, identity, orderId, router]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  function change<K extends keyof SettlementDraft>(field: K, value: SettlementDraft[K]) {
    if (!editable()) return;
    armed.current = 0; operation.current = null; setReview(null); setSubmitted(null); draft.current = { ...draft.current, [field]: value }; setValues(draft.current); setError(null);
  }
  function beginReview() {
    if (!editable() || !setupRef.current || loading) return;
    const prepared = settlementPayload(draft.current, setupRef.current);
    if (prepared.error) { setError(prepared.error); return; }
    const body = prepared.body!, snapshot = setupRef.current;
    const next: SettlementReview = { token: ++nonce.current, body, currency: snapshot.order.currency, orderNumber: snapshot.order.order_number, total: snapshot.order.total, accountName: snapshot.meta.accounts.find(a => a.id === body.account_id)!.name, categoryName: snapshot.meta.expense_categories.find(c => c.id === body.expense_category_id)?.name || null };
    armed.current = next.token; operation.current = { review: next, json: JSON.stringify(body), scope: identity }; setReview(next); setSubmitted(next); setError(null);
  }
  function cancelReview() { if (pending.current) return; armed.current = 0; operation.current = null; setReview(null); setSubmitted(null); }
  async function verify() {
    if (!alive.current || current.current !== identity || !canView || pending.current || reading.current || !["unknown", "acknowledged"].includes(phaseRef.current)) return;
    reading.current = true; const e = ++verifyEpoch.current, scope = identity; setVerifying(true); setVerifyError(null);
    const active = () => alive.current && current.current === scope && e === verifyEpoch.current;
    try { const body = await read(`/api/finance/orders/${encodeURIComponent(orderId)}/settlement`); if (!active()) return; if (!isSettlementState(body, orderId)) throw new Error("The returned settlement state or order identity could not be verified."); setObserved(body); }
    catch (reason) { if (!active()) return; if (reason instanceof SettlementReadError && reason.status === 401) router.replace("/login"); setVerifyError(reason instanceof Error ? reason.message : "Verification read unavailable."); }
    finally { reading.current = false; if (active()) setVerifying(false); }
  }
  async function confirm(token: number) {
    const op = operation.current;
    if (!editable() || !op || !armed.current || token !== armed.current || token !== op.review.token || op.scope !== identity) return;
    pending.current = true; armed.current = 0; phaseRef.current = "pending"; setPhase("pending"); setError(null);
    let acknowledged = false;
    try {
      const response = await fetch(`/api/finance/orders/${encodeURIComponent(orderId)}/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: op.json });
      // HTTP acknowledgement is authoritative even if JSON parsing or later reads fail.
      if (response.ok) acknowledged = true;
      if (!alive.current || current.current !== op.scope) return;
      if (acknowledged) { phaseRef.current = "acknowledged"; setPhase("acknowledged"); setReview(null); navigation.markClean(); }
      const body: unknown = await response.json().catch(() => null);
      if (!alive.current || current.current !== op.scope) return;
      if (!response.ok) {
        const explained = settlementRecord(body) && (typeof body.detail === "string" && Boolean(body.detail.trim()) || Array.isArray(body.detail) && body.detail.length > 0);
        if ([400, 401, 403, 404, 409, 422].includes(response.status) && explained) {
          phaseRef.current = "rejected"; setPhase("rejected"); operation.current = null; setReview(null); setSubmitted(null); setError(getApiErrorMessage(body, "Settlement was rejected. Your inputs are retained."));
          if (response.status === 409) { setupRef.current = null; setSetup(null); setLoadError("Refresh the existing order state before reviewing again. No new settlement has been submitted by this refresh."); }
          if (response.status === 401) router.replace("/login");
          return;
        }
        phaseRef.current = "unknown"; setPhase("unknown"); setReview(null); setError("The response did not establish whether this settlement was recorded. Do not submit again. Check the existing order settlement state."); return;
      }
      if (!isSettlementResult(body, orderId, op.review.body, op.review.currency, op.review.total)) { setError("Settlement was acknowledged, but its returned record could not be verified. Do not submit again; check the existing settlement state."); return; }
      setResult(body);
    } catch {
      if (!alive.current || current.current !== op.scope) return;
      phaseRef.current = acknowledged ? "acknowledged" : "unknown"; setPhase(phaseRef.current); setReview(null);
      if (acknowledged) navigation.markClean();
      setError(acknowledged ? "Settlement was acknowledged but its result is unavailable. Do not submit again." : "The request ended without a confirmed outcome. This settlement may already be recorded. Posting remains locked; verify the existing records.");
    } finally { pending.current = false; }
  }
  return { canView, canManage, setup, values, change, loading, loadError, load, phase, dirty, review, beginReview, cancelReview, confirm, error, result, observed, verifying, verifyError, verify, submitted, locked: phase === "pending" || phase === "unknown" || phase === "acknowledged", back: () => navigation.navigate(returnHref), returnHref };
}
export type OrderSettlementWorkspaceState = ReturnType<typeof useOrderSettlement>;
