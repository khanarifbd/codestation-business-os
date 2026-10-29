"use client";
import { useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { isTaxCodeList, reportMatchesDates, isRecentSettlementList, pageRows, taxToday, taxDate } from "@/components/accounting-tax/tax-model";
import type { TaxReport, TaxCodeBrowse, SettlementBrowse } from "@/components/accounting-tax/tax-types";
import { taxReportBrowse, taxReportHref, taxCodeBrowse, taxCodeListHref, taxCodeCreateHref, taxCodeDetailHref, settlementBrowse, settlementListHref, settlementCreateHref, settlementDetailHref } from "@/lib/tax-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
function useReturnFocus(focus: string, loaded: unknown, prefix: string) {
  useEffect(() => { if (!focus || !loaded) return; const timer = window.setTimeout(() => document.getElementById(`${prefix}-${focus}`)?.focus(), 0); return () => window.clearTimeout(timer); }, [focus, loaded, prefix]);
}
export function useTaxReport() {
  const { canView, canManage } = useAdvancedPermissions(), { tenant } = useDashboardSession(), router = useRouter(), query = useSearchParams();
  const today = taxToday(tenant?.organization.timezone), browse = taxReportBrowse(query.toString(), { date_from: today ? `${today.slice(0,7)}-01` : "", date_to: today });
  // Capture primitive copies independently of the browse object exposed to views.
  const requestedFrom=`${browse.date_from}`, requestedTo=`${browse.date_to}`, valid = taxDate(requestedFrom) && taxDate(requestedTo);
  const validate = useCallback((value: unknown): value is TaxReport => reportMatchesDates(value,{date_from:requestedFrom,date_to:requestedTo}), [requestedFrom, requestedTo]);
  const resource = useAdvancedResource(`/api/accounting/tax/report?${new URLSearchParams({ date_from: browse.date_from, date_to: browse.date_to })}`, canView && valid, validate);
  return { canView, canManage, resource, browse, invalidDates: !valid, applyDates: ({from,to}: {from:string;to:string}) => router.push(taxReportHref({date_from:from,date_to:to})), refresh: () => resource.refresh() };
}
export function useTaxCodes() {
  const { canView, canManage } = useAdvancedPermissions(), router = useRouter(), query = useSearchParams(), browse = taxCodeBrowse(query.toString());
  const resource = useAdvancedResource("/api/accounting/tax/codes?include_inactive=true", canView, isTaxCodeList), needle = browse.search.toLowerCase();
  const filtered = (resource.value || []).filter(code => (browse.kind === "all" || code.tax_kind === browse.kind) && (browse.active === "all" || code.is_active === (browse.active === "active")) && `${code.code} ${code.name} ${code.jurisdiction || ""}`.toLowerCase().includes(needle));
  const paged = pageRows(filtered, browse.page), listHref = taxCodeListHref({...browse,page:paged.page});
  useReturnFocus(browse.focus, resource.value, "tax-code-row");
  return {canView,canManage,resource,browse,rows:paged.rows,total:resource.value?.length ?? 0,filteredCount:paged.total,page:paged.page,pageCount:paged.pages,listHref,createHref:taxCodeCreateHref(listHref),viewHref:(id:string)=>taxCodeDetailHref(id,taxCodeListHref({...browse,page:paged.page,focus:id})),applyFilters:(next:Partial<TaxCodeBrowse>)=>router.push(taxCodeListHref({...browse,...next,page:1,focus:""})),goPage:(page:number)=>router.push(taxCodeListHref({...browse,page:pageRows(filtered,page).page,focus:""})),refresh:()=>resource.refresh()};
}
export function useTaxSettlements() {
  const { canView, canManage } = useAdvancedPermissions(), router = useRouter(), query = useSearchParams(), browse = settlementBrowse(query.toString());
  const resource = useAdvancedResource("/api/accounting/tax/settlements?limit=50", canView, isRecentSettlementList), needle = browse.search.toLowerCase();
  const filtered = (resource.value || []).filter(row => (browse.type === "all" || row.settlement_type === browse.type) && (!browse.currency || row.currency === browse.currency) && `${row.reference || ""} ${row.settlement_date} ${row.settlement_type} ${row.id}`.toLowerCase().includes(needle));
  const paged = pageRows(filtered,browse.page), listHref = settlementListHref({...browse,page:paged.page});
  useReturnFocus(browse.focus,resource.value,"tax-settlement-row");
  return {canView,canManage,resource,browse,rows:paged.rows,total:resource.value?.length ?? 0,filteredCount:paged.total,page:paged.page,pageCount:paged.pages,listHref,createHref:settlementCreateHref(listHref),viewHref:(id:string)=>settlementDetailHref(id,settlementListHref({...browse,page:paged.page,focus:id})),applyFilters:(next:Partial<SettlementBrowse>)=>router.push(settlementListHref({...browse,...next,page:1,focus:""})),goPage:(page:number)=>router.push(settlementListHref({...browse,page:pageRows(filtered,page).page,focus:""})),refresh:()=>resource.refresh()};
}
export type TaxReportState = ReturnType<typeof useTaxReport>;
export type TaxCodesState = ReturnType<typeof useTaxCodes>;
export type TaxSettlementsState = ReturnType<typeof useTaxSettlements>;
