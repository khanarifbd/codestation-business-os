"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePortalScope, type PortalRead } from "./use-client-portal-resource";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { getApiErrorMessage } from "@/lib/api-error";
import { isPortalDocument, portalMoney } from "@/components/client-portal/portal-model";
import type { ClientPortalQuotationDetail } from "@/lib/client-portal-types";

type Decision = "accepted" | "rejected";
type Operation = { scope: string; id: string; clientId: string; target: Decision; number: string; client: string; amount: string; previous: string; version: number };
type Phase = "idle" | "pending" | "acknowledged" | "unknown" | "verified";
export function useClientQuotationDecision(record: PortalRead<ClientPortalQuotationDetail>, selected: Decision | null, backHref: string) {
  const scope = usePortalScope(), router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle"), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState<Operation | null>(null), [operation, setOperation] = useState<Operation | null>(null), [result, setResult] = useState<ClientPortalQuotationDetail | null>(null);
  const live = useRef({ scope: scope.key, record: record.value, selected, version: record.version }), alive = useRef(true), pendingRef = useRef(false), lockedRef = useRef(false), armed = useRef<Operation | null>(null);
  useLayoutEffect(() => { live.current = { scope: scope.key, record: record.value, selected, version: record.version }; }, [scope.key, record.value, selected, record.version]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const navigation = useDocumentNavigationGuard(Boolean(review) || phase === "unknown", {
    isBusy: phase === "pending", pendingRef,
    discardMessage: phase === "unknown" ? "This decision may already be recorded. Leaving loses the in-memory request context; do not submit the decision again without verifying saved status. Leave?" : "Leave this unsubmitted quotation confirmation?",
  });
  function arm() {
    const current = live.current;
    if (lockedRef.current || pendingRef.current || !alive.current || !selected || current.scope !== scope.key || current.selected !== selected || !current.record || current.record.status !== "sent" || record.loading || record.error || !record.isCurrent()) return false;
    const row = current.record;
    const frozen: Operation = { scope: scope.key, id: row.id, clientId: row.client_id, target: selected, number: row.quotation_number, client: row.client_name, amount: portalMoney(row.total, row.currency), previous: row.status, version: record.version };
    armed.current = frozen; setReview(frozen); setError(null); setNotice(null); return true;
  }
  function close() { if (review && armed.current === review && !pendingRef.current) { armed.current = null; setReview(null); } }
  async function confirm() {
    const frozen = review, current = live.current;
    if (!frozen || armed.current !== frozen || lockedRef.current || pendingRef.current || !alive.current || frozen.scope !== current.scope || current.selected !== frozen.target || current.record?.id !== frozen.id || current.record.client_id !== frozen.clientId || current.record.status !== "sent" || current.version !== frozen.version || !record.isCurrent()) return;
    pendingRef.current = true; lockedRef.current = true; setPhase("pending"); setOperation(frozen); setError(null);
    const stillCurrent = () => alive.current && live.current.scope === frozen.scope && live.current.record?.id === frozen.id;
    try {
      const response = await fetch(`/api/client-portal/quotations/${encodeURIComponent(frozen.id)}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: frozen.target }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!stillCurrent()) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          lockedRef.current = false; setPhase("idle"); setOperation(null); setError(getApiErrorMessage(payload, "The server rejected this decision. Read the current quotation before trying again."));
          void record.refresh();
        } else {
          setPhase("unknown"); setError("The response did not establish whether the decision was recorded. Do not submit another decision; verify the saved status.");
        }
      } else if (isPortalDocument("quotations", payload) && payload.id === frozen.id && payload.client_id === frozen.clientId && payload.status === frozen.target) {
        setResult(payload); setPhase("acknowledged"); setNotice(`Quotation ${frozen.number} is ${frozen.target}. Acceptance does not itself create an order.`);
      } else {
        setPhase("unknown"); setError("The server acknowledged the request, but the returned quotation could not be verified. Do not submit again; read the saved status.");
      }
    } catch {
      if (stillCurrent()) { setPhase("unknown"); setError("The connection ended before the outcome could be established. The decision may already be recorded. Do not submit it again."); }
    } finally {
      if (alive.current && live.current.scope === frozen.scope) { pendingRef.current = false; armed.current = null; setReview(null); }
    }
  }
  async function verify() {
    if (pendingRef.current || !operation || operation.scope !== live.current.scope || !alive.current) return;
    const response = await record.refresh();
    if (!alive.current || !response.current || operation.scope !== live.current.scope) return;
    if (!response.value || response.value.id !== operation.id || response.value.client_id !== operation.clientId) { setNotice("Saved status could not be verified. This is not evidence that the earlier decision failed; repeat submission remains locked."); return; }
    if (response.value.status === "accepted" || response.value.status === "rejected") {
      setResult(response.value); setPhase("verified"); setNotice(`Current saved status is ${response.value.status}. This read confirms the document status, not which request recorded it.`);
    } else {
      setNotice(`Current read shows ${response.value.status}. It does not prove the earlier request failed or cannot still complete. Repeat submission remains locked.`);
    }
  }
  return { phase, error, notice, review, operation, result, locked: phase !== "idle", busy: phase === "pending", arm, close, confirm, verify, cancel: () => navigation.navigate(backHref), navigation };
}
