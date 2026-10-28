"use client";
import { useEffect, useRef, useState } from "react";
import { advancedDate, advancedId, advancedMoney, adjustmentMatchesPayload, adjustmentPayload, correctionType, isCandidateList, isCorrectionResult, isJournal, isLedger, isLedgerList, isTrial, ledgerMatchesPayload, ledgerPayload } from "@/components/accounting-advanced/advanced-model";
import { blankAdjustment, blankLedger, correctionTypes } from "@/components/accounting-advanced/advanced-types";
import type { AccountForm, AdjustmentForm, TrialBalance } from "@/components/accounting-advanced/advanced-types";
import { advancedJournalHref, advancedListHref } from "@/lib/advanced-accounting-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
import { useAdvancedAction } from "./use-advanced-action";

const datedTrial = (payload: unknown): payload is TrialBalance => isTrial(payload) && advancedDate(payload.as_of);

export function useAdvancedLedger(returnHref: string) {
  const { canView, canManage } = useAdvancedPermissions(), [form, setForm] = useState<AccountForm>({ ...blankLedger }), values = useRef(form), [error, setError] = useState<string | null>(null);
  const accounts = useAdvancedResource("/api/accounting/chart-of-accounts?include_inactive=true", canView, isLedgerList);
  const action = useAdvancedAction(canView && canManage, JSON.stringify(form) !== JSON.stringify(blankLedger), returnHref);
  function change<K extends keyof AccountForm>(key: K, value: AccountForm[K]) {
    if (!action.canEdit()) return; action.close(); action.clearError(); setError(null);
    const next = { ...values.current, [key]: value, ...(key === "category" ? { parent_id: "" } : {}) }; values.current = next; setForm(next);
  }
  function review() {
    if (!canView || !canManage || accounts.loading) return;
    const validated = ledgerPayload(values.current, accounts.value); setError(validated.error);
    if (!validated.body) return;
    const body = validated.body;
    action.arm({ url: "/api/accounting/chart-of-accounts", body,
      confirmation: { title: `Create ${body.code}?`, description: "Add a ledger account to this company’s chart. This does not create a cash transaction or journal.", warning: "Creation is not keyed for automatic retry. If the response is uncertain, inspect the chart by code before any new creation attempt.", confirmLabel: "Create ledger account", details: [{ label: "Code / name", value: `${body.code} · ${body.name}` },{ label: "Category", value: body.category },{ label: "Normal balance", value: body.normal_balance },{ label: "Manual posting", value: body.allow_manual_posting ? "Allowed" : "Not allowed" },{ label: "Parent", value: accounts.value?.find(row => row.id === body.parent_id)?.name || "No parent" }] },
      validate: payload => ledgerMatchesPayload(payload, body),
      resultHref: payload => isLedger(payload) ? advancedListHref({ tab: "chart", search: payload.code, focus: payload.id }) : null });
  }
  return { canView, canManage, form, change, accounts, resource: accounts, action, review, cancel: action.cancel, error, backHref: returnHref, refresh: () => { action.close(); return accounts.refresh(); } };
}

