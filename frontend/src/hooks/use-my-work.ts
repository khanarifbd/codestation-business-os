"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useParams,usePathname,useRouter,useSearchParams} from "next/navigation";
import {useDocumentNavigationGuard} from "@/hooks/use-document-navigation-guard";
import {getApiErrorMessage} from "@/lib/api-error";
import {filterWorkTasks,isPersonalWorkspace,isPersonalTaskDetail,workInitialValues,workIsLocked,workUpdatePayload,type PersonalWorkspace,type PersonalTaskDetail,type WorkUpdateValues,type WorkBrowse} from "@/components/my-work/my-work-model";
import {workBrowseState,workBrowseHref,workTaskHref,workUpdateHref,safeWorkReturnHref} from "@/lib/my-work-navigation";
function useWorkRequest(){const router=useRouter();return useCallback(async<T,>(path:string,init?:RequestInit):Promise<T>=>{const response=await fetch(path,{cache:"no-store",...init});if(response.status===401){router.replace("/login");throw new Error("Authentication required");}const payload:unknown=await response.json().catch(()=>null);if(!response.ok)throw new Error(getApiErrorMessage(payload,"Unable to load your work."));return payload as T;},[router]);}
export function useMyWorkRegister(){
 const request=useWorkRequest(),router=useRouter(),params=useSearchParams(),browse=workBrowseState(params.toString());
 const [data,setData]=useState<PersonalWorkspace|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
 const [queryInput,setQueryInput]=useState<{key:string;value:string}|null>(null);const key=workBrowseHref({...browse,focus:""});
 const identity=useRef(0),mounted=useRef(true);const invalidate=useCallback(()=>{identity.current+=1;},[]);
 const load=useCallback(async()=>{const id=++identity.current;setLoading(true);setError(null);try{const next=await request<PersonalWorkspace>("/api/workspace/me");if(!isPersonalWorkspace(next))throw new Error("Your work response could not be verified. Retry loading.");if(mounted.current&&id===identity.current)setData(next);}catch(reason){if(mounted.current&&id===identity.current){setData(null);setError(reason instanceof Error?reason.message:"Unable to load your work.");}}finally{if(mounted.current&&id===identity.current)setLoading(false);}},[request]);
 useEffect(()=>{mounted.current=true;let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;mounted.current=false;invalidate();};},[load,invalidate]);
 const tasks=filterWorkTasks(data?.tasks??[],browse);
 useEffect(()=>{if(!loading&&browse.focus)document.getElementById(`work-task-${browse.focus}`)?.focus();},[loading,browse.focus]);
 function changeBrowse(next:Partial<WorkBrowse>){setQueryInput(null);router.push(workBrowseHref({...browse,...next,focus:""}),{scroll:false});}
 return {data,loading,error,browse,tasks,queryDraft:queryInput?.key===key?queryInput.value:browse.search,setQueryDraft:(value:string)=>setQueryInput({key,value}),load,changeBrowse,reset:()=>{setQueryInput(null);router.push(workBrowseHref(),{scroll:false});},openTask:(id:string)=>router.push(workTaskHref(id,workBrowseHref({...browse,focus:id})))};
}
export function useMyWorkTask(){
 const request=useWorkRequest(),params=useSearchParams(),route=useParams<{taskId:string}>(),pathname=usePathname();
 const taskId=route.taskId,editing=pathname.endsWith("/update"),returnHref=safeWorkReturnHref(params.get("returnTo"));
 const [detail,setDetail]=useState<PersonalTaskDetail|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[saving,setSaving]=useState(false),[values,setValues]=useState<WorkUpdateValues>(workInitialValues(null)),[committed,setCommitted]=useState(false),[savedStatus,setSavedStatus]=useState<string|null>(null);
 const identity=useRef(0),mounted=useRef(true),inFlight=useRef(false),committedRef=useRef(false);const invalidate=useCallback(()=>{identity.current+=1;},[]);
 const locked=workIsLocked(detail),dirty=editing&&!committed&&detail!==null&&JSON.stringify(values)!==JSON.stringify(workInitialValues(detail));
 const navigation=useDocumentNavigationGuard(dirty,{documentLabel:"work update",isBusy:saving,enabled:editing});
 const load=useCallback(async()=>{const id=++identity.current;setLoading(true);setError(null);setDetail(null);try{const next=await request<PersonalTaskDetail>(`/api/workspace/tasks/${encodeURIComponent(taskId)}`);if(!mounted.current||id!==identity.current)return;if(!isPersonalTaskDetail(next)||next.task.id!==taskId)throw new Error("Task identity or response could not be verified.");setDetail(next);setValues(workInitialValues(next));}catch(reason){if(mounted.current&&id===identity.current){setDetail(null);setError(reason instanceof Error?reason.message:"Unable to load this task.");}}finally{if(mounted.current&&id===identity.current)setLoading(false);}},[request,taskId]);
 useEffect(()=>{mounted.current=true;let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;mounted.current=false;invalidate();};},[load,invalidate]);
 function change<K extends keyof WorkUpdateValues>(field:K,value:WorkUpdateValues[K]){if(inFlight.current||committedRef.current)return;setValues(old=>{const next={...old,[field]:value};if(field==="progress"){if(Number(value)===100)next.status="completed";else if(old.status==="completed")next.status="in_progress";}if(field==="status"&&value==="completed")next.progress="100";return next;});}
 function savedDestination(status:string|null){return status==="completed"?returnHref:workTaskHref(taskId,returnHref);}
 async function save(){
  if(!editing||!detail||detail.task.id!==taskId||locked||inFlight.current||committedRef.current)return;
  let payload:ReturnType<typeof workUpdatePayload>;try{payload=workUpdatePayload(values);}catch(reason){setError(reason instanceof Error?reason.message:"Review your update.");return;}
  inFlight.current=true;setSaving(true);setError(null);
  try{const result=await request<{status:string}>(`/api/projects/${encodeURIComponent(detail.task.project_id)}/tasks/${encodeURIComponent(taskId)}/progress`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   committedRef.current=true;if(!mounted.current)return;setCommitted(true);setSavedStatus(result?.status??payload.status);navigation.markClean();navigation.navigate(savedDestination(result?.status??payload.status),{discard:true,replace:true});
  }catch(reason){if(mounted.current)setError(committedRef.current?"Your update was saved. Open the saved result below; do not submit the work log again.":reason instanceof Error?reason.message:"Unable to save this update. Verify the task before retrying if the connection was interrupted.");}
  finally{inFlight.current=false;if(mounted.current)setSaving(false);}
 }
 function back(){if(editing)navigation.navigate(workTaskHref(taskId,returnHref));else window.location.assign(returnHref);}
 return {taskId,editing,returnHref,detail,loading,error,saving,locked,values,dirty,committed,change,save,load,back,openUpdate:()=>{if(!locked)window.location.assign(workUpdateHref(taskId,returnHref));},openSaved:()=>navigation.navigate(savedDestination(savedStatus),{discard:true,replace:true})};
}
export type MyWorkRegisterState=ReturnType<typeof useMyWorkRegister>;
export type MyWorkTaskState=ReturnType<typeof useMyWorkTask>;
