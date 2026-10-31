"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";
import {useParams,usePathname,useRouter,useSearchParams} from "next/navigation";
import {useDocumentNavigationGuard} from "@/hooks/use-document-navigation-guard";
import {getApiErrorMessage} from "@/lib/api-error";
import {filterPeople,isPeopleBundle,peopleInitialValues,peoplePayload,type PeopleBundle,type PeopleValues,type PeopleBrowse,type Invitation,type InviteAction,type StructureKind} from "@/components/people/people-model";
import {peopleMode,peopleBrowseState,peopleBrowseHref,peoplePersonHref,peopleCreateHref,safePeopleReturnHref} from "@/lib/people-navigation";
import {useDashboardSession} from "@/components/dashboard-session-context";
import {useHRTimeLifetime} from "./use-hr-time-resource";
class PeopleRequestError extends Error { constructor(message:string, readonly definite=false){super(message);} }
type InviteResult={invite_token?:string;email?:string;email_sent?:boolean;expires_at?:string};
export function usePeopleWorkspace(){
 const {tenant,loading:sessionLoading}=useDashboardSession();
 const router=useRouter(),pathname=usePathname(),params=useSearchParams(),route=useParams<{personId?:string}>();
 const mode=peopleMode(pathname),personId=route.personId??"",kind:StructureKind=params.get("kind")==="designation"?"designation":"department";
 const browse=peopleBrowseState(params.toString()),returnHref=safePeopleReturnHref(params.get("returnTo")),editing=["edit","invite","structure"].includes(mode);
 const scope=JSON.stringify([tenant?.organization.id,tenant?.membership_id,tenant?.role_id,tenant?.status,tenant?.permissions,sessionLoading,pathname,kind]);
 const {owner,current}=useHRTimeLifetime(scope);
 const [outcome,setOutcome]=useState<"idle"|"unknown"|"acknowledged">("idle");
 const writeLock=useRef<"idle"|"pending"|"unknown"|"acknowledged">("idle"),operation=useRef<object|null>(null);
 const [bundle,setBundle]=useState<PeopleBundle|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
 const [values,setValues]=useState<PeopleValues>(()=>peopleInitialValues(mode,null)),[initial,setInitial]=useState<PeopleValues>(()=>peopleInitialValues(mode,null));
 const [saving,setSaving]=useState(false),[committed,setCommitted]=useState(false),[actionKey,setActionKey]=useState<string|null>(null),[inviteLink,setInviteLink]=useState<string|null>(null);
 const [queryInput,setQueryInput]=useState<{key:string;value:string}|null>(null);const browseKey=peopleBrowseHref({...browse,focus:""});
 const mounted=useRef(true),identity=useRef(0),inFlight=useRef(false),committedRef=useRef(false);
 const liveBundle=useRef<PeopleBundle|null>(null),liveValues=useRef(values),tokenGeneration=useRef(0),visibleLink=useRef(inviteLink);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;liveBundle.current=null;operation.current=null;};},[owner]);
 useLayoutEffect(()=>{liveBundle.current=loading?null:bundle;liveValues.current=values;visibleLink.current=inviteLink;},[bundle,loading,values,inviteLink,owner]);
 const clearInviteLink=useCallback(()=>{tokenGeneration.current++;visibleLink.current=null;setInviteLink(null);},[]);
 const owns=useCallback(()=>current()&&mounted.current&&!sessionLoading,[current,sessionLoading]);
 const editable=()=>owns()&&!inFlight.current&&!committedRef.current&&writeLock.current==="idle";
 const unresolved=outcome!=="idle";
 const person=bundle?.people.find(p=>p.id===personId)??null;
 const dirty=editing&&!committed&&JSON.stringify(values)!==JSON.stringify(initial);
 const navigation=useDocumentNavigationGuard(dirty||unresolved,{documentLabel:"people",pendingRef:inFlight,isBusy:saving||actionKey!==null,enabled:true,discardMessage:unresolved?"This People operation may already have completed. Leaving loses the memory-only outcome lock. Do not repeat the invitation or save without independent review.":undefined});
 const request=useCallback(async<T,>(path:string,init?:RequestInit,belongs:()=>boolean=current,ack?:()=>void):Promise<T>=>{
  if(!belongs())throw new PeopleRequestError("This workspace is no longer current.",true);
  const response=await fetch(`/api/hr${path}`,{cache:"no-store",...init});
  if(!belongs())throw new PeopleRequestError("This workspace is no longer current.",true);
  if(response.ok)ack?.();
  if(response.status===401){router.replace("/login");}
  const payload:unknown=await response.json().catch(()=>null);
  if(!belongs())throw new PeopleRequestError("This workspace is no longer current.",true);
  if(!response.ok){const body=payload&&typeof payload==="object"?payload as {detail?:unknown}:null;const definite=[400,401,403,404,409,422].includes(response.status)&&Boolean(body)&&(typeof body?.detail==="string"&&body.detail.trim().length>0||response.status===422&&Array.isArray(body?.detail)&&body.detail.length>0);throw new PeopleRequestError(getApiErrorMessage(payload,"People request failed."),definite);}
  return payload as T;
 },[router,current]);
 const load=useCallback(async(resetForm=true)=>{
  if(!owns())return false;
  const id=++identity.current;liveBundle.current=null;setLoading(true);setError(null);
  try{const next=await request<PeopleBundle>("/people",undefined,()=>current()&&mounted.current&&id===identity.current);if(!isPeopleBundle(next))throw new Error("People response could not be verified. Retry loading.");if(!current()||!mounted.current||id!==identity.current)return false;
   liveBundle.current=next;setBundle(next);if(resetForm&&writeLock.current==="idle"&&!committedRef.current){const nextValues=peopleInitialValues(mode,next.people.find(p=>p.id===personId)??null);setValues(nextValues);setInitial(nextValues);}return true;
  }catch(reason){if(current()&&mounted.current&&id===identity.current){setBundle(null);clearInviteLink();setError(reason instanceof Error?reason.message:"Unable to load People.");}return false;}
  finally{if(current()&&mounted.current&&id===identity.current)setLoading(false);}
 },[mode,personId,request,current,owns,clearInviteLink]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;};},[load]);
 useEffect(()=>{if(!loading&&browse.focus)document.getElementById(`people-person-${browse.focus}`)?.focus();},[loading,browse.focus]);
 const canSubmit=Boolean(!loading&&bundle&&(mode==="edit"?person&&bundle.capabilities.can_manage_people:mode==="invite"?bundle.capabilities.can_invite_employees&&bundle.invite_roles.length:mode==="structure"?bundle.capabilities.can_manage_structure:false));
 function change(field:string,value:string){if(!editable()||liveValues.current!==values)return;const next={...liveValues.current,[field]:value};liveValues.current=next;setValues(next);}
 function changeBrowse(next:Partial<PeopleBrowse>){if(!editable())return;tokenGeneration.current++;setQueryInput(null);clearInviteLink();router.push(peopleBrowseHref({...browse,...next,focus:""}),{scroll:false});}
 async function publishInviteLink(token:unknown){if(!owns()||typeof token!=="string"||!token.trim())return false;const generation=++tokenGeneration.current;const link=`${window.location.origin}/invite/${encodeURIComponent(token)}`;visibleLink.current=link;setInviteLink(link);try{if(!navigator.clipboard||!owns()||generation!==tokenGeneration.current)return false;await navigator.clipboard.writeText(link);return owns()&&generation===tokenGeneration.current;}catch{return false;}}
 async function copyVisibleInviteLink(){if(!owns()||!inviteLink||visibleLink.current!==inviteLink)return;const generation=tokenGeneration.current;try{if(!navigator.clipboard)throw new Error("Clipboard unavailable");await navigator.clipboard.writeText(inviteLink);if(owns()&&generation===tokenGeneration.current)setMessage("Invitation link copied.");}catch{if(owns()&&generation===tokenGeneration.current)setMessage("Clipboard permission is unavailable. Select the invitation link and copy it manually.");}}
 function markUnknown(){writeLock.current="unknown";setOutcome("unknown");setError("The response was interrupted or could not be verified. This People operation may already have completed. Do not submit or resend it again. Review records separately; a later list is not proof this operation failed.");}
 function savedHref(){return mode==="edit"?peoplePersonHref(personId,returnHref):mode==="invite"?peopleBrowseHref({...peopleBrowseState(returnHref.split("?")[1]??""),view:"invitations"}):peopleBrowseHref({...peopleBrowseState(returnHref.split("?")[1]??""),view:"structure"});}
 async function save(){
  if(!editable()||!editing||!canSubmit||!bundle||liveBundle.current!==bundle||liveValues.current!==values)return;
  let payload:ReturnType<typeof peoplePayload>;try{payload=peoplePayload(mode,values);if(mode==="invite"&&!bundle.invite_roles.some(r=>r.id===values.role_id))throw new Error("Select a role you are allowed to grant.");}catch(reason){setError(reason instanceof Error?reason.message:"Review these fields.");return;}
  const ticket={};operation.current=ticket;const belongs=()=>owns()&&operation.current===ticket;
  inFlight.current=true;writeLock.current="pending";setSaving(true);setError(null);setMessage(null);clearInviteLink();
  try{
   const path=mode==="edit"?`/people/${encodeURIComponent(personId)}`:mode==="invite"?"/people/invitations/send":`/people/${kind==="department"?"departments":"designations"}`;
   const result=await request<InviteResult>(path,{method:mode==="edit"?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)},belongs,()=>{committedRef.current=true;writeLock.current="acknowledged";});
   if(!belongs())return;setCommitted(true);inFlight.current=false;setSaving(false);navigation.markClean();
   if(mode==="invite"){
    if(result?.email_sent===true)setMessage(`Invitation email sent to ${result.email??values.email}.`);
    else{const copied=await publishInviteLink(result?.invite_token);if(!belongs())return;setMessage(typeof result?.invite_token==="string"&&result.invite_token.trim()?`Invitation created, but email could not be sent. ${copied?"A fresh invitation link was copied.":"Use the invitation link below."}`:"Invitation was created, but delivery details were unavailable. Check Invitations before taking another action; do not submit again.");}
   }else{setMessage(mode==="edit"?"Employee profile updated.":`${kind==="department"?"Department":"Designation"} created.`);navigation.navigate(savedHref(),{discard:true,replace:true});}
  }catch(reason){if(!belongs())return;if(!committedRef.current&&!(reason instanceof PeopleRequestError&&reason.definite)){markUnknown();return;}if(!committedRef.current)writeLock.current="idle";setError(committedRef.current?"This change was saved. Open the saved result below; do not submit it again.":reason instanceof Error?reason.message:"Unable to save. If the connection was interrupted, check the saved record before retrying.");}
  finally{if(belongs()){inFlight.current=false;setSaving(false);}}
 }
 async function inviteAction(row:Invitation,action:InviteAction){
  if(!editable()||!bundle?.capabilities.can_invite_employees||liveBundle.current!==bundle||!bundle.invitations.some(i=>i.id===row.id))return;
  if(action==="revoke"&&!window.confirm(`Revoke the invitation for ${row.email}? The current invite link will stop working.`))return;
  const ticket={};operation.current=ticket;const belongs=()=>owns()&&operation.current===ticket;
  inFlight.current=true;writeLock.current="pending";setActionKey(`${row.id}:${action}`);setError(null);setMessage(null);clearInviteLink();let written=false;
  try{
   const result=await request<InviteResult>(`/people/invitations/${encodeURIComponent(row.id)}/${action==="copy"?"link":action}`,{method:"POST"},belongs,()=>{written=true;writeLock.current="acknowledged";});if(!belongs())return;
   if(action==="revoke")setMessage(`Invitation revoked for ${row.email}.`);
   else if(action==="resend"&&result?.email_sent===true)setMessage(`Invitation email resent to ${row.email}. A new 7-day link is active.`);
   else{const copied=await publishInviteLink(result?.invite_token);if(!belongs())return;setMessage(typeof result?.invite_token==="string"&&result.invite_token.trim()?`${action==="resend"?"Email could not be sent. ":""}Fresh invitation link ${copied?"copied":"ready below"} for ${row.email}.`:"Invitation was updated, but link details were unavailable. Refresh Invitations before taking another action.");}
   // Readback is separate: a failed GET must not invite repetition of a committed email/token mutation.
   const refreshed=await load(false);if(!belongs())return;if(refreshed){writeLock.current="idle";setOutcome("idle");}else{setOutcome("acknowledged");setError("The invitation action completed, but the directory could not be refreshed. Retry loading; do not repeat the action.");}
  }catch(reason){if(!belongs())return;if(!written&&!(reason instanceof PeopleRequestError&&reason.definite)){markUnknown();return;}writeLock.current=written?"acknowledged":"idle";if(written)setOutcome("acknowledged");setError(written?"The invitation action completed. Reload the directory to verify its latest state before another action.":reason instanceof Error?reason.message:"Invitation action failed. Check its latest state before retrying after an interrupted response.");}
  finally{if(belongs()){inFlight.current=false;setActionKey(null);}}
 }
 function back(){if(!owns())return;navigation.navigate(mode==="edit"?peoplePersonHref(personId,returnHref):returnHref);}
 return {unresolved,outcome,bundle,loading,error,message,person,mode,kind,returnHref,browse,rows:filterPeople(bundle?.people??[],browse.search),queryDraft:queryInput?.key===browseKey?queryInput.value:browse.search,setQueryDraft:(value:string)=>{if(editable())setQueryInput({key:browseKey,value});},changeBrowse,load,values,change,saving,dirty,committed,canSubmit,save,back,openPerson:(id:string)=>{if(editable())router.push(peoplePersonHref(id,peopleBrowseHref({...browse,focus:id})));},openEdit:()=>editable()&&navigation.navigate(peoplePersonHref(personId,returnHref,true)),openCreate:(kind:"invite"|StructureKind)=>editable()&&navigation.navigate(peopleCreateHref(kind,peopleBrowseHref(browse))),inviteAction,actionKey,inviteLink,copyVisibleInviteLink,dismissInviteLink:()=>{if(owns()){tokenGeneration.current++;clearInviteLink();}},openSaved:()=>owns()&&navigation.navigate(savedHref(),{discard:true,replace:true})};
}
export type PeopleWorkspaceState=ReturnType<typeof usePeopleWorkspace>;
