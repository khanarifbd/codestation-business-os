"use client";
import { isTaxCodeList, isSettlementList, taxId } from "@/components/accounting-tax/tax-model";
import { safeTaxReturn, taxCodeEditHref } from "@/lib/tax-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
export function useTaxDocument(kind:"code"|"settlement",id:string,returnHref:string) {
  const {canView,canManage}=useAdvancedPermissions(),valid=taxId(id),backHref=safeTaxReturn(returnHref,kind==="code"?"/dashboard/accounting/tax/codes":"/dashboard/accounting/tax/settlements");
  const codes=useAdvancedResource("/api/accounting/tax/codes?include_inactive=true",canView&&valid&&kind==="code",isTaxCodeList);
  const settlements=useAdvancedResource("/api/accounting/tax/settlements?limit=500",canView&&valid&&kind==="settlement",isSettlementList);
  const resource=kind==="code"?codes:settlements;
  return {canView,canManage,invalidId:!valid,resource,code:codes.value?.find(row=>row.id===id)??null,settlement:settlements.value?.find(row=>row.id===id)??null,backHref,editHref:taxCodeEditHref(id,backHref),refresh:()=>resource.refresh()};
}
export type TaxDocumentState=ReturnType<typeof useTaxDocument>;
