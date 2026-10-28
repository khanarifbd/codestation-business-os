"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useParams,usePathname,useRouter,useSearchParams} from "next/navigation";
import {useDocumentNavigationGuard} from "@/hooks/use-document-navigation-guard";
import {getApiErrorMessage} from "@/lib/api-error";
import {filterPeople,isPeopleBundle,peopleInitialValues,peoplePayload,type PeopleBundle,type PeopleValues,type PeopleBrowse,type Invitation,type InviteAction,type StructureKind} from "@/components/people/people-model";
import {peopleMode,peopleBrowseState,peopleBrowseHref,peoplePersonHref,peopleCreateHref,safePeopleReturnHref} from "@/lib/people-navigation";
type InviteResult={invite_token?:string;email?:string;email_sent?:boolean;expires_at?:string};
export function usePeopleWorkspace(){
 const router=useRouter(),pathname=usePathname(),params=useSearchParams(),route=useParams<{personId?:string}>();
 const mode=peopleMode(pathname),personId=route.personId??"",kind:StructureKind=params.get("kind")==="designation"?"designation":"department";
 const browse=peopleBrowseState(params.toString()),returnHref=safePeopleReturnHref(params.get("returnTo")),editing=["edit","invite","structure"].includes(mode);
 const [bundle,setBundle]=useState<PeopleBundle|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
 const [values,setValues]=useState<PeopleValues>(()=>peopleInitialValues(mode,null)),[initial,setInitial]=useState<PeopleValues>(()=>peopleInitialValues(mode,null));
 const [saving,setSaving]=useState(false),[committed,setCommitted]=useState(false),[actionKey,setActionKey]=useState<string|null>(null),[inviteLink,setInviteLink]=useState<string|null>(null);
 const [queryInput,setQueryInput]=useState<{key:string;value:string}|null>(null);const browseKey=peopleBrowseHref({...browse,focus:""});
 const mounted=useRef(true),identity=useRef(0),inFlight=useRef(false),committedRef=useRef(false);
 const person=bundle?.people.find(p=>p.id===personId)??null;
 const dirty=editing&&!committed&&JSON.stringify(values)!==JSON.stringify(initial);
 const navigation=useDocumentNavigationGuard(dirty,{documentLabel:"people",isBusy:saving||actionKey!==null,enabled:true});
 const request=useCallback(async<T,>(path:string,init?:RequestInit):Promise<T>=>{const response=await fetch(`/api/hr${path}`,{cache:"no-store",...init});if(response.status===401){router.replace("/login");throw new Error("Authentication required");}const payload:unknown=await response.json().catch(()=>null);if(!response.ok)throw new Error(getApiErrorMessage(payload,"People request failed."));return payload as T;},[router]);
 const load=useCallback(async(resetForm=true)=>{
  const id=++identity.current;setLoading(true);setError(null);
  try{const next=await request<PeopleBundle>("/people");if(!isPeopleBundle(next))throw new Error("People response could not be verified. Retry loading.");if(!mounted.current||id!==identity.current)return false;
   setBundle(next);if(resetForm){const nextValues=peopleInitialValues(mode,next.people.find(p=>p.id===personId)??null);setValues(nextValues);setInitial(nextValues);}return true;
  }catch(reason){if(mounted.current&&id===identity.current){setBundle(null);setInviteLink(null);setError(reason instanceof Error?reason.message:"Unable to load People.");}return false;}
  finally{if(mounted.current&&id===identity.current)setLoading(false);}
 },[mode,personId,request,setInviteLink]);
 useEffect(()=>{mounted.current=true;let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;mounted.current=false;identity.current+=1;};},[load]);
 useEffect(()=>{if(!loading&&browse.focus)document.getElementById(`people-person-${browse.focus}`)?.focus();},[loading,browse.focus]);
 const canSubmit=Boolean(bundle&&(mode==="edit"?person&&bundle.capabilities.can_manage_people:mode==="invite"?bundle.capabilities.can_invite_employees&&bundle.invite_roles.length:mode==="structure"?bundle.capabilities.can_manage_structure:false));
 function change(field:string,value:string){if(inFlight.current||committedRef.current)return;setValues(old=>({...old,[field]:value}));}
 function changeBrowse(next:Partial<PeopleBrowse>){if(inFlight.current)return;setQueryInput(null);setInviteLink(null);router.push(peopleBrowseHref({...browse,...next,focus:""}),{scroll:false});}
 async function publishInviteLink(token:unknown){if(typeof token!=="string"||!token.trim())return false;const link=`${window.location.origin}/invite/${encodeURIComponent(token)}`;if(!mounted.current)return false;setInviteLink(link);try{if(!navigator.clipboard)return false;await navigator.clipboard.writeText(link);return true;}catch{return false;}}
 async function copyVisibleInviteLink(){if(!inviteLink)return;try{if(!navigator.clipboard)throw new Error("Clipboard unavailable");await navigator.clipboard.writeText(inviteLink);if(mounted.current)setMessage("Invitation link copied.");}catch{if(mounted.current)setMessage("Clipboard permission is unavailable. Select the invitation link and copy it manually.");}}
 function savedHref(){return mode==="edit"?peoplePersonHref(personId,returnHref):mode==="invite"?peopleBrowseHref({...peopleBrowseState(returnHref.split("?")[1]??""),view:"invitations"}):peopleBrowseHref({...peopleBrowseState(returnHref.split("?")[1]??""),view:"structure"});}
 async function save(){
  if(!editing||!canSubmit||!bundle||inFlight.current||committedRef.current)return;
  let payload:ReturnType<typeof peoplePayload>;try{payload=peoplePayload(mode,values);if(mode==="invite"&&!bundle.invite_roles.some(r=>r.id===values.role_id))throw new Error("Select a role you are allowed to grant.");}catch(reason){setError(reason instanceof Error?reason.message:"Review these fields.");return;}
  inFlight.current=true;setSaving(true);setError(null);setMessage(null);setInviteLink(null);
  try{
   const path=mode==="edit"?`/people/${encodeURIComponent(personId)}`:mode==="invite"?"/people/invitations/send":`/people/${kind==="department"?"departments":"designations"}`;
   const result=await request<InviteResult>(path,{method:mode==="edit"?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   committedRef.current=true;if(!mounted.current)return;setCommitted(true);navigation.markClean();
   if(mode==="invite"){
    if(result?.email_sent===true)setMessage(`Invitation email sent to ${result.email??values.email}.`);
    else{const copied=await publishInviteLink(result?.invite_token);if(!mounted.current)return;setMessage(typeof result?.invite_token==="string"&&result.invite_token.trim()?`Invitation created, but email could not be sent. ${copied?"A fresh invitation link was copied.":"Use the invitation link below."}`:"Invitation was created, but delivery details were unavailable. Check Invitations before taking another action; do not submit again.");}
   }else{setMessage(mode==="edit"?"Employee profile updated.":`${kind==="department"?"Department":"Designation"} created.`);navigation.navigate(savedHref(),{discard:true,replace:true});}
  }catch(reason){if(mounted.current)setError(committedRef.current?"This change was saved. Open the saved result below; do not submit it again.":reason instanceof Error?reason.message:"Unable to save. If the connection was interrupted, check the saved record before retrying.");}
  finally{inFlight.current=false;if(mounted.current)setSaving(false);}
 }
 async function inviteAction(row:Invitation,action:InviteAction){
  if(!bundle?.capabilities.can_invite_employees||!bundle.invitations.some(i=>i.id===row.id)||inFlight.current)return;
  if(action==="revoke"&&!window.confirm(`Revoke the invitation for ${row.email}? The current invite link will stop working.`))return;
  inFlight.current=true;setActionKey(`${row.id}:${action}`);setError(null);setMessage(null);setInviteLink(null);let written=false;
  try{
   const result=await request<InviteResult>(`/people/invitations/${encodeURIComponent(row.id)}/${action==="copy"?"link":action}`,{method:"POST"});written=true;if(!mounted.current)return;
   if(action==="revoke")setMessage(`Invitation revoked for ${row.email}.`);
   else if(action==="resend"&&result?.email_sent===true)setMessage(`Invitation email resent to ${row.email}. A new 7-day link is active.`);
   else{const copied=await publishInviteLink(result?.invite_token);if(!mounted.current)return;setMessage(typeof result?.invite_token==="string"&&result.invite_token.trim()?`${action==="resend"?"Email could not be sent. ":""}Fresh invitation link ${copied?"copied":"ready below"} for ${row.email}.`:"Invitation was updated, but link details were unavailable. Refresh Invitations before taking another action.");}
   // Readback is separate: a failed GET must not invite repetition of a committed email/token mutation.
   const refreshed=await load(false);if(!refreshed&&mounted.current)setError("The invitation action completed, but the directory could not be refreshed. Retry loading; do not repeat the action.");
  }catch(reason){if(mounted.current)setError(written?"The invitation action completed. Reload the directory to verify its latest state before another action.":reason instanceof Error?reason.message:"Invitation action failed. Check its latest state before retrying after an interrupted response.");}
  finally{inFlight.current=false;if(mounted.current)setActionKey(null);}
 }
 function back(){navigation.navigate(mode==="edit"?peoplePersonHref(personId,returnHref):returnHref);}
 return {bundle,loading,error,message,person,mode,kind,returnHref,browse,rows:filterPeople(bundle?.people??[],browse.search),queryDraft:queryInput?.key===browseKey?queryInput.value:browse.search,setQueryDraft:(value:string)=>setQueryInput({key:browseKey,value}),changeBrowse,load,values,change,saving,dirty,committed,canSubmit,save,back,openPerson:(id:string)=>{if(!inFlight.current)router.push(peoplePersonHref(id,peopleBrowseHref({...browse,focus:id})));},openEdit:()=>navigation.navigate(peoplePersonHref(personId,returnHref,true)),openCreate:(kind:"invite"|StructureKind)=>navigation.navigate(peopleCreateHref(kind,peopleBrowseHref(browse))),inviteAction,actionKey,inviteLink,copyVisibleInviteLink,dismissInviteLink:()=>setInviteLink(null),openSaved:()=>navigation.navigate(savedHref(),{discard:true,replace:true})};
}
export type PeopleWorkspaceState=ReturnType<typeof usePeopleWorkspace>;
