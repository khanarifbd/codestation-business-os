"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { useIdentityLifetime } from "@/hooks/use-identity-lifetime";
import { COMPANY_DEFAULTS, companyInputError, companyPayload, identityError, isCompanyMemberships, isCreatedCompany, knownIdentityRejection, type CompanyFields, type CompanyMembership, type IdentityPhase } from "@/components/identity/identity-model";
const UNKNOWN = "The creation outcome is unknown. A workspace may already have been created. Do not repeat the request until you have reviewed your current workspaces.";
const ACKNOWLEDGED = "The server acknowledged workspace creation, but the returned details could not be verified. Open your workspace or review current memberships; do not repeat this creation.";
export function useCompanyOnboarding(createAnother: boolean) {
  const router = useRouter();
  const { identity, current, nextRead, isReadCurrent } = useIdentityLifetime(createAnother ? "onboarding:new" : "onboarding:initial");
  const [draft, setDraft] = useState({ owner: identity, values: { ...COMPANY_DEFAULTS } });
  const [read, setRead] = useState<{ owner: object; rows: CompanyMembership[] | null; loading: boolean; error: string | null }>({ owner: identity, rows: null, loading: true, error: null });
  const [action, setAction] = useState<{ owner: object; phase: IdentityPhase; error: string | null; result: CompanyMembership | null }>({ owner: identity, phase: "idle", error: null, result: null });
  type RecoveryReview = { owner: object; rows: CompanyMembership[] };
  const [reviewed, setReviewed] = useState(false);
  const [reviewReceipt, setReviewReceipt] = useState<RecoveryReview | null>(null);
  const [flight, setFlight] = useState({ owner: identity, value: false });
  const busy = flight.owner === identity && flight.value;
  const pendingRef = useRef(false), latch = useRef<{ owner: object; phase: IdentityPhase }>({ owner: identity, phase: "idle" });
  const readyRef = useRef<CompanyMembership[] | null>(null), recoveryRef = useRef<RecoveryReview | null>(null);
  const reviewRef = useRef<RecoveryReview | null>(null);
  useLayoutEffect(() => { pendingRef.current = false; latch.current = { owner: identity, phase: "idle" }; readyRef.current = null; recoveryRef.current = null; reviewRef.current = null; }, [identity]);
  const values = draft.owner === identity ? draft.values : COMPANY_DEFAULTS;
  const rows = read.owner === identity ? read.rows : null, loading = read.owner !== identity || read.loading;
  const phase = action.owner === identity ? action.phase : "idle", error = action.owner === identity ? action.error : null;
  const dirty = JSON.stringify(values) !== JSON.stringify(COMPANY_DEFAULTS);
  const unresolved = phase === "unknown" || phase === "acknowledged";
  const navigation = useDocumentNavigationGuard(dirty || unresolved, { pendingRef, isBusy: busy, discardMessage: unresolved ? "A workspace may already exist from this creation attempt. Leave this page? Review your workspaces before creating another." : "Discard your company setup details and leave this page?" });
  const load = useCallback(async () => {
    if (!current() || pendingRef.current) return false;
    readyRef.current = null; recoveryRef.current = null; reviewRef.current = null; setReviewed(false); setReviewReceipt(null);
    const request = nextRead();
    const valid = () => isReadCurrent(request);
    setRead({ owner: identity, rows: null, loading: true, error: null });
    try {
      const response = await fetch("/api/organizations", { cache: "no-store" });
      if (!valid()) return false;
      if (response.status === 401) { router.replace("/login"); return false; }
      const body: unknown = await response.json().catch(() => null);
      if (!valid()) return false;
      if (!response.ok) throw new Error(identityError(body, "Unable to verify your workspaces. Retry discovery before creating a company."));
      if (!isCompanyMemberships(body)) throw new Error("The workspace response could not be verified. Company creation remains unavailable until discovery succeeds.");
      readyRef.current = body;
      const phaseNow = latch.current.owner === identity ? latch.current.phase : "idle";
      if (phaseNow === "unknown" || phaseNow === "acknowledged") {
        const receipt = { owner: identity, rows: body }; recoveryRef.current = receipt; setReviewReceipt(receipt);
      }
      else if (body.length > 0 && !createAnother) { router.replace("/dashboard"); return true; }
      setRead({ owner: identity, rows: body, loading: false, error: null }); return true;
    } catch (e) {
      if (valid()) setRead({ owner: identity, rows: null, loading: false, error: e instanceof Error ? e.message : "Unable to verify your workspaces." });
      return false;
    } finally {
      if (valid()) setRead(previous => previous.owner === identity ? { ...previous, loading: false } : previous);
    }
  }, [createAnother, current, identity, router, nextRead, isReadCurrent]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  function change<K extends keyof CompanyFields>(field: K, value: CompanyFields[K]) {
    if (!current() || pendingRef.current || (latch.current.owner === identity && latch.current.phase !== "idle")) return;
    setDraft(previous => ({ owner: identity, values: { ...(previous.owner === identity ? previous.values : COMPANY_DEFAULTS), [field]: value } }));
  }
  const canCreate = Boolean(rows && !loading && (createAnother || rows.length === 0) && phase === "idle");
  async function create() {
    if (!current() || pendingRef.current || !canCreate || readyRef.current !== rows || (latch.current.owner === identity && latch.current.phase !== "idle")) return false;
    const invalid = companyInputError(values);
    if (invalid) { setAction({ owner: identity, phase: "idle", result: null, error: invalid }); return false; }
    const submitted = { ...values };
    pendingRef.current = true; setFlight({ owner: identity, value: true }); latch.current = { owner: identity, phase: "pending" }; nextRead(); recoveryRef.current = null; reviewRef.current = null;
    setAction({ owner: identity, phase: "pending", error: null, result: null });
    const settle = (next: IdentityPhase, message: string | null, result: CompanyMembership | null = null) => { latch.current = { owner: identity, phase: next }; setAction({ owner: identity, phase: next, error: message, result }); };
    try {
      const response = await fetch("/api/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(companyPayload(submitted)) });
      if (!current()) return false;
      if (response.ok) settle("acknowledged", ACKNOWLEDGED);
      else if (!knownIdentityRejection(response.status)) settle("unknown", UNKNOWN);
      if (response.status === 401) { readyRef.current = null; settle("idle", "Sign in again before creating a workspace."); setRead({ owner: identity, rows: null, loading: false, error: "Sign in again to verify workspace access." }); router.replace("/login"); return false; }
      const body: unknown = await response.json().catch(() => null);
      if (!current()) return false;
      if (response.ok) {
        if (isCreatedCompany(body, submitted)) {
          settle("confirmed", null, body); pendingRef.current = false; navigation.markClean();
          navigation.navigate("/dashboard", { replace: true, discard: true });
        }
        return true;
      }
      if (knownIdentityRejection(response.status)) settle("idle", identityError(body, "The company was not created. Review the settings and try again."));
      return false;
    } catch { if (current() && latch.current.phase !== "acknowledged" && latch.current.phase !== "confirmed") settle("unknown", UNKNOWN); return false; }
    finally { if (current()) { pendingRef.current = false; setFlight({ owner: identity, value: false }); } }
  }
  function acknowledgeReview(value: boolean) {
    if (!current() || pendingRef.current || phase !== "unknown" || !reviewReceipt || recoveryRef.current !== reviewReceipt || reviewReceipt.owner !== identity || reviewReceipt.rows !== rows) return;
    reviewRef.current = value ? reviewReceipt : null; setReviewed(value);
  }
  function beginNewIntent() {
    if (!current() || pendingRef.current || phase !== "unknown" || latch.current.phase !== "unknown" || !reviewRef.current || !reviewReceipt || recoveryRef.current !== reviewReceipt || reviewReceipt.owner !== identity || reviewReceipt.rows !== rows || loading) return false;
    if (!window.confirm("This is a NEW workspace creation attempt, not a retry receipt. The earlier request may already have created a workspace. Continue only if you have reviewed your memberships and intentionally want another creation attempt.")) return false;
    if (!current() || recoveryRef.current !== reviewReceipt || reviewRef.current !== reviewReceipt || pendingRef.current) return false;
    // A deliberate new intent uses the existing new=1 document boundary and fresh
    // defaults. Keep the unresolved latch if navigation itself is unsuccessful.
    const left = navigation.navigate("/onboarding?new=1", { replace: true, discard: true });
    if (left) { recoveryRef.current = null; reviewRef.current = null; setReviewReceipt(null); setReviewed(false); }
    return left;
  }
  return { values, rows, loading, readError: read.owner === identity ? read.error : null, phase, error, result: action.owner === identity ? action.result : null, dirty, unresolved, pending: busy, canCreate, reviewed, recoveryReady: Boolean(reviewReceipt && reviewReceipt.owner === identity && reviewReceipt.rows === rows && !loading), change, create, load, acknowledgeReview, beginNewIntent, openWorkspace: () => { return current() ? navigation.navigate("/dashboard", { discard: phase === "confirmed" }) : false; } };
}
