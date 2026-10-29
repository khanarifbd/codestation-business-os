"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTaxCodeList, isTaxCode, taxId, taxRate, codeCreatePayload, codeUpdatePayload, codeMatchesCreate, codeMatchesUpdate, taxCodeForm } from "@/components/accounting-tax/tax-model";
import { blankTaxCode } from "@/components/accounting-tax/tax-types";
import type { TaxCode, TaxCodeForm, TaxCodeCreateBody } from "@/components/accounting-tax/tax-types";
import { safeTaxReturn, taxCodeDetailHref } from "@/lib/tax-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
import { useTaxAction } from "./use-tax-action";
export function useTaxCodeEditor(id:string|null,returnHref:string) {
  const {canView,canManage}=useAdvancedPermissions(),editing=id!==null,valid=!editing||taxId(id),backHref=safeTaxReturn(returnHref,"/dashboard/accounting/tax/codes");
  const resource=useAdvancedResource("/api/accounting/tax/codes?include_inactive=true",canView&&canManage&&editing&&valid,isTaxCodeList),source=resource.value?.find(row=>row.id===id)??null;
  const [baseline,setBaseline]=useState<TaxCodeForm>(()=>blankTaxCode()),[form,setForm]=useState<TaxCodeForm>(baseline),values=useRef(form),seed=useRef<TaxCode|null>(null),[savedSource,setSavedSource]=useState<TaxCode|null>(null),[initialized,setInitialized]=useState(!editing),[error,setError]=useState<string|null>(null),currentSource=useRef(source);
  useLayoutEffect(()=>{currentSource.current=source;},[source]);
  const cancelHref=editing&&valid?taxCodeDetailHref(id!,backHref):backHref;
  const action=useTaxAction(canView&&canManage&&valid,JSON.stringify(form)!==JSON.stringify(baseline),cancelHref);
  useEffect(()=>{if(!editing||!source||seed.current)return;let active=true;queueMicrotask(()=>{if(!active||seed.current)return;const next=taxCodeForm(source);seed.current=source;setSavedSource(source);values.current=next;setBaseline(next);setForm(next);setInitialized(true);});return()=>{active=false;};},[source,editing]);
  const readiness=valid&&initialized&&(!editing||Boolean(source&&!resource.loading&&savedSource?.id===id));
  function change<K extends keyof TaxCodeForm>(key:K,value:TaxCodeForm[K]) {
    if(!action.canEdit()||!readiness)return;action.close();action.clearError();setError(null);const next={...values.current,[key]:value};values.current=next;setForm(next);
  }
  function review() {
    if(!canView||!canManage||!readiness||(editing&&currentSource.current!==source))return;
    const checked=editing&&seed.current?codeUpdatePayload(values.current,seed.current):codeCreatePayload(values.current);setError(checked.error);if(!checked.body)return;
    const body=checked.body,original=seed.current;
    action.arm({url:editing?`/api/accounting/tax/codes/${encodeURIComponent(id!)}`:"/api/accounting/tax/codes",method:editing?"PATCH":"POST",body,
      confirmation:{title:editing?`Update ${original?.code}?`:`Create ${values.current.code.trim().toUpperCase()}?`,description:"This changes the company's configured tax code. It does not post a payment or rewrite historical document tax snapshots.",warning:"Verify applicability with your accounting policy. This is not a statutory filing or compliance certification. An uncertain response must be checked against saved codes before another write.",confirmLabel:editing?"Save tax code":"Create tax code",details:[{label:"Code / name",value:`${values.current.code.trim().toUpperCase()} · ${values.current.name.trim()}`},{label:"Tax kind",value:values.current.tax_kind},{label:"Rate",value:`${taxRate(values.current.rate)}%`},{label:"Recoverable input",value:values.current.tax_kind==="purchase"?`${taxRate(values.current.recoverable_percent)}%`:"Not applicable"},{label:"Active",value:values.current.is_active?"Yes":"No"}]},
      validate:value=>editing&&original?codeMatchesUpdate(value,original,body):codeMatchesCreate(value,body as TaxCodeCreateBody),resultHref:value=>isTaxCode(value)?taxCodeDetailHref(value.id,backHref):null});
  }
  const preview=editing&&savedSource?codeUpdatePayload(form,savedSource).body:codeCreatePayload(form).body;
  return {canView,canManage,editing,invalidId:!valid,resource,source,form,change,error,action,review,cancel:action.cancel,backHref:cancelHref,readiness,preview,refresh:()=>{action.close();currentSource.current=null;return resource.refresh();}};
}
export type TaxCodeEditorState=ReturnType<typeof useTaxCodeEditor>;
