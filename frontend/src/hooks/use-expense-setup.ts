"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { getApiErrorMessage } from "@/lib/api-error";
import type { Meta } from "@/components/expenses/expense-types";

export type ExpenseSetupKind = "vendors" | "categories";
export type ExpenseSetupValues = { name: string; contact_name: string; email: string; phone: string; country_code: string; currency: string; notes: string; cost_type: string; sort_order: string };
const initialValues = (): ExpenseSetupValues => ({ name: "", contact_name: "", email: "", phone: "", country_code: "", currency: "", notes: "", cost_type: "operating", sort_order: "0" });
export const setupEndpoint = (kind: ExpenseSetupKind) => `/api/finance/${kind === "vendors" ? "vendors" : "expense-categories"}`;
export function setupValidation(values: ExpenseSetupValues, kind: ExpenseSetupKind) {
  if (!values.name.trim() || values.name.length > (kind === "vendors" ? 220 : 140)) return `Enter a name of 1–${kind === "vendors" ? 220 : 140} characters.`;
  if (kind === "categories") {
    if (!["direct", "operating", "financial", "tax", "other"].includes(values.cost_type)) return "Choose a supported cost type.";
    if (!/^\d+$/.test(values.sort_order) || Number(values.sort_order) > 100000) return "Sort order must be a whole number from 0 to 100,000.";
  } else if (values.contact_name.length > 180 || values.phone.length > 80 || values.country_code && !/^[A-Z]{2}$/.test(values.country_code) || values.currency && !/^[A-Z]{3}$/.test(values.currency)) return "Check contact length, country and default currency.";
  return null;
}
export function setupPayload(values: ExpenseSetupValues, kind: ExpenseSetupKind) {
  if (setupValidation(values, kind)) throw new Error("Validate expense setup before saving.");
  return kind === "categories" ? { name: values.name.trim(), cost_type: values.cost_type, sort_order: Number(values.sort_order) }
    : { name: values.name.trim(), contact_name: values.contact_name.trim() || null, email: values.email.trim() || null, phone: values.phone.trim() || null, country_code: values.country_code || null, currency: values.currency || null, notes: values.notes.trim() || null };
}
export function useExpenseSetupCreate(kind: ExpenseSetupKind, returnHref: string) {
  const { tenant } = useDashboardSession(), router = useRouter();
  const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view"));
  const canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
  const [values, setValues] = useState(initialValues), [phase, setPhase] = useState<"idle" | "uncertain" | "confirmed">("idle"), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const mounted = useRef(true), inFlight = useRef(false), committed = useRef(false), uncertain = useRef(false), valuesRef = useRef(values);
  const dirty = phase !== "confirmed" && (phase === "uncertain" || JSON.stringify(values) !== JSON.stringify(initialValues()));
  const navigation = useDocumentNavigationGuard(dirty, { documentLabel: "expense", isBusy: saving, pendingRef: inFlight,
    discardMessage: phase === "uncertain" ? "This setup record may already exist. Creation has no replay key. Verify the current company’s directory before creating a duplicate. Leaving loses this draft. Leave anyway?" : undefined });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function change<K extends keyof ExpenseSetupValues>(key: K, value: ExpenseSetupValues[K]) {
    if (!mounted.current || !canManage || inFlight.current || committed.current || uncertain.current) return;
    const next = { ...valuesRef.current, [key]: value }; valuesRef.current = next; setValues(next); setError(null);
  }
  async function save() {
    if (!mounted.current || !canView || !canManage || inFlight.current || committed.current || uncertain.current) return;
    const invalid = setupValidation(valuesRef.current, kind); if (invalid) { setError(invalid); return; }
    inFlight.current = true; setSaving(true); setError(null);
    let classified = false;
    try {
      const response = await fetch(setupEndpoint(kind), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setupPayload(valuesRef.current, kind)) });
      if (response.ok) committed.current = true;
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) {
        classified = response.status < 500;
        throw new Error(getApiErrorMessage(body, "Expense setup could not be saved."));
      }
      // Keep the acknowledgement visible. The explicit Return action runs
      // after the pending latch clears; never navigate during the write.
      setPhase("confirmed"); navigation.markClean();
    } catch (reason) {
      if (!mounted.current) return;
      if (committed.current) { setPhase("confirmed"); navigation.markClean(); }
      else if (!classified) { uncertain.current = true; setPhase("uncertain"); }
      setError(reason instanceof Error ? reason.message : "The setup outcome is uncertain.");
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  return { canView, canManage, values, change, save, saving, error, phase, dirty, locked: saving || phase !== "idle", validation: setupValidation(values, kind), back: () => navigation.navigate(returnHref, { replace: phase === "confirmed" }) };
}

export function useExpenseSetupStatus(kind: ExpenseSetupKind, id: string, active: boolean, canManage: boolean, refresh: () => Promise<Meta | null>) {
  const router = useRouter(), [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [phase, setPhase] = useState<"idle" | "uncertain" | "confirmed">("idle"), [error, setError] = useState<string | null>(null);
  const [confirmationVersion, setConfirmationVersion] = useState(0);
  const sequence = useRef(0), confirmation = useRef(0);
  const mounted = useRef(true), inFlight = useRef(false), locked = useRef(false), armed = useRef(false);
  useDocumentNavigationGuard(phase === "uncertain", { enabled: saving || phase === "uncertain", documentLabel: "expense", isBusy: saving, pendingRef: inFlight, discardMessage: "This setup change has an uncertain result. Recheck the current company’s directory before repeating it. Leave anyway?" });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function recheck() { await refresh(); }
  async function confirm() {
    if (!mounted.current || !canManage || !armed.current || !confirmationVersion || confirmation.current !== confirmationVersion || inFlight.current || locked.current) return;
    armed.current = false; confirmation.current = 0; inFlight.current = true; setSaving(true); setError(null);
    let acknowledged = false, classified = false;
    try {
      const response = await fetch(`${setupEndpoint(kind)}/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !active }) });
      if (response.ok) { acknowledged = true; locked.current = true; }
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) { classified = response.status < 500; throw new Error(getApiErrorMessage(body, "The status change could not be confirmed.")); }
      setPhase("confirmed"); setOpen(false); await refresh();
    } catch (reason) {
      if (!mounted.current) return;
      if (acknowledged) { locked.current = true; setPhase("confirmed"); }
      else if (!classified) { locked.current = true; setPhase("uncertain"); }
      setError(reason instanceof Error ? reason.message : "Status outcome is uncertain."); setOpen(false);
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  return { open, saving, phase, error, confirm, recheck, review: () => { if (mounted.current && canManage && !inFlight.current && !locked.current) { armed.current = true; confirmation.current = ++sequence.current; setConfirmationVersion(confirmation.current); setOpen(true); } }, cancel: () => { if (!inFlight.current && confirmation.current === confirmationVersion) { armed.current = false; confirmation.current = 0; setOpen(false); } } };
}
