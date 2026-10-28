"use client";
import { isLoanList,isScheduleList,isLoanHistory,loanId } from "@/components/accounting-loans/loan-model";
import type { LoanActionKind } from "@/components/accounting-loans/loan-types";
import { loanActionHref } from "@/lib/loan-navigation";
import { useLoanPermissions,useLoanResource } from "./use-loan-resource";
/** No single-loan GET exists: resolve the exact document from the supported uncapped list. */
export function useLoanDocument(id:string,returnHref:string){
  const {canView,canManage}=useLoanPermissions(),valid=loanId(id);
  const resource=useLoanResource("/api/accounting/loans",canView&&valid,isLoanList),loan=resource.value?.find(row=>row.id===id)||null;
  const schedule=useLoanResource(`/api/accounting/loans/${encodeURIComponent(id)}/schedule`,canView&&Boolean(loan),isScheduleList);
  const history=useLoanResource(`/api/accounting/loans/${encodeURIComponent(id)}/history`,canView&&Boolean(loan),isLoanHistory);
  return {canView,canManage,resource,loan,invalidId:!valid,schedule,history,backHref:returnHref,actionHref:(kind:LoanActionKind)=>loanActionHref(id,kind,returnHref),refresh:()=>Promise.all([resource.refresh(),schedule.refresh(),history.refresh()])};
}
export type LoanDocumentState=ReturnType<typeof useLoanDocument>;
