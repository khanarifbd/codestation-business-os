"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useAdministrationReadOwner } from "./use-administration-read-owner";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { hasAccountingRejectionDetail } from "@/lib/accounting-rejection";
import { getApiErrorMessage } from "@/lib/api-error";
export type CompanyPanelLeaveRegistration = (guard: () => boolean) => () => void;
export class CompanyPanelReadError extends Error { constructor(message: string, readonly status: number) { super(message); } }
type Phase = "idle" | "unknown" | "acknowledged";
export function useCompanyPanelSafety(readAllowed: boolean, writeAllowed: boolean, registerLeaveGuard?: CompanyPanelLeaveRegistration) {
  const owner = useAdministrationReadOwner();
  const current = owner.current;
  const pendingFlag = useRef(false), pending = useRef<object | null>(null), epoch = useRef(0), verified = useRef(false), phaseRef = useRef<Phase>("idle"), dirtyRef = useRef(false), readingRef = useRef(false);
  const [isVerified, setVerified] = useState(false), [readDenied, setReadDenied] = useState(false);
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(true), [phase, setPhase] = useState<Phase>("idle"), [dirty, setDirty] = useState(false), [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => () => { epoch.current++; pending.current = null; pendingFlag.current = false; verified.current = false; readingRef.current = false; }, [current]);
  const canEdit = () => current() && writeAllowed && verified.current && !pending.current && !readingRef.current && phaseRef.current === "idle";
  const confirmLeave = useCallback(() => {
    if (!current() || pending.current) return false;
    if (phaseRef.current !== "idle") return window.confirm("This company operation may already have completed. Leaving loses the retained outcome; review current records before any replacement. Leave?");
    return !dirtyRef.current || window.confirm("Discard unsaved company panel changes and leave?");
  }, [current]);
  useLayoutEffect(() => registerLeaveGuard?.(confirmLeave), [registerLeaveGuard, confirmLeave]);
  useDocumentNavigationGuard(dirty || phase !== "idle", { isBusy: busy, pendingRef: pendingFlag, discardMessage: "This company panel has unsaved or unconfirmed changes. Leaving loses the retained outcome; review current records before any replacement." });
  const markDirty = () => { if (canEdit()) { dirtyRef.current = true; setDirty(true); } };
  const read = useCallback(async <T,>(work: () => Promise<T>, accept: (value: T) => void) => {
    if (!current() || !readAllowed || pending.current) return false;
    const request = ++epoch.current, active = () => current() && request === epoch.current;
    readingRef.current = true; verified.current = false; setVerified(false); setReading(true);
    if (phaseRef.current === "idle") setError(null);
    try { const value = await work(); if (!active()) return false; accept(value); setReadDenied(false); verified.current = true; setVerified(true); return true; }
    catch (reason) { if (active()) { if (reason instanceof CompanyPanelReadError && [401,403].includes(reason.status)) setReadDenied(true); setError(reason instanceof Error ? reason.message : "Current settings could not be verified. Retry reading."); } return false; }
    finally { if (active()) { readingRef.current = false; setReading(false); } }
  }, [current, readAllowed]);
  async function run<T>(work: () => Promise<Response>, validate: (value: unknown) => value is T, accept: (value: T) => void | Promise<void>, retainAcknowledgement = false) {
    if (!canEdit()) return false;
    const token = {}, active = () => current() && pending.current === token;
    pending.current = token; pendingFlag.current = true; epoch.current++; setBusy(true); setError(null);
    let acknowledged = false, rejected = false;
    try {
      const response = await work(); if (!active()) return false;
      if (response.ok) { acknowledged = true; phaseRef.current = "acknowledged"; setPhase("acknowledged"); }
      const body: unknown = await response.json().catch(() => null); if (!active()) return false;
      if (!response.ok) { rejected = [400,401,403,404,422].includes(response.status) && hasAccountingRejectionDetail(body); throw Error(getApiErrorMessage(body, "The company operation could not be confirmed.")); }
      if (!validate(body)) throw Error("The server acknowledged the operation, but its result could not be verified. Do not repeat it.");
      await accept(body); if (!active()) return false;
      phaseRef.current = retainAcknowledgement ? "acknowledged" : "idle"; setPhase(phaseRef.current); dirtyRef.current = false; setDirty(false); return true;
    } catch (reason) {
      if (active()) { const next = acknowledged ? "acknowledged" : rejected ? "idle" : "unknown"; phaseRef.current = next; setPhase(next); setError(reason instanceof Error ? reason.message : "The company operation could not be confirmed."); }
      return false;
    } finally { if (active()) { pending.current = null; pendingFlag.current = false; setBusy(false); } }
  }
  const isUnresolved = useCallback(() => phaseRef.current !== "idle", []);
  return { ...owner, readDenied, isUnresolved, current, canEdit, markDirty, confirmLeave, read, run, busy, reading, phase, error, unresolved: phase !== "idle", locked: !writeAllowed || !isVerified || busy || reading || phase !== "idle" };
}
