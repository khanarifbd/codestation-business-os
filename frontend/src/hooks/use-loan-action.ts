"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConfirmationDetail } from "@/components/financial-confirmation-dialog";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { getApiErrorMessage } from "@/lib/api-error";
export type LoanConfirmation = { title: string; description: string; warning: string; details: ConfirmationDetail[]; confirmLabel: string };
export type LoanCommand = { url: string; body?: unknown; keyed?: boolean; confirmation: LoanConfirmation; validate: (value: unknown) => boolean; resultHref?: (value: unknown) => string | null };
type Frozen = Omit<LoanCommand,"body"> & { bodyText?: string; key: string | null };
type Phase = "idle" | "saving" | "acknowledged" | "unknown";
/** Only existing loan disburse/repay wrappers accept explicit same-intent keyed replay. */
export function useLoanAction(canManage: boolean, dirty: boolean, returnHref: string) {
  const router = useRouter(), alive = useRef(true), allowed = useRef(canManage), pending = useRef(false), phaseRef = useRef<Phase>("idle"), command = useRef<Frozen | null>(null), replayAllowed = useRef(false);
  const [phase,setPhase] = useState<Phase>("idle"), [confirmation,setConfirmation] = useState<LoanConfirmation|null>(null), [operation,setOperation] = useState<LoanConfirmation|null>(null), [result,setResult] = useState<unknown>(null), [resultHref,setResultHref] = useState<string|null>(null), [error,setError] = useState<string|null>(null), [notice,setNotice] = useState<string|null>(null), [retryAvailable,setRetryAvailable] = useState(false);
  useLayoutEffect(()=>{allowed.current=canManage;},[canManage]);
  useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;command.current=null;};},[]);
  const navigation=useDocumentNavigationGuard(phase==="idle"?dirty:phase==="unknown",{documentLabel:"loan operation",isBusy:phase==="saving",pendingRef:pending,discardMessage:phase==="unknown"?"This loan operation has an uncertain outcome. Leaving loses the in-memory request key and submitted context. Inspect saved history before any new posting. Leave this page?":undefined});
  function close(){if(pending.current||phaseRef.current!=="idle")return;command.current=null;setConfirmation(null);setOperation(null);}
  function arm(next:LoanCommand){
    if(!canManage||!allowed.current||pending.current||phaseRef.current!=="idle"||!alive.current)return false;
    if(next.keyed&&!/^\/api\/accounting\/loans\/[A-Za-z0-9_-]+\/(?:disburse|repay)$/.test(next.url)){setError("This action does not support keyed replay.");return false;}
    let key:string|null=null;
    try{if(next.keyed)key=crypto.randomUUID();}catch{setError("A safe request key could not be created. Nothing was posted.");return false;}
    const frozenReview={...next.confirmation,details:next.confirmation.details.map(detail=>({...detail}))};
    command.current={...next,confirmation:frozenReview,bodyText:next.body===undefined?undefined:JSON.stringify(next.body),key};replayAllowed.current=false;setRetryAvailable(false);setConfirmation(frozenReview);setOperation(frozenReview);setError(null);setNotice(null);return true;
  }
  function uncertain(message:string,allowReplay:boolean){phaseRef.current="unknown";setPhase("unknown");setConfirmation(null);replayAllowed.current=allowReplay;setRetryAvailable(allowReplay);setError(message);}
  async function send(retry:boolean){
    const selected=command.current;
    if(!selected||!canManage||!allowed.current||pending.current||!alive.current)return;
    if(retry?phaseRef.current!=="unknown"||!selected.key||!replayAllowed.current:phaseRef.current!=="idle"||!confirmation||confirmation!==selected.confirmation)return;
    pending.current=true;phaseRef.current="saving";setPhase("saving");setError(null);setRetryAvailable(false);replayAllowed.current=false;
    let acknowledged=false,href:string|null=null;
    try{
      const response=await fetch(selected.url,{method:"POST",headers:{"Content-Type":"application/json",...(selected.key?{"Idempotency-Key":selected.key}:{})},...(selected.bodyText===undefined?{}:{body:selected.bodyText})});
      if(!alive.current)return;
      if(response.ok){acknowledged=true;phaseRef.current="acknowledged";setPhase("acknowledged");setConfirmation(null);setNotice("The operation was acknowledged. Do not post it again even if its returned record or follow-up read is unavailable.");navigation.markClean();}
      const payload:unknown=await response.json().catch(()=>null);
      if(!alive.current)return;
      if(response.status===401)router.replace("/login");
      if(!response.ok){
        const message=getApiErrorMessage(payload,"The loan operation was rejected. Your inputs are retained.");
        const hasDetail=Boolean(payload&&typeof payload==="object"&&"detail" in payload&&typeof payload.detail==="string"&&payload.detail.trim());
        if(response.status===409&&selected.key&&!hasDetail){uncertain("The conflict response could not be classified. The original request remains locked; inspect saved history or use only the same-request retry.",true);return;}
        const identityConflict=response.status===409&&/idempotency key|unexpected resource type/i.test(message);
        const pendingOutcome=response.status===409&&/matching financial request|original .*no longer available|original accounting journal/i.test(message);
        if(identityConflict||pendingOutcome){uncertain(`${message} The submitted operation remains locked; do not create a fresh request.`,Boolean(selected.key)&&!identityConflict);return;}
        if(retry){uncertain(`${message} This retry did not establish the earlier attempt’s outcome; retain the original request and do not create a new posting.`,Boolean(selected.key));return;}
        if([400,401,403,404,409,422].includes(response.status)){phaseRef.current="idle";setPhase("idle");command.current=null;setConfirmation(null);setOperation(null);setError(message);return;}
        uncertain("The response did not establish the outcome. Inspect saved loan history. Only an offered same-request retry retains the original key and exact submitted body.",Boolean(selected.key));return;
      }
      if(!selected.validate(payload)){setError("The operation was acknowledged but the returned posting identity could not be verified. Do not submit again; inspect saved history.");return;}
      setResult(payload);href=selected.resultHref?.(payload)??null;setResultHref(href);
    }catch{
      if(!alive.current)return;
      if(!acknowledged)uncertain("The request ended without a confirmed outcome. Inputs are locked; inspect saved history before any new posting.",Boolean(selected.key));
      else setError("The operation was acknowledged but its result could not be opened. Do not post it again.");
    }finally{
      pending.current=false;
      if(alive.current&&acknowledged&&href&&!navigation.navigate(href,{replace:true,discard:true}))setNotice("The operation was acknowledged. Automatic navigation did not finish; use its verified result link. Do not post again.");
    }
  }
  return {phase,busy:phase==="saving",locked:phase!=="idle",confirmation,operation,result,resultHref,error,notice,retryAvailable:retryAvailable&&canManage,canEdit:()=>canManage&&allowed.current&&!pending.current&&phaseRef.current==="idle",arm,close,confirm:()=>send(false),retrySameRequest:()=>send(true),navigation,cancel:()=>navigation.navigate(returnHref),clearError:()=>{if(phaseRef.current==="idle")setError(null);}};
}
