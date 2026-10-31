"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "@/lib/api-error";
import { useAdministrationReadOwner } from "./use-administration-read-owner";
export type NotificationItem={id:string;kind:string;severity:string;title:string;message:string;href:string;due_date:string|null};
const item=(v:unknown):v is NotificationItem=>Boolean(v)&&typeof v==="object"&&!Array.isArray(v)&&["id","kind","severity","title","message","href"].every(k=>typeof (v as Record<string,unknown>)[k]==="string")&&["task_due","task_overdue"].includes((v as NotificationItem).kind)&&/^\/dashboard\/my-work\?task=[a-zA-Z0-9-]+$/.test((v as NotificationItem).href)&&((v as NotificationItem).due_date===null||/^\d{4}-\d{2}-\d{2}$/.test((v as NotificationItem).due_date!));
export function useNotificationRead(){const owner=useAdministrationReadOwner(),epoch=useRef(0);const owns=owner.current;const[items,setItems]=useState<NotificationItem[]>([]),[loading,setLoading]=useState(true),[verified,setVerified]=useState(false),[error,setError]=useState<string|null>(null);
 const load=useCallback(async()=>{if(!owns())return;const request=++epoch.current,active=()=>owns()&&request===epoch.current;setLoading(true);setError(null);
  try{const response=await fetch("/api/workspace/notifications",{cache:"no-store"});if(!active())return;const body:unknown=await response.json().catch(()=>null);if(!active())return;if(!response.ok)throw Error(getApiErrorMessage(body,"Unable to load notifications."));
   if(!body||typeof body!=="object"||!("items" in body)||!Array.isArray(body.items)||!body.items.every(item))throw Error("Notifications could not be verified. Retry reading alerts.");setItems(body.items);setVerified(true);
  }catch(reason){if(active())setError(reason instanceof Error?reason.message:"Unable to load notifications.");}finally{if(active())setLoading(false);}
 },[owns]);useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;};},[load]);return{...owner,items,loading,verified,error,load};}
