"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "@/lib/api-error";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";

export type ClientInvitationPreview = {
  company_name: string;
  client_name: string;
  email: string;
  full_name: string;
  expires_at: string;
  existing_user: boolean;
  requires_password: boolean;
};
export type ClientInvitationResult = { ok: true; company_name: string; client_name: string };
export type ClientInvitationPhase = "idle" | "pending" | "accepted" | "acknowledged" | "unknown";
type PreviewState = { token: string; value: ClientInvitationPreview | null; loading: boolean; error: string | null; status: number | null };
type ActionState = { token: string; phase: ClientInvitationPhase; error: string | null; result: ClientInvitationResult | null };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export function isClientInvitationPreview(value: unknown): value is ClientInvitationPreview {
  return record(value) && ["company_name", "client_name", "email", "full_name"].every(key => text(value[key]))
    && text(value.expires_at) && Number.isFinite(Date.parse(value.expires_at))
    && typeof value.existing_user === "boolean" && typeof value.requires_password === "boolean";
}
export function isClientInvitationResult(value: unknown, preview: ClientInvitationPreview): value is ClientInvitationResult {
  return record(value) && value.ok === true && value.company_name === preview.company_name && value.client_name === preview.client_name;
}
export function clientInvitationNeedsPassword(preview: ClientInvitationPreview) {
  return !preview.existing_user || preview.requires_password;
}
export function clientInvitationInputError(preview: ClientInvitationPreview, password: string, confirmation: string) {
  if (!clientInvitationNeedsPassword(preview)) return null;
  // Preserve this existing form's eight-character and confirmation requirements.
  if (password.length < 8) return "Use a password with at least 8 characters.";
  return password !== confirmation ? "Passwords do not match." : null;
}
const unknownMessage = "The acceptance outcome could not be confirmed. Do not submit again. Check the invitation status or sign in to inspect access; an unavailable link alone does not prove this request succeeded.";
const acknowledgedMessage = "The server acknowledged acceptance, but its confirmation could not be verified. Do not submit again. Sign in to check access, or contact the inviting company.";

