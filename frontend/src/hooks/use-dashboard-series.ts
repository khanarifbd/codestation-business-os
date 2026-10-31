"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdministrationReadOwner } from "./use-administration-read-owner";
import { decodeDashboardSeries, type DashboardSeriesData, type DashboardSeriesScope } from "@/lib/dashboard-series-contract";
export type DashboardSeriesReadProps = DashboardSeriesScope & { enabled: boolean };
type ReadState = { scope: string; data: DashboardSeriesData | null; loading: boolean; error: string | null; restricted: boolean };
export function useDashboardSeries({ organizationId, dateFrom, dateTo, timezone, enabled }: DashboardSeriesReadProps) {
 const owner = useAdministrationReadOwner(), router = useRouter(), owns = owner.current;
 const scope = JSON.stringify([owner.key,organizationId,dateFrom,dateTo,timezone,enabled]);
 const available = enabled && owner.tenant?.organization.id === organizationId;
 const activeScope = useRef<string | null>(null), epoch = useRef(0), controller = useRef<AbortController | null>(null), pending = useRef<number | null>(null);
 const [state,setState] = useState<ReadState>({scope:"",data:null,loading:true,error:null,restricted:false});
 const invalidate = useCallback(()=>{epoch.current++;pending.current=null;controller.current?.abort();},[]);
 useLayoutEffect(()=>{activeScope.current=scope;invalidate();return()=>{if(activeScope.current===scope){activeScope.current=null;invalidate();}};},[scope,invalidate]);
 const load = useCallback(async()=>{
  if(!available || !owns() || activeScope.current!==scope || pending.current!==null)return;
  const request=++epoch.current, abort=new AbortController();controller.current=abort;pending.current=request;
  const current=()=>owns()&&activeScope.current===scope&&epoch.current===request;
  setState({scope,data:null,loading:true,error:null,restricted:false});
  try {
   const query=new URLSearchParams({date_from:dateFrom,date_to:dateTo});
   const response=await fetch(`/api/reports/dashboard-series?${query}`,{cache:"no-store",signal:abort.signal});
   if(!current())return;
   if(response.status===401){router.replace("/login");setState({scope,data:null,loading:false,error:"Your session has expired. Sign in again to view chart history.",restricted:false});return;}
   if(response.status===403){setState({scope,data:null,loading:false,error:"Chart history is not available with your current permissions.",restricted:true});return;}
   const body:unknown=await response.json().catch(()=>null);if(!current())return;
   if(!response.ok)throw new Error("Chart history could not be loaded. Retry in a moment.");
   const data=decodeDashboardSeries(body,{organizationId,dateFrom,dateTo,timezone});
   setState({scope,data,loading:false,error:null,restricted:false});
  } catch(reason) { if(current())setState({scope,data:null,loading:false,error:reason instanceof Error?reason.message:"Chart history could not be loaded.",restricted:false}); }
  finally {if(current())pending.current=null;}
 },[available,owns,scope,dateFrom,dateTo,organizationId,timezone,router]);
 useEffect(()=>{let alive=true;queueMicrotask(()=>{if(alive)void load();});return()=>{alive=false;};},[load]);
 const visible=available&&state.scope===scope;
 return {data:visible?state.data:null,loading:enabled?(!available||!visible||state.loading):false,error:visible?state.error:null,restricted:visible&&state.restricted,retry:load};
}
