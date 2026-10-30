"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAdministrationReadOwner } from "./use-administration-read-owner";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";
import { hasAccountingRejectionDetail } from "@/lib/accounting-rejection";
export type ProviderChildLeaveRegistration = (guard: () => boolean) => () => void;
/** UI-only ownership. Never stores credentials or calls a provider. */
export function useCompanyProviderChild(scope: string, enabled: boolean, registerLeaveGuard?: ProviderChildLeaveRegistration, registerOperationGuard?: ProviderChildLeaveRegistration, mayStart?: () => boolean) {
 const owner=useAdministrationReadOwner(), identity=useMemo(()=>({key:owner.key,scope,enabled}),[owner.key,scope,enabled]);
 const active=useRef<object|null>(null),pending=useRef(false),generation=useRef(0),dirtyRef=useRef(false),phaseRef=useRef("idle");
 const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[phase,setPhase]=useState("idle"),[error,setError]=useState<string|null>(null);
 const ownerCurrent=owner.current;
 const owns=useCallback(()=>ownerCurrent()&&active.current===identity,[ownerCurrent,identity]);
 useLayoutEffect(()=>{active.current=identity;return()=>{if(active.current===identity){active.current=null;}};},[identity]);
 const renderedGeneration=generation.current;
 const current=()=>owns()&&generation.current===renderedGeneration;
 const canEdit=()=>current()&&enabled&&!pending.current&&phaseRef.current==="idle";
 const confirmLeave=useCallback(()=>{if(!owns()||pending.current)return false;if(phaseRef.current!=="idle")return window.confirm("This Stripe setup operation may already have completed. Leaving loses its retained outcome. Review current status before any replacement. Leave?");return !dirtyRef.current||window.confirm("Discard the unsaved Stripe setup values and leave?");},[owns]);
 const canOperate=useCallback(()=>owns()&&!pending.current&&phaseRef.current==="idle"&&!dirtyRef.current,[owns]);
 useLayoutEffect(()=>registerOperationGuard?.(canOperate),[registerOperationGuard,canOperate]);
 useLayoutEffect(()=>registerLeaveGuard?.(confirmLeave),[registerLeaveGuard,confirmLeave]);
 useDocumentNavigationGuard(dirty||phase!=="idle",{pendingRef:pending,isBusy:busy,discardMessage:"Stripe setup has unsaved or unconfirmed changes. Review current status before replacing an earlier operation."});
 function changeDirty(value:boolean){if(!canEdit())return false;dirtyRef.current=value;setDirty(value);setError(null);return true;}
 function discard(){if(!canEdit())return false;generation.current++;dirtyRef.current=false;setDirty(false);setError(null);return true;}
 async function run(work:()=>Promise<Response>,valid:(value:unknown)=>boolean,accept:()=>Promise<void>|void){
  if(!canEdit()||(mayStart&&!mayStart()))return false;pending.current=true;setBusy(true);setError(null);let acknowledged=false;
  try{const response=await work();if(!owns())return false;if(response.ok){acknowledged=true;phaseRef.current="acknowledged";setPhase("acknowledged");}const body:unknown=await response.json().catch(()=>null);if(!owns())return false;
   if(!response.ok){const rejected=[400,401,403,404,422].includes(response.status)&&hasAccountingRejectionDetail(body);phaseRef.current=rejected?"idle":"unknown";setPhase(phaseRef.current);setError(rejected?"Stripe setup was rejected. Review the entered values and account requirements.":"The Stripe setup outcome is unknown. Do not submit it again; review current status before any replacement.");return false;}
   if(!valid(body))throw Error("unverified");await accept();if(!owns())return false;
   generation.current++;dirtyRef.current=false;setDirty(false);phaseRef.current="idle";setPhase("idle");return true;
  }catch{if(owns()){phaseRef.current=acknowledged?"acknowledged":"unknown";setPhase(phaseRef.current);setError(acknowledged?"Stripe setup was acknowledged, but confirmation could not be completed. Do not repeat it; review current status.":"The Stripe setup outcome is unknown. Do not submit it again; review current status before any replacement.");}return false;}
  finally{if(owns()){pending.current=false;setBusy(false);}}
 }
 return{identity,current,canEdit,changeDirty,discard,run,busy,phase,error,locked:!enabled||busy||phase!=="idle"};
}
