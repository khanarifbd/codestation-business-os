"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isCandidateList, isHistoryList, pageRows } from "@/components/accounting-advanced/advanced-model";
import type { CorrectionBrowse, CorrectionType } from "@/components/accounting-advanced/advanced-types";
import { correctionBrowse, correctionListHref, correctionActionHref, advancedJournalHref } from "@/lib/advanced-accounting-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
export function useAdvancedCorrections() {
  const { canView, canManage } = useAdvancedPermissions(), router = useRouter(), query = useSearchParams();
  const browse = correctionBrowse(query.toString()), needle = browse.search.toLowerCase();
  const candidates = useAdvancedResource("/api/accounting/corrections/candidates?limit=200", canView && browse.tab === "candidates", isCandidateList);
  const history = useAdvancedResource("/api/accounting/corrections/history?limit=100", canView && browse.tab === "history", isHistoryList);
  const candidateRows = pageRows((candidates.value || []).filter(row => (browse.type === "all" || row.source_type === browse.type) && `${row.number} ${row.title} ${row.subtitle} ${row.date} ${row.currency}`.toLowerCase().includes(needle)), browse.page);
  const historyRows = pageRows((history.value || []).filter(row => (browse.type === "all" || row.source_type === browse.type) && `${row.source_type} ${row.reason || ""} ${row.message || ""} ${row.source_id || ""}`.toLowerCase().includes(needle)), browse.page);
  const resource = browse.tab === "history" ? history : candidates, listHref = correctionListHref(browse);
  useEffect(() => { if (!browse.focus || !resource.value) return; const timer = window.setTimeout(() => document.getElementById(`correction-row-${browse.focus}`)?.focus(), 0); return () => window.clearTimeout(timer); }, [browse.focus, resource.value]);
  return { canView, canManage, browse, candidates, history, resource, candidateRows, historyRows, listHref,
    change: (patch: Partial<CorrectionBrowse>) => router.push(correctionListHref({ ...browse, page: 1, focus: "", ...patch })), refresh: () => resource.refresh(),
    actionHref: (type: CorrectionType, id: string) => correctionActionHref(type, id, correctionListHref({ ...browse, focus: id })),
    detailHref: (id: string, historyId: string) => advancedJournalHref(id, correctionListHref({ ...browse, focus: historyId })) };
}
export type AdvancedCorrectionsState = ReturnType<typeof useAdvancedCorrections>;
