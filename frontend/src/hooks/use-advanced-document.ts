"use client";
import { useCallback } from "react";
import { advancedId, advancedMoney, isJournal, journalReversalMatches } from "@/components/accounting-advanced/advanced-model";
import { advancedJournalHref } from "@/lib/advanced-accounting-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
import { useAdvancedAction } from "./use-advanced-action";
export function useAdvancedDocument(id: string, reversing: boolean, returnHref: string) {
  const { canView, canManage } = useAdvancedPermissions();
  const validate = useCallback((payload: unknown): payload is import("@/components/accounting-advanced/advanced-types").Journal => isJournal(payload) && payload.id === id, [id]);
  const resource = useAdvancedResource(`/api/accounting/journals/${encodeURIComponent(id)}`, canView && advancedId(id), validate);
  const journal = resource.value, backHref = reversing ? advancedJournalHref(id, returnHref) : returnHref;
  const action = useAdvancedAction(canView && canManage && reversing, false, backHref);
  function review() {
    if (!journal || journal.source_type !== "manual" || journal.status !== "posted" || !reversing || !canView || !canManage) return;
    action.arm({ url: `/api/accounting/journals/${encodeURIComponent(journal.id)}/reverse`,
      confirmation: { title: `Reverse ${journal.entry_number}?`, description: "Create a separate posted reversal. The original journal remains unchanged.", warning: "The reversal uses the original entry date, not today. The server checks closed/sealed periods and any existing reversal. No automatic retry is safe after an uncertain response.", confirmLabel: "Confirm journal reversal", details: [{ label: "Original journal", value: journal.entry_number },{ label: "Posting date", value: journal.entry_date },{ label: "Functional debit / credit", value: `${advancedMoney(journal.total_debit,journal.functional_currency)} / ${advancedMoney(journal.total_credit,journal.functional_currency)}` }] },
      validate: payload => journalReversalMatches(payload, journal),
      resultHref: payload => isJournal(payload) ? advancedJournalHref(payload.id, returnHref) : null });
  }
  return { canView, canManage, resource, journal, invalidId: !advancedId(id), reversing, action, review, cancel: action.cancel, backHref, reverseHref: advancedJournalHref(id, returnHref, true), refresh: () => { action.close(); return resource.refresh(); } };
}
export type AdvancedDocumentState = ReturnType<typeof useAdvancedDocument>;
