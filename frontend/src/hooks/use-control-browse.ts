"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
import { isRecurringList, isAutomationList, isPeriodList, pageRows } from "@/components/finance-controls/control-model";
import type { ControlTab, ControlRecurring, ControlAutomation, ControlPeriod } from "@/components/finance-controls/control-types";
import { controlBrowse, controlListHref, controlDetailHref, controlCreateHref } from "@/lib/finance-controls-navigation";
export type ControlRecord = ControlRecurring | ControlAutomation | ControlPeriod;
export const controlEndpoints = { recurring: "recurring-expenses", automation: "recurring-auto-post", periods: "accounting-periods" } as const;
export const controlValidators: Record<ControlTab, (value: unknown) => value is ControlRecord[]> = { recurring: isRecurringList, automation: isAutomationList, periods: isPeriodList };
export function validControlList(value: unknown, tab: ControlTab): value is ControlRecord[] { return tab === "recurring" ? isRecurringList(value) : tab === "automation" ? isAutomationList(value) : isPeriodList(value); }
export function useControlBrowse(defaultTab: ControlTab = "recurring") {
  const { canView, canManage } = useAdvancedPermissions(),
    query = useSearchParams(),
    router = useRouter(),
    browse = controlBrowse(query.toString(), defaultTab),
    tab = browse.tab;
  const validate = controlValidators[tab];
  const resource = useAdvancedResource(`/api/finance-controls/${controlEndpoints[tab]}`, canView, validate), needle = browse.search.toLowerCase();
  const all = resource.value || [],
    filtered = all.filter(row => {
      const matches = `${row.name} ${"description" in row ? row.description : ""} ${"account_name" in row ? row.account_name : ""}`.toLowerCase().includes(needle);
      const status = "status" in row ? row.status : tab === "automation" && "auto_post" in row ? (row.auto_post ? "enabled" : "disabled") : (row.is_active ? "active" : "paused");
      if (tab === "automation" && "eligible" in row) {
        if (browse.status === "needs_attention")
          return matches && Boolean(row.last_error);
        if (browse.status === "eligible")
          return matches && row.eligible;
        if (browse.status === "ineligible")
          return matches && !row.eligible;
      }
      return matches && (browse.status === "all" || browse.status === status);
    });
  const paged = pageRows(filtered, browse.page), listHref = controlListHref({ ...browse, page: paged.page });
  useEffect(() => {
    if (!browse.focus || !resource.value)
      return;
    const timer = window.setTimeout(() => document.getElementById(`control-row-${browse.focus}`)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [browse.focus, resource.value]);
  return {

    canView,
    canManage,
    resource,
    browse,
    tab,
    rows: paged.rows,
    total: all.length,
    filteredCount: paged.total,
    page: paged.page,
    pageCount: paged.pages,
    listHref,
    createHref: controlCreateHref(tab, listHref),
    viewHref: (id: string) => controlDetailHref(tab, id, controlListHref({ ...browse, page: paged.page, focus: id })),
    apply: (patch: {
      search?: string;
      status?: string;
      tab?: ControlTab;
    }) => router.push(controlListHref({ ...browse, ...patch, page: 1, focus: "" })),
    goPage: (page: number) => router.push(controlListHref({ ...browse, page: pageRows(filtered, page).page, focus: "" })),
    refresh: () => resource.refresh()

  };
}
export type ControlBrowseState = ReturnType<typeof useControlBrowse>;
