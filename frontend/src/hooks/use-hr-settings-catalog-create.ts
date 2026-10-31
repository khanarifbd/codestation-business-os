"use client";

import { verifiedHRRejectionBody } from "@/lib/hr-rejection-body";

import { useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useHRSettingsIdentity } from "./use-hr-settings-identity";
import { timeError } from "@/components/hr-time/hr-time-model";
import { catalogIntent, catalogReceipt, catalogEndpoints, catalogViews, type CatalogKind, type CatalogIntent, type CatalogReceipt } from "@/components/hr-settings/catalog-create-model";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { useHRTimeLifetime } from "./use-hr-time-resource";
import { HR_SETTINGS, safeSettingsReturn, settingsHref } from "@/lib/hr-settings-navigation";

type Phase = "idle" | "review" | "pending" | "rejected" | "acknowledged" | "confirmed" | "unknown";
const UNKNOWN = "The save outcome is unknown. This setup item may already have been created. Do not submit it again.";
const ACK = "The server acknowledged the save, but a matching setup receipt was not returned. Do not submit it again.";
const knownRejection = (status: number, body: unknown) => [401, 403, 404, 422].includes(status) && verifiedHRRejectionBody(body, status === 422);

/** One reviewed intent per page. An uncertain result is never made retryable by a later read. */
export function useHRSettingsCatalogCreate(kind: CatalogKind) {
  const identity = useHRSettingsIdentity(), router = useRouter(), pathname = usePathname(), query = useSearchParams();
  const scope = JSON.stringify([identity.scope, pathname, kind]);
  const { owner, current } = useHRTimeLifetime(scope);
  const canManage = identity.canManage && pathname === `${HR_SETTINGS}/catalog/${kind}/new`;
  const pending = useRef(false), lock = useRef<Phase>("idle"), reviewed = useRef<CatalogIntent | null>(null), operation = useRef<object | null>(null);
  const [flight, setFlight] = useState({ owner, value: false });
  const [state, setState] = useState<{ owner: object; phase: Phase; message: string | null; intent: CatalogIntent | null; receipt: CatalogReceipt | null; dirty: boolean }>({ owner, phase: "idle", message: null, intent: null, receipt: null, dirty: false });
  useLayoutEffect(() => {
    pending.current = false; lock.current = "idle"; reviewed.current = null; operation.current = null;
    return () => { operation.current = null; pending.current = false; };
  }, [owner]);
  const value = state.owner === owner ? state : { phase: "idle" as Phase, message: null, intent: null, receipt: null, dirty: false };
  const busy = flight.owner === owner && flight.value, unresolved = value.phase === "unknown" || value.phase === "acknowledged";
  const navigation = useDocumentNavigationGuard(value.dirty || unresolved, { pendingRef: pending, isBusy: busy, documentLabel: "HR request", discardMessage: unresolved ? "This setup item may already have been saved. Leaving or reloading can lose this memory-only result. Do not repeat this create based on a later list. Leave this page?" : "Discard these setup details and leave this page?" });
  // Render readiness must not depend on a ref initialized only after the first render.
  // Event handlers retain the stricter lifetime and synchronous attempt guards below.
  const editable = canManage && !busy && ["idle", "rejected"].includes(value.phase);
  const canEdit = () => current() && canManage && !pending.current && ["idle", "rejected"].includes(lock.current);
  function changed() { if (canEdit()) setState(old => ({ ...old, owner, dirty: true })); }
  function review(form: HTMLFormElement) {
    if (!canEdit()) return false;
    const intent = catalogIntent(kind, new FormData(form));
    if (!intent) {
      setState({ owner, phase: lock.current, message: "Check required names, dates and times. Allowance supports up to two decimal places (0–999999.99); break and grace minutes must be whole nonnegative integers. Remove invalid text characters.", intent: null, receipt: null, dirty: true });
      return false;
    }
    reviewed.current = intent; lock.current = "review";
    setState({ owner, phase: "review", message: null, intent, receipt: null, dirty: true });
    return true;
  }
  function edit() {
    if (!current() || !canManage || pending.current || lock.current !== "review" || reviewed.current !== value.intent) return false;
    reviewed.current = null; lock.current = "idle";
    setState(old => ({ ...old, owner, phase: "idle", message: null, dirty: true }));
    return true;
  }
  async function submit() {
    const intent = value.intent;
    if (!current() || !canManage || pending.current || lock.current !== "review" || !intent || reviewed.current !== intent) return null;
    const token = {}; operation.current = token; pending.current = true; lock.current = "pending";
    setFlight({ owner, value: true });
    setState({ owner, phase: "pending", message: "Saving once. Keep this page open while the response settles.", intent, receipt: null, dirty: true });
    const belongs = () => current() && operation.current === token;
    const settle = (phase: Phase, message: string, receipt: CatalogReceipt | null = null) => {
      if (!belongs()) return;
      lock.current = phase;
      setState({ owner, phase, message, intent, receipt, dirty: phase !== "confirmed" });
    };
    try {
      const payload = intent.payload;
      const response = await fetch(catalogEndpoints[kind], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!belongs()) return null;
      settle(response.ok ? "acknowledged" : "unknown", response.ok ? ACK : UNKNOWN);
      if (response.status === 401) router.replace("/login");
      const body: unknown = await response.json().catch(() => null);
      if (!belongs()) return null;
      if (response.ok) {
        const receipt = response.status === 201 ? catalogReceipt(intent, body) : null;
        if (!receipt) return null;
        settle("confirmed", "Setup item saved. The server returned a matching receipt.", receipt);
        navigation.markClean();
        return receipt;
      }
      if (knownRejection(response.status, body)) {
        reviewed.current = null;
        settle("rejected", timeError(body, "The save was rejected. Review the details before trying deliberately."));
      }
      return null;
    } catch {
      if (belongs() && !["acknowledged", "confirmed"].includes(lock.current)) settle("unknown", UNKNOWN);
      return null;
    } finally { if (belongs()) { pending.current = false; setFlight({ owner, value: false }); } }
  }
  return { scope, accessLoading: identity.accessLoading, canManage, accessError: identity.accessError, ...value, busy, unresolved, editable, canEdit, changed, review, edit, submit, returnHref: query.has("returnTo") ? safeSettingsReturn(query.get("returnTo")) : settingsHref({view:catalogViews[kind]}) };
}