/** Public invitation form. Token/password remain only in this mounted form's memory. */
export function useClientInvitation(token: string) {
  const scope = useRef({ token, alive: true, read: 0, write: 0 });
  const pendingRef = useRef(false);
  const previewReady = useRef(false);
  const latch = useRef<{ token: string; phase: ClientInvitationPhase }>({ token, phase: "idle" });
  const [read, setRead] = useState<PreviewState>({ token: "", value: null, loading: false, error: null, status: null });
  const [action, setAction] = useState<ActionState>({ token, phase: "idle", error: null, result: null });
  const [fields, setFields] = useState({ token, password: "", confirmation: "" });
  const [inFlight, setInFlight] = useState({ token, value: false });
  const validToken = typeof token === "string" && token.length >= 20;
  const phase = action.token === token ? action.phase : "idle";
  const preview = read.token === token ? read.value : null;
  const password = fields.token === token ? fields.password : "";
  const confirmation = fields.token === token ? fields.confirmation : "";
  const locked = phase !== "idle";
  const pending = phase === "pending" || inFlight.token === token && inFlight.value;
  const uncertain = phase === "unknown" || phase === "acknowledged";
  const navigation = useDocumentNavigationGuard(Boolean(password || confirmation) || uncertain, {
    isBusy: pending,
    pendingRef,
    discardMessage: uncertain
      ? "The invitation acceptance outcome is unresolved. Leave this page? Check access before attempting acceptance elsewhere."
      : "You have entered password details for this invitation. Discard them and leave this page?",
  });

  useLayoutEffect(() => {
    const current = scope.current;
    current.token = token;
    current.alive = true;
    current.read += 1;
    current.write += 1;
    pendingRef.current = false;
    previewReady.current = false;
    latch.current = { token, phase: "idle" };
    return () => {
      current.alive = false;
      current.read += 1;
      current.write += 1;
    };
  }, [token]);

  const refresh = useCallback(async () => {
    const current = scope.current;
    if (!current.alive || current.token !== token || pendingRef.current) return false;
    if (!validToken) {
      setRead({ token, value: null, loading: false, status: null, error: "This invitation link is incomplete or invalid. Ask the inviting company for a current link." });
      return false;
    }
    const identity = ++current.read;
    previewReady.current = false;
    setRead({ token, value: null, loading: true, error: null, status: null });
    let status: number | null = null;
    try {
      const response = await fetch(`/api/client-invitations/${encodeURIComponent(token)}`, { cache: "no-store" });
      status = response.status;
      const payload: unknown = await response.json().catch(() => null);
      if (!current.alive || current.token !== token || current.read !== identity) return false;
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "This invitation is unavailable. It may be invalid, expired, cancelled or already used."));
      if (!isClientInvitationPreview(payload)) throw new Error("The invitation details could not be verified. Do not enter a password until a valid preview is loaded.");
      previewReady.current = true;
      setRead({ token, value: payload, loading: false, error: null, status });
      return true;
    } catch (reason) {
      if (!current.alive || current.token !== token || current.read !== identity) return false;
      setRead({ token, value: null, loading: false, error: status === null ? "The invitation could not be loaded. Check your connection and retry this read." : reason instanceof Error ? reason.message : "The invitation could not be loaded.", status });
      return false;
    }
  }, [token, validToken]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; };
  }, [refresh]);

  function change(field: "password" | "confirmation", value: string) {
    if (!scope.current.alive || scope.current.token !== token || latch.current.phase !== "idle") return;
    setFields(previous => ({ ...(previous.token === token ? previous : { token, password: "", confirmation: "" }), [field]: value }));
    setAction({ token, phase: "idle", error: null, result: null });
  }
  async function accept() {
    const current = scope.current;
    if (!current.alive || current.token !== token || !validToken || !preview || !previewReady.current || pendingRef.current || latch.current.token !== token || latch.current.phase !== "idle") return false;
    const error = clientInvitationInputError(preview, password, confirmation);
    if (error) { setAction({ token, phase: "idle", error, result: null }); return false; }
    const identity = ++current.write, snapshot = { ...preview };
    const stillCurrent = () => current.alive && current.token === token && current.write === identity;
    // The latch is synchronous; a second click cannot race React's pending render.
    pendingRef.current = true;
    setInFlight({ token, value: true });
    latch.current = { token, phase: "pending" };
    current.read += 1;
    setAction({ token, phase: "pending", error: null, result: null });
    try {
      const response = await fetch("/api/client-invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: clientInvitationNeedsPassword(snapshot) ? password || null : null }),
      });
      if (!stillCurrent()) return false;
      if (response.ok) {
        // Acknowledgement latches before JSON decoding; failed readback cannot invite repost.
        latch.current = { token, phase: "acknowledged" };
        setAction({ token, phase: "acknowledged", error: acknowledgedMessage, result: null });
        setFields({ token, password: "", confirmation: "" });
      }
      const payload: unknown = await response.json().catch(() => null);
      if (!stillCurrent()) return false;
      if (response.ok) {
        if (isClientInvitationResult(payload, snapshot)) {
          latch.current = { token, phase: "accepted" };
          setAction({ token, phase: "accepted", error: null, result: payload });
          navigation.markClean();
          return true;
        }
        return false;
      }
      if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
        latch.current = { token, phase: "idle" };
        setAction({ token, phase: "idle", error: getApiErrorMessage(payload, "Acceptance was rejected. Review the invitation and password details."), result: null });
        if ([403, 404, 409].includes(response.status)) {
          previewReady.current = false;
          setRead({ token, value: null, loading: false, status: response.status, error: "The invitation or account is not available for acceptance. Recheck the link before trying again." });
        }
        return false;
      }
      latch.current = { token, phase: "unknown" };
      setFields({ token, password: "", confirmation: "" });
      setAction({ token, phase: "unknown", error: unknownMessage, result: null });
      return false;
    } catch {
      if (!stillCurrent()) return false;
      const next = latch.current.phase === "acknowledged" ? "acknowledged" : "unknown";
      latch.current = { token, phase: next };
      setFields({ token, password: "", confirmation: "" });
      setAction({ token, phase: next, error: next === "acknowledged" ? acknowledgedMessage : unknownMessage, result: null });
      return false;
    } finally {
      if (stillCurrent()) {
        pendingRef.current = false;
        setInFlight({ token, value: false });
      }
    }
  }
  function signIn() { return navigation.navigate("/login"); }
  return {
    preview, phase, pending, locked, uncertain, password, confirmation, change, accept, refresh, signIn,
    loading: read.token !== token || read.loading,
    readError: read.token === token ? read.error : null,
    readStatus: read.token === token ? read.status : null,
    error: action.token === token ? action.error : null,
    result: action.token === token ? action.result : null,
    needsPassword: preview ? clientInvitationNeedsPassword(preview) : false,
  };
}
