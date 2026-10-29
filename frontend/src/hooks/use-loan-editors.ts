"use client";
import { useRef,useState } from "react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { agreementPayload,agreementMatchesPayload,isLoan,isLoanList,isLoanHistory,isFinancialAccountList,isReceiveResult,isRepayResult,loanId,loanMoney,loanCents,loanCentsText,receivePayload,receiveMatchesPayload,repayPayload,repayMatchesPayload,lifecycleMatches,canLoanAction } from "@/components/accounting-loans/loan-model";
import { blankAgreement,blankReceive,blankRepay } from "@/components/accounting-loans/loan-types";
import type { AgreementForm,ReceiveForm,RepayForm } from "@/components/accounting-loans/loan-types";
import { loanDetailHref } from "@/lib/loan-navigation";
import { useLoanPermissions,useLoanResource } from "./use-loan-resource";
import { useLoanAction } from "./use-loan-action";
const utcToday=()=>new Date().toISOString().slice(0,10);
function usePostingContext(id:string,needsHistory:boolean){
  const {canView,canManage}=useLoanPermissions(),valid=loanId(id);
  const resource=useLoanResource("/api/accounting/loans",canView&&valid,isLoanList),loan=resource.value?.find(row=>row.id===id)||null;
  const accounts=useLoanResource("/api/finance/accounts",canView&&valid,isFinancialAccountList);
  const history=useLoanResource(`/api/accounting/loans/${encodeURIComponent(id)}/history`,canView&&needsHistory&&Boolean(loan),isLoanHistory);
  const compatibleAccounts=(accounts.value||[]).filter(account=>account.is_active&&account.currency===loan?.currency);
  return {canView,canManage,valid,invalidId:!valid,resource,loan,accounts,history,compatibleAccounts};
}
export function useLoanAgreement(returnHref:string){
  const {canView,canManage}=useLoanPermissions(),{tenant}=useDashboardSession();
  const [baseline]=useState(()=>blankAgreement(utcToday(),tenant?.organization.currency||"")),[form,setForm]=useState<AgreementForm>(baseline),values=useRef(form),[error,setError]=useState<string|null>(null);
  const action=useLoanAction(canView&&canManage,JSON.stringify(form)!==JSON.stringify(baseline),returnHref);
  function change<K extends keyof AgreementForm>(key:K,value:AgreementForm[K]){if(!action.canEdit())return;action.close();action.clearError();setError(null);const next={...values.current,[key]:value};values.current=next;setForm(next);}
  function review(){
    if(!canView||!canManage)return;const checked=agreementPayload(values.current);setError(checked.error);if(!checked.body)return;const body=checked.body;
    action.arm({url:"/api/accounting/loans",body,confirmation:{title:"Create this draft agreement?",description:"This records the agreement only. Separate approval and receipt are required; no cash, liability or journal is posted now.",warning:"Agreement creation is unkeyed. An uncertain response must be inspected, not repeated as a new agreement. Annual rate is recorded metadata, not an automatic interest or installment calculation.",confirmLabel:"Create draft agreement",details:[{label:"Lender",value:body.lender_name},{label:"Agreement amount",value:loanMoney(body.approved_amount,body.currency),emphasis:true},{label:"Annual rate (metadata)",value:`${body.annual_interest_rate}%`},{label:"Approval date",value:body.approval_date},{label:"Maturity",value:body.maturity_date||"Not set"},{label:"Reference",value:body.reference||"—"}]},validate:value=>agreementMatchesPayload(value,body),resultHref:value=>isLoan(value)?loanDetailHref(value.id,returnHref):null});
  }
  return {canView,canManage,form,change,error,action,review,cancel:action.cancel,backHref:returnHref,preview:agreementPayload(form).body};
}
export function useLoanReceive(id:string,returnHref:string){
  const context=usePostingContext(id,false),backHref=loanDetailHref(id,returnHref);
  const [baseline]=useState(()=>blankReceive(utcToday())),[form,setForm]=useState<ReceiveForm>(baseline),values=useRef(form),[error,setError]=useState<string|null>(null);
  const action=useLoanAction(context.canView&&context.canManage&&context.valid,JSON.stringify(form)!==JSON.stringify(baseline),backHref);
  const readiness=Boolean(context.loan&&context.accounts.value&&!context.resource.loading&&!context.accounts.loading);
  function change<K extends keyof ReceiveForm>(key:K,value:ReceiveForm[K]){if(!action.canEdit())return;action.close();action.clearError();setError(null);const next={...values.current,[key]:value};values.current=next;setForm(next);}
  function review(){
    if(!readiness||!context.canManage||!context.loan)return;const checked=receivePayload(values.current,context.loan,context.accounts.value);setError(checked.error);if(!checked.body)return;const body=checked.body,loan=context.loan,account=context.accounts.value?.find(row=>row.id===body.account_id),net=loanCentsText(loanCents(body.principal_amount)!-loanCents(body.fee_withheld_amount)!);
    action.arm({url:`/api/accounting/loans/${encodeURIComponent(id)}/disburse`,body,keyed:true,confirmation:{title:"Record this loan receipt?",description:"Principal increases the loan liability. Only net proceeds enter the selected account; the withheld fee remains separately classified.",warning:"This is an immediate financial posting. The server rechecks available approval, account currency, date and accounting periods. Any offered retry reuses this exact request key and body.",confirmLabel:"Record loan receipt",details:[{label:"Loan",value:loan.lender_name},{label:"Principal received",value:loanMoney(body.principal_amount,loan.currency)},{label:"Withheld fee",value:loanMoney(body.fee_withheld_amount,loan.currency)},{label:"Net cash received",value:loanMoney(net,loan.currency),emphasis:true},{label:"Receive into",value:account?.name||body.account_id},{label:"Receipt date",value:body.disbursement_date},{label:"Reference",value:body.reference||"—"}]},validate:value=>receiveMatchesPayload(value,body,loan),resultHref:value=>isReceiveResult(value)?loanDetailHref(value.loan.id,returnHref):null});
  }
  return {...context,form,change,error,action,review,readiness,cancel:action.cancel,backHref,preview:receivePayload(form,context.loan,context.accounts.value).body,refresh:()=>{action.close();return Promise.all([context.resource.refresh(),context.accounts.refresh(),context.history.refresh()]);}};
}
export function useLoanRepay(id:string,returnHref:string){
  const context=usePostingContext(id,true),backHref=loanDetailHref(id,returnHref);
  const [baseline]=useState(()=>blankRepay(utcToday())),[form,setForm]=useState<RepayForm>(baseline),values=useRef(form),[error,setError]=useState<string|null>(null);
  const action=useLoanAction(context.canView&&context.canManage&&context.valid,JSON.stringify(form)!==JSON.stringify(baseline),backHref);
  const readiness=Boolean(context.loan&&context.accounts.value&&context.history.value&&!context.resource.loading&&!context.accounts.loading&&!context.history.loading);
  function change<K extends keyof RepayForm>(key:K,value:RepayForm[K]){if(!action.canEdit())return;action.close();action.clearError();setError(null);const next={...values.current,[key]:value};values.current=next;setForm(next);}
  function review(){
    if(!readiness||!context.canManage||!context.loan)return;const checked=repayPayload(values.current,context.loan,context.accounts.value,context.history.value);setError(checked.error);if(!checked.body)return;const body=checked.body,loan=context.loan,account=context.accounts.value?.find(row=>row.id===body.account_id),total=loanCentsText(loanCents(body.principal_amount)!+loanCents(body.interest_amount)!+loanCents(body.fee_amount)!);
    action.arm({url:`/api/accounting/loans/${encodeURIComponent(id)}/repay`,body,keyed:true,confirmation:{title:"Post this loan repayment?",description:"Only principal reduces the loan liability. Interest and fees are separately classified; the selected account pays all three parts.",warning:"The server rechecks status, available balance, canonical disbursement date, carrying value and accounting periods. The recorded annual rate does not calculate this payment. An offered retry keeps the original request key and body.",confirmLabel:"Post repayment",details:[{label:"Loan",value:loan.lender_name},{label:"Principal",value:loanMoney(body.principal_amount,loan.currency)},{label:"Interest",value:loanMoney(body.interest_amount,loan.currency)},{label:"Fee",value:loanMoney(body.fee_amount,loan.currency)},{label:"Total cash paid",value:loanMoney(total,loan.currency),emphasis:true},{label:"Pay from",value:account?.name||body.account_id},{label:"Payment date",value:body.payment_date},{label:"Reference",value:body.reference||"—"}]},validate:value=>repayMatchesPayload(value,body,loan),resultHref:value=>isRepayResult(value)?loanDetailHref(value.loan.id,returnHref):null});
  }
  return {...context,form,change,error,action,review,readiness,cancel:action.cancel,backHref,preview:repayPayload(form,context.loan,context.accounts.value,context.history.value).body,refresh:()=>{action.close();return Promise.all([context.resource.refresh(),context.accounts.refresh(),context.history.refresh()]);}};
}
export function useLoanLifecycle(id:string,kind:"approve"|"close",returnHref:string){
  const {canView,canManage}=useLoanPermissions(),valid=loanId(id),resource=useLoanResource("/api/accounting/loans",canView&&valid,isLoanList),loan=resource.value?.find(row=>row.id===id)||null,backHref=loanDetailHref(id,returnHref);
  const action=useLoanAction(canView&&canManage&&valid,false,backHref);
  function review(){if(!loan||!canManage||resource.loading||!canLoanAction(loan,kind))return;const selected=loan,target=kind==="approve"?"approved":"closed";
    action.arm({url:`/api/accounting/loans/${encodeURIComponent(id)}/${kind}`,confirmation:{title:kind==="approve"?"Approve this loan agreement?":"Formally close this loan?",description:kind==="approve"?"Approval permits later funding; it does not receive cash, recognize principal liability or post a journal.":"Formal closure records a fully repaid agreement as closed. It is not a payment and does not waive interest or fees.",warning:kind==="approve"?"The server accepts only a draft (or already-approved) agreement. All funding remains a separate explicit action.":"The server requires prior disbursement, zero outstanding principal and an approved/paid state. A zero balance alone does not prove eligibility.",confirmLabel:kind==="approve"?"Approve agreement":"Close loan",details:[{label:"Lender",value:selected.lender_name},{label:"Current status",value:selected.status},{label:"Agreement amount",value:loanMoney(selected.approved_amount,selected.currency)},{label:"Disbursed principal",value:loanMoney(selected.disbursed_amount,selected.currency)},{label:"Outstanding principal",value:loanMoney(selected.outstanding_principal,selected.currency),emphasis:true}]},validate:value=>lifecycleMatches(value,selected,target),resultHref:value=>isLoan(value)?loanDetailHref(value.id,returnHref):null});}
  return {canView,canManage,resource,loan,invalidId:!valid,action,review,cancel:action.cancel,backHref,refresh:()=>{action.close();return resource.refresh();}};
}
export type LoanAgreementState=ReturnType<typeof useLoanAgreement>;
export type LoanReceiveState=ReturnType<typeof useLoanReceive>;
export type LoanRepayState=ReturnType<typeof useLoanRepay>;
export type LoanLifecycleState=ReturnType<typeof useLoanLifecycle>;