export function useAdvancedAdjustment(returnHref: string) {
  const { canView, canManage } = useAdvancedPermissions(), [form, setForm] = useState<AdjustmentForm>({ ...blankAdjustment }), values = useRef(form), [baseline, setBaseline] = useState<AdjustmentForm>({ ...blankAdjustment }), initialized = useRef(false), [error, setError] = useState<string | null>(null);
  const accounts = useAdvancedResource("/api/accounting/chart-of-accounts", canView, isLedgerList), context = useAdvancedResource("/api/accounting/trial-balance", canView, datedTrial);
  const action = useAdvancedAction(canView && canManage, JSON.stringify(form) !== JSON.stringify(baseline), returnHref);
  useEffect(() => {
    if (!context.value || initialized.current || !action.canEdit()) return;
    const defaults = { ...blankAdjustment, entry_date: context.value.as_of || "", currency: context.value.accounting_currency };
    const next = { ...values.current, entry_date: values.current.entry_date || defaults.entry_date, currency: values.current.currency || defaults.currency };
    let active = true; queueMicrotask(() => { if (active && !initialized.current) { initialized.current = true; values.current = next; setBaseline(defaults); setForm(next); } });
    return () => { active = false; };
  }, [context.value, action]);
  function change<K extends keyof AdjustmentForm>(key: K, value: AdjustmentForm[K]) {
    if (!action.canEdit()) return; action.close(); action.clearError(); setError(null); const next = { ...values.current, [key]: value }; values.current = next; setForm(next);
  }
  function review() {
    if (!canView || !canManage || !context.value || context.loading || accounts.loading) return;
    const validated = adjustmentPayload(values.current, accounts.value); setError(validated.error);
    if (!validated.body) return;
    const body = validated.body, debit = accounts.value?.find(row => row.id === body.lines[0].ledger_account_id), credit = accounts.value?.find(row => row.id === body.lines[1].ledger_account_id), foreign = body.lines[0].currency !== context.value.accounting_currency;
    action.arm({ url: "/api/accounting/journals", body,
      confirmation: { title: "Post this adjustment?", description: "This creates an immediately posted two-line journal, not a draft.", warning: foreign ? "The original amount is shown below. The backend resolves functional-currency conversion for the posting date; a rate-1 payload is not a promised 1:1 conversion. Closed/sealed periods are checked by the server." : "The server validates accounts, date and accounting periods. This unkeyed posting must not be repeated after an uncertain response.", confirmLabel: "Post adjustment", details: [{ label: "Posting date", value: body.entry_date },{ label: "Original source amount", value: advancedMoney(body.lines[0].original_amount, body.lines[0].currency), emphasis: true },{ label: "Debit account", value: `${debit?.code} · ${debit?.name}` },{ label: "Credit account", value: `${credit?.code} · ${credit?.name}` },{ label: "Reason", value: body.memo },{ label: "Reference", value: body.reference || "—" }] },
      validate: payload => adjustmentMatchesPayload(payload, body),
      resultHref: payload => isJournal(payload) ? advancedJournalHref(payload.id, returnHref) : null });
  }
  return { canView, canManage, form, change, accounts, context, action, review, cancel: action.cancel, error, backHref: returnHref, crossCurrency: Boolean(context.value && form.currency !== context.value.accounting_currency), refresh: () => { action.close(); return Promise.all([accounts.refresh(), context.refresh()]); } };
}

export function useAdvancedCorrection(type: string, sourceId: string, returnHref: string) {
  const { canView, canManage } = useAdvancedPermissions(), [form, setForm] = useState({ reason: "", reversal_date: "" }), values = useRef(form), [error, setError] = useState<string | null>(null);
  const validIdentity = correctionType(type) && advancedId(sourceId);
  const candidates = useAdvancedResource("/api/accounting/corrections/candidates?limit=200", canView && validIdentity, isCandidateList);
  const source = candidates.value?.find(row => row.source_type === type && row.source_id === sourceId) || null;
  const action = useAdvancedAction(canView && canManage && validIdentity, Boolean(form.reason || form.reversal_date), returnHref);
  function change(key: "reason" | "reversal_date", value: string) {
    if (!action.canEdit()) return; action.close(); action.clearError(); setError(null); const next = { ...values.current, [key]: value }; values.current = next; setForm(next);
  }
  function review() {
    if (!canView || !canManage || !source || candidates.loading) return;
    const reason = values.current.reason.trim(), date = values.current.reversal_date;
    if (reason.length < 3 || reason.length > 500 || date && !advancedDate(date)) { setError("Enter a correction reason of 3–500 characters and a valid optional reversal date."); return; }
    setError(null);
    const body = { source_type: source.source_type, source_id: source.source_id, reason, reversal_date: date || null };
    action.arm({ url: "/api/accounting/corrections/reverse", body,
      confirmation: { title: `Reverse ${source.number}?`, description: "Correct the selected business event without deleting the original history.", warning: "The server checks source-specific dependencies, dates and provider restrictions. Some corrections return an accounting note without a journal. A failed or missing follow-up read never makes repeating this operation safe.", confirmLabel: "Confirm business reversal", details: [{ label: "Source", value: source.title },{ label: "Original date", value: source.date },{ label: "Original amount", value: advancedMoney(source.amount, source.currency), emphasis: true },{ label: "Reversal date", value: date || "Organization-local date chosen by the server" },{ label: "Reason", value: reason }] },
      validate: payload => isCorrectionResult(payload) && payload.source_type === source.source_type && payload.source_id === source.source_id && (!body.reversal_date || payload.reversal_date === body.reversal_date),
      resultHref: payload => isCorrectionResult(payload) && payload.reversal_journal_id ? advancedJournalHref(payload.reversal_journal_id, returnHref) : null });
  }
  return { canView, canManage, form, change, candidates, resource: candidates, source, validIdentity, selectedType: correctionTypes.find(row => row.value === type), action, review, cancel: action.cancel, error, backHref: returnHref, refresh: () => { action.close(); return candidates.refresh(); } };
}
export type AdvancedLedgerState = ReturnType<typeof useAdvancedLedger>;
export type AdvancedAdjustmentState = ReturnType<typeof useAdvancedAdjustment>;
export type AdvancedCorrectionState = ReturnType<typeof useAdvancedCorrection>;
