"use client";
import { useCallback } from "react";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
import { controlId } from "@/components/finance-controls/control-model";
import type { ControlTab } from "@/components/finance-controls/control-types";
import { safeControlReturn, controlDetailHref, controlActionHref } from "@/lib/finance-controls-navigation";
import { validControlList, controlEndpoints, type ControlRecord } from "./use-control-browse";
export function useControlDocument(tab: ControlTab, id: string, returnTo: string | null) {
  const { canView, canManage } = useAdvancedPermissions(),
    valid = controlId(id),
    backHref = safeControlReturn(returnTo, tab),
    validate = useCallback((v: unknown): v is ControlRecord[] => validControlList(v, tab), [tab]);
  const resource = useAdvancedResource(`/api/finance-controls/${controlEndpoints[tab]}`, canView && valid, validate),
    record = resource.value?.find(row => row.id === id) || null;
  return {
    canView,
    canManage,
    resource,
    record,
    tab,
    id,
    invalidId: !valid,
    backHref,
    detailHref: controlDetailHref(tab, id, backHref),
    actionHref: (action: string) => controlActionHref(tab, id, action, backHref),
    refresh: () => resource.refresh()
  };
}
export type ControlDocumentState = ReturnType<typeof useControlDocument>;
