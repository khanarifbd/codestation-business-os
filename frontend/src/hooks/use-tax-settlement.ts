"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { isSettlementMeta, isTaxSettlement, settlementPayload, settlementMatchesPayload, taxDate, taxToday, taxMoney } from "@/components/accounting-tax/tax-model";
import { blankSettlement } from "@/components/accounting-tax/tax-types";
import type { SettlementForm } from "@/components/accounting-tax/tax-types";
import { safeTaxReturn, settlementDetailHref } from "@/lib/tax-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
import { useTaxAction } from "./use-tax-action";
const consequences={indirect_tax_payment:"Decreases indirect tax payable and the selected cash/bank account.",withholding_tax_payment:"Decreases withholding tax payable and the selected cash/bank account.",input_tax_refund:"Increases the selected cash/bank account and reduces input tax receivable.",input_tax_offset:"Reduces indirect tax payable and input tax receivable without moving cash."} as const;
export function useTaxSettlement(returnHref:string) {
  const {canView,canManage}=useAdvancedPermissions(),{tenant}=useDashboardSession(),backHref=safeTaxReturn(returnHref,"/dashboard/accounting/tax/settlements");
  const [baseline]=useState(()=>blankSettlement(taxToday(tenant?.organization.timezone))),[form,setForm]=useState<SettlementForm>(baseline),values=useRef(form),[error,setError]=useState<string|null>(null);
  const metaDate=form.settlement_date,meta=useAdvancedResource(`/api/accounting/tax/settlement-meta?${new URLSearchParams({settlement_date:metaDate})}`,canView&&canManage&&taxDate(metaDate),isSettlementMeta),currentMeta=useRef(meta.value);
  useLayoutEffect(()=>{currentMeta.current=meta.value;},[meta.value]);
  const action=useTaxAction(canView&&canManage,JSON.stringify(form)!==JSON.stringify(baseline),backHref),readiness=Boolean(meta.value&&!meta.loading&&taxDate(metaDate));
  function change<K extends keyof SettlementForm>(key:K,value:SettlementForm[K]) {
    if(!action.canEdit())return;action.close();action.clearError();setError(null);const next={...values.current,[key]:value};values.current=next;setForm(next);
  }
  function review() {
    if(!canView||!canManage||!readiness||values.current.settlement_date!==metaDate||currentMeta.current!==meta.value)return;
    const checked=settlementPayload(values.current,meta.value);setError(checked.error);if(!checked.body||!meta.value)return;
    const body=checked.body,currency=meta.value.currency,account=meta.value.accounts.find(row=>row.id===body.account_id);
    action.arm({url:"/api/accounting/tax/settlements",body,
      confirmation:{title:"Post this tax settlement?",description:consequences[body.settlement_type],warning:`This immediately posts accounting entries${body.account_id?" and a cash movement":""}; it is not a draft. The server verifies date-safe ledger availability and accounting periods. This operation has no request-key replay contract.${checked.warning?` ${checked.warning}`:""}`,confirmLabel:"Post tax settlement",details:[{label:"Settlement",value:body.settlement_type.replaceAll("_"," ")},{label:"Posting date",value:body.settlement_date},{label:"Functional amount",value:taxMoney(body.amount,currency),emphasis:true},{label:body.settlement_type==="input_tax_refund"?"Receive into":"Financial account",value:account?`${account.name} · ${account.id}`:"None · non-cash offset"},{label:"Reference",value:body.reference||"—"}]},validate:value=>settlementMatchesPayload(value,body,currency),resultHref:value=>isTaxSettlement(value)?settlementDetailHref(value.id,backHref):null});
  }
  const checked=settlementPayload(form,meta.value);
  return {canView,canManage,meta,form,change,error,action,review,cancel:action.cancel,backHref,readiness,preview:checked.body,warning:checked.warning,currency:meta.value?.currency??"",selectedAccount:meta.value?.accounts.find(row=>row.id===form.account_id)??null,refresh:()=>{action.close();currentMeta.current=null;return meta.refresh();}};
}
export type TaxSettlementState=ReturnType<typeof useTaxSettlement>;
