"use client";
import {useLayoutEffect,useRef,useState} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
import {useHRSettingsIdentity} from './use-hr-settings-identity';
import {useHRTimeResource,useHRTimeLifetime} from './use-hr-time-resource';
import {useDocumentNavigationGuard} from './use-document-navigation-guard';
import {timeError,record} from '@/components/hr-time/hr-time-model';
import * as M from '@/components/hr-attendance-setup/model';
export function useAttendanceSetup(){
 const identity=useHRSettingsIdentity(),path=usePathname(),query=useSearchParams(),r=M.route(path,new URLSearchParams(query.toString()));
 const scope=JSON.stringify([identity.scope,path]),enabled=identity.canView&&r.valid;
 const office=useHRTimeResource(identity.scope,'/api/hr/attendance/offices',enabled&&(r.view==='offices'||r.view==='policies'),M.offices);
 const policy=useHRTimeResource(identity.scope,'/api/hr/attendance/policies',enabled&&r.view==='policies',M.policies);
 const requests=useHRTimeResource(identity.scope,'/api/hr/attendance/requests',enabled&&identity.canManage&&r.view==='requests',M.requests);
 const employees=useHRTimeResource(identity.scope,'/api/hr/meta',enabled&&identity.canManage&&r.view==='policies'&&r.action!=='browse'&&r.action!=='detail',M.meta);
 const resource=r.view==='offices'?office:r.view==='policies'?policy:requests;
 const currentReads=()=>r.view==='offices'?office.isReady(office.receipt):r.view==='policies'?office.isReady(office.receipt)&&policy.isReady(policy.receipt)&&employees.isReady(employees.receipt):requests.isReady(requests.receipt);
 return {identity,scope,path,query,r,office,policy,requests,employees,resource,currentReads,back:M.safeReturn(query.get('returnTo')),data:{offices:office.value||[],policies:policy.value||[],requests:requests.value||[],employees:employees.value?.employees||[]}};
}
type Phase='idle'|'review'|'pending'|'rejected'|'confirmed'|'acknowledged'|'unknown';
export function useAttendanceWrite(vm:ReturnType<typeof useAttendanceSetup>){
 const {owner,current}=useHRTimeLifetime(vm.scope),pending=useRef(false),lock=useRef<Phase>('idle'),reviewed=useRef<M.Intent|null>(null),operation=useRef<object|null>(null);
 const [saved,setSaved]=useState({owner,reference:''});
 const [state,setState]=useState({owner,phase:'idle' as Phase,message:'',intent:null as M.Intent|null,dirty:false});
 useLayoutEffect(()=>{pending.current=false;lock.current='idle';reviewed.current=null;operation.current=null;return()=>{operation.current=null;pending.current=false;};},[owner]);
 const value=state.owner===owner?state:{owner,phase:'idle' as Phase,message:'',intent:null,dirty:false};const busy=value.phase==='pending',unresolved=['unknown','acknowledged'].includes(value.phase);
 useDocumentNavigationGuard(value.dirty||unresolved,{pendingRef:pending,isBusy:busy,documentLabel:'HR request',discardMessage:unresolved?'This save may already have completed. Leaving loses the in-memory lock. Do not repeat this save based on a later list. Leave?':'Discard these attendance setup changes?'});
 const canEdit=()=>current()&&vm.identity.canManage&&vm.r.valid&&vm.currentReads()&&!pending.current&&['idle','rejected'].includes(lock.current);
 const editable=vm.identity.canManage&&!busy&&['idle','rejected'].includes(value.phase)&&!vm.resource.loading&&!vm.resource.error;
 const changed=()=>{if(canEdit())setState(x=>({...x,owner,dirty:true}));};
 function review(form:HTMLFormElement){if(!canEdit())return false;const next=M.intent(vm.r,new FormData(form),vm.data);if(!next){setState(x=>({...x,owner,dirty:true,message:'Check names, finite coordinates, whole radius, seven work modes, current active office and review details.'}));return false;}const frozen=Object.freeze({...next,payload:Object.freeze({...next.payload,...(Array.isArray(next.payload.weekly_modes)?{weekly_modes:Object.freeze([...next.payload.weekly_modes])}:{})}),source:next.source?Object.freeze({...next.source}):null});reviewed.current=frozen;lock.current='review';setState({owner,phase:'review',message:'',intent:frozen,dirty:true});return true;}
 function edit(){if(!current()||!vm.identity.canManage||pending.current||lock.current!=='review')return;lock.current='idle';reviewed.current=null;setState(x=>({...x,phase:'idle',message:'',dirty:true}));}
 async function submit(){const i=value.intent;if(!current()||!vm.identity.canManage||!vm.currentReads()||pending.current||lock.current!=='review'||!i||reviewed.current!==i)return;
  const token={};operation.current=token;pending.current=true;lock.current='pending';setState(x=>({...x,owner,phase:'pending',message:'Saving once. Keep this page open until the response settles.'}));
  const belongs=()=>current()&&operation.current===token;const settle=(phase:Phase,message:string)=>{if(belongs()){lock.current=phase;setState(x=>({...x,owner,phase,message,dirty:phase!=='confirmed'}));}};
  try{const res=await fetch(i.url,{method:i.method,headers:{'Content-Type':'application/json'},body:JSON.stringify(i.payload)});if(!belongs())return;const body=await res.json().catch(()=>null);if(!belongs())return;
   if(res.ok){const match=M.receipt(body,i,res.status);if(match&&record(body))setSaved({owner,reference:String(i.kind==='policies'?body.employee_id:body.id)});settle(match?'confirmed':'acknowledged',match?'Saved. The returned receipt matches this reviewed request.':'The server acknowledged the save, but its receipt could not be matched. Do not submit again.');}
   else if(M.knownPrecommit(res.status,body,i.kind)||[401,403,404,422].includes(res.status)&&record(body)&&(typeof body.detail==='string'||res.status===422&&Array.isArray(body.detail))){reviewed.current=null;settle('rejected',timeError(body,'The server rejected this request.'));}
   else settle('unknown',timeError(body,'The save outcome is unknown.')+' Do not submit again. Check the current record separately.');
  }catch{if(belongs())settle('unknown','The save outcome is unknown. Do not submit again.');}finally{if(belongs())pending.current=false;}
 }
 return {...value,savedReference:saved.owner===owner?saved.reference:'',busy,unresolved,editable,canEdit,changed,review,edit,submit};
}
export function useAttendanceCoordinates(scope:string,canEdit:()=>boolean,onCoordinates:(lat:string,lng:string)=>void){
 const {current}=useHRTimeLifetime(scope),generation=useRef(0),active=useRef(false);const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useLayoutEffect(()=>{generation.current++;active.current=false;return()=>{active.current=false;};},[scope]);
 const cancel=()=>{generation.current++;active.current=false;setBusy(false);};
 function locate(){if(!current()||!canEdit()||active.current)return;if(!navigator.geolocation){setMessage('This browser does not support geolocation. Enter coordinates manually.');return;}
  const ticket=++generation.current;active.current=true;setBusy(true);setMessage('Requesting your location only for this office form…');const owns=()=>current()&&ticket===generation.current&&canEdit();
  try { navigator.geolocation.getCurrentPosition(p=>{if(!owns())return;active.current=false;setBusy(false);const {latitude,longitude,accuracy}=p.coords;if(!Number.isFinite(latitude)||latitude< -90||latitude>90||!Number.isFinite(longitude)||longitude< -180||longitude>180||!Number.isFinite(accuracy)||accuracy<0){setMessage('Invalid location. Enter verified coordinates manually.');return;}onCoordinates(String(latitude),String(longitude));setMessage(`Captured location, accuracy ±${Math.round(accuracy)} m. Confirm the office position before saving.`);},()=>{if(!owns())return;active.current=false;setBusy(false);setMessage('Location unavailable or permission denied. Enter coordinates manually.');},{enableHighAccuracy:true,timeout:15000,maximumAge:0}); } catch {if(owns()){active.current=false;setBusy(false);setMessage("Location access failed. Enter coordinates manually.");}}
 }
 return {locate,cancel,message,busy};
}
