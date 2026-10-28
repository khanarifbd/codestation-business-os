"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConfirmationDetail } from "@/components/financial-confirmation-dialog";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { getApiErrorMessage } from "@/lib/api-error";
export type AdvancedConfirmation = { title: string; description: string; warning: string; details: ConfirmationDetail[]; confirmLabel: string };
export type AdvancedCommand = { url: string; method?: "POST" | "PATCH"; body?: unknown; confirmation: AdvancedConfirmation; validate: (value: unknown) => boolean; resultHref?: (value: unknown) => string | null };
type FrozenCommand = Omit<AdvancedCommand, "body"> & { bodyText: string | undefined };
type Phase = "idle" | "saving" | "acknowledged" | "unknown";
/** Unkeyed writes are not replayed. Reads cannot unlock an uncertain operation merely by absence. */
export function useAdvancedAction(canManage: boolean, dirty: boolean, returnHref: string) {
  const router = useRouter(), alive = useRef(true), allowed = useRef(canManage), pending = useRef(false), phaseRef = useRef<Phase>("idle"), command = useRef<FrozenCommand | null>(null);
  useLayoutEffect(() => { allowed.current = canManage; }, [canManage]);
  const [phase, setPhase] = useState<Phase>("idle"), [confirmation, setConfirmation] = useState<AdvancedConfirmation | null>(null), [result, setResult] = useState<unknown>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [resultHref, setResultHref] = useState<string | null>(null), [operation, setOperation] = useState<AdvancedConfirmation | null>(null);
  const navigation = useDocumentNavigationGuard(phase === "idle" ? dirty : phase === "unknown", { documentLabel: "accounting entry", isBusy: phase === "saving", pendingRef: pending, discardMessage: phase === "unknown" ? "This accounting operation has an uncertain outcome. Leaving loses this in-memory operation context. Inspect saved records before any new posting. Leave this page?" : undefined });
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; command.current = null; }; }, []);
  function close() { if (pending.current || phaseRef.current !== "idle") return; command.current = null; setConfirmation(null); setOperation(null); }
  function arm(next: AdvancedCommand) {
    if (!canManage || !allowed.current || pending.current || phaseRef.current !== "idle" || !alive.current) return false;
    command.current = { ...next, method: next.method ?? "POST", bodyText: next.body === undefined ? undefined : JSON.stringify(next.body) };
    setConfirmation(next.confirmation); setOperation(next.confirmation); setError(null); setNotice(null); return true;
  }
  async function confirm() {
    const selected = command.current;
    if (!selected || !confirmation || selected.confirmation !== confirmation || !canManage || !allowed.current || pending.current || phaseRef.current !== "idle" || !alive.current) return;
    pending.current = true; phaseRef.current = "saving"; setPhase("saving"); setError(null);
    let acknowledged = false, href: string | null = null;
    try {
      const response = await fetch(selected.url, { method: selected.method ?? "POST", headers: { "Content-Type": "application/json" }, ...(selected.bodyText === undefined ? {} : { body: selected.bodyText }) });
      if (!alive.current) return;
      if (response.ok) { acknowledged = true; phaseRef.current = "acknowledged"; setPhase("acknowledged"); setConfirmation(null); setNotice("The write was acknowledged. Do not submit it again, even if the returned document or subsequent read is unavailable."); navigation.markClean(); }
      const payload: unknown = await response.json().catch(() => null);
      if (!alive.current) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) {
        if ([400,401,403,404,409,422].includes(response.status)) { phaseRef.current = "idle"; setPhase("idle"); command.current = null; setConfirmation(null); setError(getApiErrorMessage(payload, "The accounting operation was rejected. Your inputs are retained.")); }
        else { phaseRef.current = "unknown"; setPhase("unknown"); setConfirmation(null); setError("The response did not establish whether the operation posted. Do not post again; inspect saved records first."); }
        return;
      }
      if (!selected.validate(payload)) { setError("The write was acknowledged, but its document identity could not be verified. Keep this result and inspect saved records; do not submit again."); return; }
      setResult(payload); href = selected.resultHref?.(payload) ?? null; setResultHref(href);
    } catch {
      if (!alive.current) return;
      if (!acknowledged) { phaseRef.current = "unknown"; setPhase("unknown"); setConfirmation(null); }
      setError(acknowledged ? "The write was acknowledged but the result could not be opened. Do not repeat it." : "The request ended without a confirmed outcome. Do not repeat this unkeyed accounting operation. Inspect saved records first.");
    } finally {
      pending.current = false;
      if (alive.current && acknowledged && href && !navigation.navigate(href, { replace: true, discard: true })) setNotice("The write was acknowledged. Automatic navigation did not complete; open its verified result below. Do not post again.");
    }
  }
  return { canEdit: () => canManage && allowed.current && !pending.current && phaseRef.current === "idle", phase, busy: phase === "saving", locked: phase !== "idle", confirmation, operation, result, resultHref, error, notice, arm, close, confirm, navigation, cancel: () => navigation.navigate(returnHref), clearError: () => { if (phaseRef.current === "idle") setError(null); } };
}
