"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { useIdentityLifetime } from "@/hooks/use-identity-lifetime";
import { identityError, invitationInputError, isEmployeeInvitation, isInvitationAcknowledgment, knownIdentityRejection, type EmployeeInvitation, type IdentityPhase, type InvitationAcknowledgment } from "@/components/identity/identity-model";
const UNKNOWN = "Acceptance could not be confirmed. Do not submit again. Sign in to inspect access or contact the inviting company; an unavailable link is not proof that this request succeeded.";
const ACKNOWLEDGED = "The server acknowledged acceptance, but the confirmation details could not be verified. Do not accept again. Sign in to inspect access or contact the inviting company.";
export function useEmployeeInvitation(token: string) {
  const { identity, current, nextRead, isReadCurrent } = useIdentityLifetime(token);
  const [read, setRead] = useState<{ owner: object; preview: EmployeeInvitation | null; loading: boolean; error: string | null }>({ owner: identity, preview: null, loading: true, error: null });
  const [action, setAction] = useState<{ owner: object; phase: IdentityPhase; error: string | null; result: InvitationAcknowledgment | null }>({ owner: identity, phase: "idle", error: null, result: null });
  const [fields, setFields] = useState({ owner: identity, password: "", confirmation: "" });
  const [flight, setFlight] = useState({ owner: identity, value: false });
  const busy = flight.owner === identity && flight.value;
  const readyRef = useRef<EmployeeInvitation | null>(null);
  const pendingRef = useRef(false), latch = useRef<{ owner: object; phase: IdentityPhase }>({ owner: identity, phase: "idle" });
  useLayoutEffect(() => { pendingRef.current = false; readyRef.current = null; latch.current = { owner: identity, phase: "idle" }; }, [identity]);
  const preview = read.owner === identity ? read.preview : null, loading = read.owner !== identity || read.loading;
  const phase = action.owner === identity ? action.phase : "idle", error = action.owner === identity ? action.error : null;
  const password = fields.owner === identity ? fields.password : "", confirmation = fields.owner === identity ? fields.confirmation : "";
  const uncertain = phase === "unknown" || phase === "acknowledged";
  const navigation = useDocumentNavigationGuard(Boolean(password || confirmation) || uncertain, { pendingRef, isBusy: busy, discardMessage: uncertain ? "Acceptance may already have completed. Leave this page? Check access before attempting acceptance elsewhere." : "Discard the password details entered for this invitation and leave?" });
  const refresh = useCallback(async () => {
    if (!current() || pendingRef.current) return false;
    readyRef.current = null;
    const request = nextRead();
    const valid = () => isReadCurrent(request);
    setRead({ owner: identity, preview: null, loading: true, error: null });
    try {
      if (token.length < 20) throw new Error("This invitation link is incomplete. Ask the inviting company for a current link.");
      const response = await fetch(`/api/employee-invitations/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!valid()) return false;
      const body: unknown = await response.json().catch(() => null);
      if (!valid()) return false;
      if (!response.ok) throw new Error(identityError(body, "This invitation is unavailable. It may be expired, revoked, invalid or already used."));
      if (!isEmployeeInvitation(body)) throw new Error("Invitation details could not be verified. Retry the read or contact the inviting company.");
      readyRef.current = body;
      setRead({ owner: identity, preview: body, loading: false, error: null }); return true;
    } catch (e) {
      if (valid()) setRead({ owner: identity, preview: null, loading: false, error: e instanceof Error ? e.message : "Unable to read this invitation." });
      return false;
    }
  }, [current, identity, token, nextRead, isReadCurrent]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void refresh(); }); return () => { active = false; }; }, [refresh]);
  function change(field: "password" | "confirmation", value: string) {
    if (!current() || pendingRef.current || (latch.current.owner === identity && latch.current.phase !== "idle")) return;
    setFields(previous => ({ owner: identity, password: previous.owner === identity ? previous.password : "", confirmation: previous.owner === identity ? previous.confirmation : "", [field]: value }));
  }
  async function accept() {
    if (!current() || pendingRef.current || !preview || readyRef.current !== preview || loading || (latch.current.owner === identity && latch.current.phase !== "idle")) return false;
    const invalid = invitationInputError(password, confirmation);
    if (invalid) { setAction({ owner: identity, phase: "idle", result: null, error: invalid }); return false; }
    pendingRef.current = true; setFlight({ owner: identity, value: true }); latch.current = { owner: identity, phase: "pending" }; nextRead();
    setAction({ owner: identity, phase: "pending", error: null, result: null });
    const settle = (next: IdentityPhase, message: string | null, result: InvitationAcknowledgment | null = null) => { latch.current = { owner: identity, phase: next }; setAction({ owner: identity, phase: next, error: message, result }); };
    try {
      const response = await fetch("/api/employee-invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      if (!current()) return false;
      if (response.ok) { settle("acknowledged", ACKNOWLEDGED); setFields({ owner: identity, password: "", confirmation: "" }); }
      else if (!knownIdentityRejection(response.status)) settle("unknown", UNKNOWN);
      const body: unknown = await response.json().catch(() => null);
      if (!current()) return false;
      if (response.ok) {
        if (isInvitationAcknowledgment(body, preview)) { settle("confirmed", null, body); navigation.markClean(); }
        return true;
      }
      // Employee invitation401 is a domain rejection, not an unrelated-session logout.
      if (knownIdentityRejection(response.status)) settle("idle", identityError(body, "The invitation was not accepted. Review the details and try again."));
      return false;
    } catch { if (current() && latch.current.phase !== "acknowledged") settle("unknown", UNKNOWN); return false; }
    finally { if (current()) { pendingRef.current = false; setFlight({ owner: identity, value: false }); } }
  }
  return { preview, loading, readError: read.owner === identity ? read.error : null, phase, error, result: action.owner === identity ? action.result : null, password, confirmation, pending: busy, uncertain, change, accept, refresh, signIn: () => { return current() ? navigation.navigate("/login") : false; } };
}
