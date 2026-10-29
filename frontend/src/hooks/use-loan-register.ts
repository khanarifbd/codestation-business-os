"use client";
import { useEffect } from "react";
import { useRouter,useSearchParams } from "next/navigation";
import { isLoanList,loanCents,loanCentsText,pageRows } from "@/components/accounting-loans/loan-model";
import type { LoanBrowse } from "@/components/accounting-loans/loan-types";
import { loanBrowse,loanListHref,loanDetailHref,loanCreateHref } from "@/lib/loan-navigation";
import { useLoanPermissions,useLoanResource } from "./use-loan-resource";
export function useLoanRegister(){
  const {canView,canManage}=useLoanPermissions(),query=useSearchParams(),router=useRouter(),browse=loanBrowse(query.toString());
  const resource=useLoanResource("/api/accounting/loans",canView,isLoanList), needle=browse.search.toLowerCase();
  const rows=(resource.value||[]).filter(loan=>(browse.status==="all"||loan.status===browse.status)&&`${loan.lender_name} ${loan.reference||""} ${loan.currency} ${loan.status}`.toLowerCase().includes(needle));
  const page=pageRows(rows,browse.page),totals=new Map<string,bigint>();
  for(const loan of resource.value||[]){const value=loanCents(loan.outstanding_principal)!;if(value>BigInt(0))totals.set(loan.currency,(totals.get(loan.currency)||BigInt(0))+value);}
  const byCurrency=[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([currency,value])=>({currency,amount:loanCentsText(value)}));
  const listHref=loanListHref(browse);
  useEffect(()=>{if(!browse.focus||!resource.value)return;const timer=window.setTimeout(()=>document.getElementById(`loan-row-${browse.focus}`)?.focus(),0);return()=>window.clearTimeout(timer);},[browse.focus,resource.value]);
  return {canView,canManage,browse,resource,page,byCurrency,activeCount:(resource.value||[]).filter(loan=>["active","approved"].includes(loan.status)).length,listHref,change:(patch:Partial<LoanBrowse>)=>router.push(loanListHref({...browse,page:1,focus:"",...patch})),refresh:()=>resource.refresh(),detailHref:(id:string)=>loanDetailHref(id,loanListHref({...browse,focus:id})),createHref:loanCreateHref(listHref)};
}
export type LoanRegisterState=ReturnType<typeof useLoanRegister>;
