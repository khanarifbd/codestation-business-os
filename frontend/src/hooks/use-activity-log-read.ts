"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiErrorMessage } from "@/lib/api-error";
import { useAdministrationReadOwner } from "./use-administration-read-owner";
export type ActivityItem = { id:string; actor_user_id:string|null; actor_type:string; action:string; entity_type:string|null; entity_id:string|null; outcome:string; message:string|null; created_at:string };
export type ActivityDetail = ActivityItem & { organization_id:string|null; scope:string; request_id:string|null; ip_address:string|null; user_agent:string|null; http_method:string|null; request_path:string|null; before_data:Record<string,unknown>|null; after_data:Record<string,unknown>|null; metadata_json:Record<string,unknown>|null };
export type Filters={action:string;entityType:string;outcome:string;dateFrom:string;dateTo:string};
export const emptyActivityFilters:Filters={action:"",entityType:"",outcome:"",dateFrom:"",dateTo:""};
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==="object"&&!Array.isArray(v);
const nullableText=(v:unknown)=>v===null||typeof v==="string";
const item=(v:unknown):v is ActivityItem=>record(v)&&["id","actor_type","action","outcome","created_at"].every(k=>typeof v[k]==="string")&&Boolean(v.id)&&Number.isFinite(Date.parse(String(v.created_at)))&&["actor_user_id","entity_type","entity_id","message"].every(k=>nullableText(v[k]));
export function useActivityLogRead() {
  const owner=useAdministrationReadOwner(),router=useRouter(),epoch=useRef(0),detailEpoch=useRef(0),listPending=useRef(false),pendingCursor=useRef<string|null>(null),filterRef=useRef<Filters>(emptyActivityFilters);
  const owns=owner.current;
  const [items,setItems]=useState<ActivityItem[]>([]),[nextCursor,setNextCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[loadingMore,setLoadingMore]=useState(false),[verified,setVerified]=useState(false),[error,setError]=useState<string|null>(null);
  const [draft,setDraft]=useState<Filters>(emptyActivityFilters),[selected,setSelected]=useState<ActivityDetail|null>(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState<string|null>(null),[detailId,setDetailId]=useState<string|null>(null),[detailVersion,setDetailVersion]=useState(0);
  const [renderedEpoch,setRenderedEpoch]=useState(0);
  const load=useCallback(async(cursor?:string,append=false,filters=filterRef.current)=>{
    if(!owns()||append&&(!cursor||pendingCursor.current!==null))return;
    const request=++epoch.current,active=()=>owns()&&request===epoch.current;
    setRenderedEpoch(request);listPending.current=true;
    if(append){pendingCursor.current=cursor!;setLoadingMore(true);}else{pendingCursor.current=null;setLoading(true);setVerified(false);filterRef.current=filters;detailEpoch.current++;setDetailId(null);setSelected(null);setDetailLoading(false);}
    setError(null);const query=new URLSearchParams({limit:"50"});if(cursor)query.set("cursor",cursor);
    for(const[k,v]of Object.entries({action:filters.action,entity_type:filters.entityType,outcome:filters.outcome,date_from:filters.dateFrom,date_to:filters.dateTo}))if(v)query.set(k,v);
    try{const response=await fetch(`/api/tenant/activity-logs?${query}`,{cache:"no-store"});if(!active())return;
      if(response.status===401||response.status===403){router.replace(response.status===401?"/login":"/dashboard");return;}
      const body:unknown=await response.json().catch(()=>null);if(!active())return;if(!response.ok)throw Error(getApiErrorMessage(body,"Unable to load activity logs."));
      if(!record(body)||!Array.isArray(body.items)||!body.items.every(item)||!nullableText(body.next_cursor))throw Error("Activity response could not be verified. Retry reading records.");
      const rows=body.items as ActivityItem[];setItems(old=>append?[...old,...rows.filter(row=>!old.some(x=>x.id===row.id))]:rows);setNextCursor(body.next_cursor as string|null);setVerified(true);
    }catch(reason){if(active())setError(reason instanceof Error?reason.message:"Unable to load activity logs.");}finally{if(active()){listPending.current=false;pendingCursor.current=null;setLoading(false);setLoadingMore(false);}}
  },[owns,router]);
  useEffect(()=>{void load(undefined,false,emptyActivityFilters);},[load]);
  async function openDetail(id:string){if(!owns()||listPending.current||renderedEpoch!==epoch.current||!verified||!items.some(x=>x.id===id))return;const request=++detailEpoch.current,active=()=>owns()&&request===detailEpoch.current;setDetailVersion(request);setDetailId(id);setSelected(null);setDetailLoading(true);setDetailError(null);
    try{const response=await fetch(`/api/tenant/activity-logs/${encodeURIComponent(id)}`,{cache:"no-store"});if(!active())return;if(response.status===401||response.status===403){router.replace(response.status===401?"/login":"/dashboard");return;}
      const body:unknown=await response.json().catch(()=>null);if(!active())return;if(!response.ok)throw Error(getApiErrorMessage(body,"Unable to load activity detail."));
      if(!record(body)||body.organization_id!==owner.tenant?.organization.id||typeof body.scope!=="string"||!["request_id","ip_address","user_agent","http_method","request_path"].every(k=>nullableText(body[k]))||!["before_data","after_data","metadata_json"].every(k=>body[k]===null||record(body[k]))||!item(body)||body.id!==id)throw Error("Activity detail could not be verified.");setSelected(body as ActivityDetail);
    }catch(reason){if(active())setDetailError(reason instanceof Error?reason.message:"Unable to load activity detail.");}finally{if(active())setDetailLoading(false);}}
  function closeDetail(){if(!owns()||detailVersion!==detailEpoch.current)return;detailEpoch.current++;setDetailId(null);setSelected(null);setDetailLoading(false);setDetailError(null);}
  return{...owner,items,nextCursor,loading,loadingMore,verified,error,draft,selected,detailLoading,detailError,detailId,detailVersion,load,openDetail,closeDetail,
    setDraft:(next:Filters|((previous:Filters)=>Filters))=>{if(owns())setDraft(next);},
    applyFilters:(event:{preventDefault:()=>void})=>{event.preventDefault();if(owns())void load(undefined,false,draft);},
    resetFilters:()=>{if(owns()){setDraft(emptyActivityFilters);void load(undefined,false,emptyActivityFilters);}},
    loadMore:()=>{if(owns()&&!listPending.current&&renderedEpoch===epoch.current&&verified&&nextCursor)void load(nextCursor,true);}};
}
