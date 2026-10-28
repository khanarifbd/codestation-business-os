"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ConfirmationDetail } from "@/components/financial-confirmation-dialog";
import { getApiErrorMessage } from "@/lib/api-error";
import { matchesProjectIncomeReceipt, returnedProjectIncomeId, type ProjectIncomePayload } from "@/components/projects/project-income-operation";

type Phase = "idle" | "review" | "pending" | "rejected" | "unknown" | "acknowledged";
type Operation = {
  token: number; key: string; body: string; payload: ProjectIncomePayload; currency: string;
  details: ConfirmationDetail[]; phase: Phase; uncertain: boolean; acknowledged: boolean;
};
type State = {
  phase: Phase; token: number; key: string | null; message: string | null;
  details: ConfirmationDetail[]; incomeId: string | null; verified: boolean;
};
const empty: State = { phase: "idle", token: 0, key: null, message: null, details: [], incomeId: null, verified: false };

export function useProjectIncomeOperation({ canPost, isCurrent, pendingRef, onRecorded }: {
  canPost: boolean; isCurrent: () => boolean; pendingRef: { current: boolean };
  onRecorded: () => Promise<boolean>;
}) {
  const [state, setState] = useState<State>(empty);
  const operation = useRef<Operation | null>(null), sequence = useRef(0);
  const latest = useRef({ canPost, onRecorded });
  useLayoutEffect(() => { latest.current = { canPost, onRecorded }; }, [canPost, onRecorded]);

  const review = useCallback((payload: ProjectIncomePayload, currency: string, details: ConfirmationDetail[]) => {
    if (!isCurrent() || pendingRef.current || !latest.current.canPost || operation.current && ["pending", "unknown", "acknowledged"].includes(operation.current.phase)) return false;
    if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
      setState({ ...empty, phase: "rejected", message: "A safe request identity could not be created. No income was submitted." });
      return false;
    }
    const body = JSON.stringify(payload), token = ++sequence.current;
    const frozen: Operation = { token, key: crypto.randomUUID(), body, payload: JSON.parse(body) as ProjectIncomePayload, currency, details: details.map(item => ({ ...item })), phase: "review", uncertain: false, acknowledged: false };
    operation.current = frozen;
    setState({ ...empty, phase: "review", token, key: frozen.key, details: frozen.details });
    return true;
  }, [isCurrent, pendingRef]);

  const cancel = useCallback((token: number) => {
    if (!isCurrent() || pendingRef.current || operation.current?.token !== token || operation.current.phase !== "review") return;
    operation.current = null;
    setState(empty);
  }, [isCurrent, pendingRef]);

  const submit = useCallback(async (token: number, retry = false) => {
    const op = operation.current;
    if (!isCurrent() || pendingRef.current || !latest.current.canPost || !op || op.token !== token || op.acknowledged || op.phase !== (retry ? "unknown" : "review")) return;
    pendingRef.current = true;
    op.phase = "pending";
    setState(previous => ({ ...previous, phase: "pending", message: null }));
    try {
      const response = await fetch("/api/accounting/money/income-with-fee", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": op.key }, body: op.body,
      });
      if (!isCurrent() || operation.current !== op) return;
      // A known acknowledgment must never become a retry just because parsing/readback fails.
      if (response.ok) {
        op.acknowledged = true; op.phase = "acknowledged";
        setState(previous => ({ ...previous, phase: "acknowledged", message: "Income was acknowledged. Verifying the returned record…" }));
      }
      const payload: unknown = await response.json().catch(() => null);
      if (!isCurrent() || operation.current !== op) return;
      if (!response.ok) {
        const detail = getApiErrorMessage(payload, "Unable to record project income.");
        op.uncertain ||= response.status >= 500 || response.status === 409 || ![400, 401, 403, 404, 422].includes(response.status);
        op.phase = op.uncertain ? "unknown" : "rejected";
        setState(previous => ({ ...previous, phase: op.phase, message: op.uncertain ? `${detail} The original outcome remains unknown. Do not create a new income for this attempt.` : detail }));
        return;
      }
      const incomeId = returnedProjectIncomeId(payload);
      const verified = matchesProjectIncomeReceipt(payload, op.payload, op.currency);
      setState(previous => ({ ...previous, phase: "acknowledged", incomeId, verified, message: verified ? "Income and any fee were recorded." : "The request was acknowledged, but the returned record could not be matched to the reviewed income. Do not submit it again." }));
      if (verified) {
        let refreshed = false;
        try { refreshed = await latest.current.onRecorded(); } catch { /* The acknowledged write stays acknowledged. */ }
        if (isCurrent() && operation.current === op && !refreshed) setState(previous => ({ ...previous, message: "Income was recorded, but the latest project income could not be loaded. Reload to review it; do not submit the same income again." }));
      }
    } catch (reason) {
      if (!isCurrent() || operation.current !== op) return;
      op.uncertain = !op.acknowledged;
      op.phase = op.acknowledged ? "acknowledged" : "unknown";
      setState(previous => ({ ...previous, phase: op.phase, message: op.acknowledged ? "Income was acknowledged, but the page could not verify the result. Do not submit it again." : `${reason instanceof Error ? reason.message : "The request did not return a result."} The outcome may be uncertain. The original request is retained; do not create a new income for this attempt.` }));
    } finally {
      if (isCurrent() && operation.current === op) pendingRef.current = false;
    }
  }, [isCurrent, pendingRef]);

  const startAnother = useCallback(() => {
    if (!isCurrent() || pendingRef.current || !latest.current.canPost || state.phase !== "acknowledged" || !state.verified || operation.current?.token !== state.token) return;
    operation.current = null;
    setState(empty);
  }, [isCurrent, pendingRef, state.phase, state.verified, state.token]);

  const canEdit = useCallback(() => isCurrent() && !pendingRef.current && !["review", "pending", "unknown", "acknowledged"].includes(operation.current?.phase || "idle"), [isCurrent, pendingRef]);

  return { ...state, review, cancel, submit, startAnother, canEdit,
    busy: state.phase === "pending", locked: ["review", "pending", "unknown", "acknowledged"].includes(state.phase),
    unresolved: state.phase === "unknown" || state.phase === "acknowledged" && !state.verified };
}
