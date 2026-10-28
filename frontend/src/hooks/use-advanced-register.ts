"use client";
import { useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { advancedDate, isLedgerList, isTrial, isJournalList, pageRows } from "@/components/accounting-advanced/advanced-model";
import type { AdvancedBrowse, TrialBalance } from "@/components/accounting-advanced/advanced-types";
import { advancedBrowse, advancedListHref, advancedJournalHref, advancedLedgerHref, advancedAdjustmentHref, CORRECTIONS_PATH } from "@/lib/advanced-accounting-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
export function useAdvancedRegister() {
  const { canView, canManage } = useAdvancedPermissions(), router = useRouter(), query = useSearchParams();
  const browse = advancedBrowse(query.toString()), needle = browse.search.toLowerCase();
  const accounts = useAdvancedResource("/api/accounting/chart-of-accounts?include_inactive=true", canView && browse.tab === "chart", isLedgerList);
  // Capture an immutable scalar independently of the browse object returned to the view.
  const selectedDate = `${browse.asOf}`;
  const validateTrial = useCallback((payload: unknown): payload is TrialBalance => isTrial(payload) && advancedDate(payload.as_of) && (!selectedDate || payload.as_of === selectedDate), [selectedDate]);
  const trial = useAdvancedResource(`/api/accounting/trial-balance${browse.asOf ? `?as_of=${encodeURIComponent(browse.asOf)}` : ""}`, canView && browse.tab === "trial", validateTrial);
  const journals = useAdvancedResource("/api/accounting/journals?limit=200", canView && browse.tab === "journals", isJournalList);
  const trialRows = pageRows((trial.value?.rows || []).filter(row => `${row.code} ${row.name} ${row.category}`.toLowerCase().includes(needle)), browse.page);
  const journalRows = pageRows((journals.value || []).filter(row => (browse.source === "all" || browse.source === "operational" ? browse.source === "all" || !["manual","reversal","functional_currency_transition"].includes(row.source_type) : row.source_type === browse.source) && `${row.entry_number} ${row.reference || ""} ${row.memo || ""} ${row.source_type} ${row.lines.map(line => `${line.account_code} ${line.account_name} ${line.description || ""}`).join(" ")}`.toLowerCase().includes(needle)), browse.page);
  const accountRows = pageRows((accounts.value || []).filter(row => (browse.category === "all" || row.category === browse.category) && (browse.status === "all" || row.is_active === (browse.status === "active")) && `${row.code} ${row.name} ${row.category} ${row.subtype || ""}`.toLowerCase().includes(needle)), browse.page);
  const listHref = advancedListHref(browse), resource = browse.tab === "trial" ? trial : browse.tab === "journals" ? journals : accounts;
  useEffect(() => { if (!browse.focus || !resource.value) return; const timer = window.setTimeout(() => document.getElementById(`advanced-row-${browse.focus}`)?.focus(), 0); return () => window.clearTimeout(timer); }, [browse.focus, resource.value]);
  return { canView, canManage, browse, accounts, trial, journals, resource, trialRows, journalRows, accountRows, listHref,
    change: (patch: Partial<AdvancedBrowse>) => router.push(advancedListHref({ ...browse, page: 1, focus: "", ...patch })),
    refresh: () => resource.refresh(), detailHref: (id: string) => advancedJournalHref(id, advancedListHref({ ...browse, focus: id })),
    createHref: advancedLedgerHref(listHref), adjustmentHref: advancedAdjustmentHref(listHref), correctionsHref: CORRECTIONS_PATH };
}
export type AdvancedRegisterState = ReturnType<typeof useAdvancedRegister>;
