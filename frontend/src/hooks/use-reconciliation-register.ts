"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isReconciliationList, reconciliationFiltered, reconciliationPage } from "@/components/accounting-reconciliation/reconciliation-model";
import type { ReconciliationBrowse } from "@/components/accounting-reconciliation/reconciliation-types";
import { reconciliationBrowse, reconciliationCreateHref, reconciliationDocumentHref, reconciliationListHref } from "@/lib/reconciliation-navigation";
import { useReconciliationPermissions, useReconciliationResource } from "./use-reconciliation-resource";

export function useReconciliationRegister() {
  const { canView, canManage } = useReconciliationPermissions(), router = useRouter(), query = useSearchParams();
  const browse = reconciliationBrowse(query.toString());
  const resource = useReconciliationResource("/api/accounting/reconciliations", canView, isReconciliationList);
  const filtered = reconciliationFiltered(resource.value || [], browse), page = reconciliationPage(filtered, browse.page);
  const accounts = Array.from(new Map((resource.value || []).map(row => [row.account_id, { id: row.account_id, name: row.account_name, currency: row.currency }])).values());
  const listHref = reconciliationListHref(browse);
  useEffect(() => {
    if (!browse.focus || !resource.value) return;
    const timer = window.setTimeout(() => document.getElementById(`reconciliation-row-${browse.focus}`)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [browse.focus, resource.value]);
  return { canView, canManage, resource, browse, filtered, page, accounts, listHref,
    createHref: reconciliationCreateHref(listHref),
    detailHref: (id: string) => reconciliationDocumentHref(id, reconciliationListHref({ ...browse, focus: id })),
    change: (patch: Partial<ReconciliationBrowse>) => router.push(reconciliationListHref({ ...browse, page: 1, focus: "", ...patch })),
    refresh: () => resource.refresh(),
  };
}
export type ReconciliationRegisterState = ReturnType<typeof useReconciliationRegister>;
