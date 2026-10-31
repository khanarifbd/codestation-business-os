"use client";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {usePathname,useRouter} from "next/navigation";
import {useDashboardSession} from "@/components/dashboard-session-context";
import {decodeCapitalResponse} from "@/components/capital/capital-exact-response";
import {getApiErrorMessage} from "@/lib/api-error";
import {hasAccountingRejectionDetail} from "@/lib/accounting-rejection";
import {capitalPayload,isCapitalDashboard,isCapitalInsights,isCapitalMeta,isCapitalRows,isCapitalReceipt,type Tab,type Meta,type Dashboard,type Insights,type CompanyInvestor,type ProjectInvestor,type Investment,type OwnerEquity} from "@/components/capital/capital-model";
type Rows=CompanyInvestor[]|ProjectInvestor[]|Investment[]|OwnerEquity[];
type Phase="idle"|"pending"|"unknown"|"acknowledged"|"saved";
class CapitalRequestError extends Error {constructor(message:string,public status:number,public definite=false){super(message);}}
export async function capitalRequest(url:string,init?:RequestInit,acknowledge?:()=>void):Promise<unknown>{
 const response=await fetch(url,{cache:"no-store",...init});if(response.ok)acknowledge?.();
 const body:unknown=await response.json().catch(()=>null);
 if(!response.ok)throw new CapitalRequestError(getApiErrorMessage(body,"Capital request failed."),response.status,[400,401,403,404,409,422].includes(response.status)&&hasAccountingRejectionDetail(body));
 return decodeCapitalResponse(body);
}
export function useCapitalWorkspace(insights=false){
 const {tenant,loading:sessionLoading}=useDashboardSession(),router=useRouter(),pathname=usePathname();
 const key=JSON.stringify([tenant?.organization.id,tenant?.membership_id,tenant?.role_id,tenant?.permissions,pathname,sessionLoading]);
 const owner=useMemo(()=>({key}),[key]),active=useRef<typeof owner|null>(null);
 const [tab,setTabState]=useState<Tab>("overview"),[generation,setGeneration]=useState(0);
 const view=useMemo(()=>({owner,tab,generation}),[owner,tab,generation]),activeView=useRef<typeof view|null>(null);
 const canView=!sessionLoading&&Boolean(tenant?.permissions.some(p=>p==="*"||p==="capital.view"));
 const canManage=canView&&Boolean(tenant?.permissions.some(p=>p==="*"||p==="capital.manage"));
 const lockKey=tenant?.organization.id??"",locks=useRef(new Map<string,Phase>()),pending=useRef<object|null>(null),readEpoch=useRef(0);
 const [phaseState,setPhase]=useState<{owner:typeof owner;value:Phase}|null>(null);
 const phase=phaseState?.owner===owner?phaseState.value:locks.current.get(lockKey)??"idle";
 const [state,setState]=useState<{view:typeof view;dashboard:Dashboard|null;meta:Meta|null;rows:Rows|null;insights:Insights|null;loading:boolean;error:string|null}|null>(null);
 const proof=useRef<typeof state>(null);
 const [notice,setNotice]=useState<{owner:typeof owner;message:string}|null>(null);
 const owns=useCallback(()=>active.current===owner&&activeView.current===view&&canView,[owner,view,canView]);
 useLayoutEffect(()=>{active.current=owner;activeView.current=view;pending.current=null;proof.current=null;readEpoch.current++;return()=>{if(activeView.current===view){activeView.current=null;readEpoch.current++;}if(active.current===owner)active.current=null;};},[owner,view]);
 const current=state?.view===view?state:null;
 const load=useCallback(async()=>{
  if(!owns()||pending.current)return false;
  proof.current=null;
  const epoch=++readEpoch.current,valid=()=>owns()&&epoch===readEpoch.current;
  setState(previous=>({view,dashboard:previous?.view===view?previous.dashboard:null,meta:previous?.view===view?previous.meta:null,rows:previous?.view===view?previous.rows:null,insights:previous?.view===view?previous.insights:null,loading:true,error:null}));
  try{
   if(insights){const value=await capitalRequest("/api/capital/insights");if(!valid())return false;if(!isCapitalInsights(value))throw new Error("Capital insights could not be verified; this is not an empty result.");const verified={view,dashboard:null,meta:null,rows:null,insights:value,loading:false,error:null};proof.current=verified;setState(verified);}
   else {const paths:Record<Exclude<Tab,"overview">,string>={owner:"owner-equity",company:"company-investors",project:"project-investors",ours:"investments"};
    const [dashboard,meta,rows]=await Promise.all([capitalRequest("/api/capital/dashboard"),tab==="overview"?null:capitalRequest("/api/capital/meta"),tab==="overview"?null:capitalRequest(`/api/capital/${paths[tab]}`)]);
    if(!valid())return false;if(!isCapitalDashboard(dashboard)||tab!=="overview"&&(!isCapitalMeta(meta)||!isCapitalRows(rows,tab)))throw new Error("Capital information could not be verified; this is not an empty result.");
    const verified={view,dashboard,meta:meta as Meta|null,rows:rows as Rows|null,insights:null,loading:false,error:null};proof.current=verified;setState(verified);
   }return true;
  }catch(reason){if(!valid())return false;const mayRetain=!(reason instanceof CapitalRequestError&&[401,403].includes(reason.status));setState(previous=>({view,dashboard:mayRetain&&previous?.view===view?previous.dashboard:null,meta:mayRetain&&previous?.view===view?previous.meta:null,rows:mayRetain&&previous?.view===view?previous.rows:null,insights:mayRetain&&previous?.view===view?previous.insights:null,loading:false,error:reason instanceof Error?reason.message:"Capital information unavailable."}));if(reason instanceof CapitalRequestError&&reason.status===401)router.replace("/login");return false;}
 },[owns,view,insights,tab,router]);
 useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)void load();});return()=>{active=false;};},[load]);
 const blocked=phase!=="idle"||!canManage||!current||current.loading||Boolean(current.error);
 function setTab(next:Tab){if(!owns()||pending.current||locks.current.has(lockKey))return;proof.current=null;setTabState(next);}
 async function post(path:string,payload:Record<string,unknown>,message:string){
  if(!owns()||blocked||!current||proof.current!==current||pending.current||locks.current.has(lockKey))return;
  const paths:Record<Tab,string>={overview:"",owner:"owner-equity",company:"company-investors",project:"project-investors",ours:"investments"};
  const prefix=paths[tab],parts=path.split("/");
  if(!prefix||parts[0]!==prefix||parts.length!==1&&parts.length!==3)return;
  if(parts.length===3){const row=current?.rows?.find(row=>row.id===parts[1]);if(!row||!(tab==="ours"?["fundings","returns"]:["fundings","payouts"]).includes(parts[2])||("status" in row&&(tab==="ours"?row.status==="exited":row.status!=="active")))return;}
  if(payload.account_id!==undefined&&!current?.meta?.accounts.some(account=>account.id===payload.account_id&&account.account_type!=="credit_card"))return;
  if(payload.project_id!==undefined&&!current?.meta?.projects.some(project=>project.id===payload.project_id))return;
  let wire:Record<string,unknown>;try{wire=capitalPayload(payload);}catch(reason){setNotice({owner,message:reason instanceof Error?reason.message:"Check the entered values."});return;}
  const operation={};pending.current=operation;locks.current.set(lockKey,"pending");setPhase({owner,value:"pending"});setNotice(null);readEpoch.current++;
  let acknowledged=false;
  const currentOperation=()=>owns()&&pending.current===operation;
  try{
   const result=await capitalRequest(`/api/capital/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(wire)},()=>{acknowledged=true;locks.current.set(lockKey,"acknowledged");if(currentOperation())setPhase({owner,value:"acknowledged"});});
   if(!currentOperation())return;
   if(!isCapitalReceipt(result,path,wire))throw new Error("The server acknowledged this action but its receipt could not be verified.");
   locks.current.set(lockKey,"saved");setPhase({owner,value:"saved"});setNotice({owner,message:`${message} Verified response for record ${result.id}. Review current records before starting another entry.`});
  }catch(reason){
   const definite=!acknowledged&&reason instanceof CapitalRequestError&&reason.definite;
   const next:Phase=acknowledged?"acknowledged":definite?"idle":"unknown";
   if(definite)locks.current.delete(lockKey);else locks.current.set(lockKey,next);
   if(!currentOperation())return;setPhase({owner,value:next});setNotice({owner,message:acknowledged?"The server acknowledged this action, but its receipt could not be verified. Do not submit it again; review the current records.":definite?(reason as Error).message:"The write outcome is uncertain. Your inputs are retained and submission is locked in this document. Review current records before any replacement; an absent row does not prove failure."});
   if(reason instanceof CapitalRequestError&&reason.status===401)router.replace("/login");
  }finally{if(pending.current===operation)pending.current=null;}
 }
 async function startAnother(){if(!owns()||pending.current||locks.current.get(lockKey)!=="saved")return;const verified=await load();if(!owns()||!verified||locks.current.get(lockKey)!=="saved")return;locks.current.delete(lockKey);setPhase({owner,value:"idle"});setNotice(null);setGeneration(v=>v+1);}
 return {tab,setTab,post,startAnother,phase,blocked,canView,canManage,sessionLoading,defaultCurrency:tenant?.organization.currency||"USD",generation,ownerKey:key,loading:canView&&(!current||current.loading),error:current?.error??null,success:notice?.owner===owner?notice.message:phase==="unknown"?"The write outcome is uncertain. Submission remains locked for this company in this document; verify the original action before any replacement.":phase==="acknowledged"?"An earlier action was acknowledged but its receipt is unverified. Do not submit it again.":phase==="pending"?"A capital action is still being reconciled. Do not submit another action.":null,dashboard:current?.dashboard??null,meta:current?.meta??null,rows:current?.rows??null,insightData:current?.insights??null,refreshCurrent:load};
}
