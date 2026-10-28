import {record,timeId,dateOnly} from '@/components/hr-time/hr-time-model';
export const ROOT='/dashboard/hr/settings/attendance';
export const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const MODES=['office','remote','field','off'] as const;
export type Mode=typeof MODES[number];
export type Office={id:string;name:string;latitude:number;longitude:number;radius_meters:number;is_active:boolean};
export type Policy={employee_id:string;employee_name:string;employee_code:string;office_id:string|null;weekly_modes:Mode[]};
export type RequestRow={id:string;employee_id:string;employee_name?:string;employee_code?:string;work_date:string;request_type:'mode'|'correction';requested_mode:string|null;reason:string;proposed_check_in_at:string|null;proposed_check_out_at:string|null;status:'pending'|'approved'|'rejected';review_notes:string|null;created_at:string};
export type Employee={id:string;name:string;employee_code:string};
export type View='offices'|'policies'|'requests';
export type Route={view:View;id:string;action:'browse'|'detail'|'create'|'edit'|'review';valid:boolean};
const text=(v:unknown):v is string=>typeof v==='string'&&!/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(v);
const note=(v:unknown):v is string=>typeof v==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(v);
export const id=(v:unknown):v is string=>timeId(v)&&v!=='new'&&/^[A-Za-z0-9_-]+$/.test(v);
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const validDate=(v:unknown):v is string=>dateOnly(v)&&!v.startsWith('0000-');
const timestamp=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)&&validDate(v.slice(0,10))&&Number.isFinite(Date.parse(v));
export function office(v:unknown):v is Office{return record(v)&&id(v.id)&&text(v.name)&&v.name.length>=2&&v.name.length<=120&&finite(v.latitude,-90,90)&&finite(v.longitude,-180,180)&&finite(v.radius_meters,25,1000)&&Number.isInteger(v.radius_meters)&&typeof v.is_active==='boolean';}
export function modes(v:unknown):v is Mode[]{return Array.isArray(v)&&v.length===7&&v.every(x=>MODES.includes(x));}
export function policy(v:unknown):v is Policy{return record(v)&&id(v.employee_id)&&text(v.employee_name)&&text(v.employee_code)&&(v.office_id===null||id(v.office_id))&&modes(v.weekly_modes);}
// Full request validation deliberately distinguishes unknown/malformed data from an empty list.
export function request(v:unknown):v is RequestRow{return record(v)&&id(v.id)&&id(v.employee_id)&&validDate(v.work_date)&&(v.request_type==='mode'||v.request_type==='correction')&&(v.requested_mode===null||text(v.requested_mode))&&note(v.reason)&&(v.proposed_check_in_at===null||timestamp(v.proposed_check_in_at))&&(v.proposed_check_out_at===null||timestamp(v.proposed_check_out_at))&&typeof v.status==='string'&&['pending','approved','rejected'].includes(v.status)&&(v.review_notes===null||note(v.review_notes))&&timestamp(v.created_at)&&(v.employee_name===undefined||text(v.employee_name))&&(v.employee_code===undefined||text(v.employee_code));}
function unique<T>(v:unknown,check:(x:unknown)=>x is T,key:(x:T)=>string,cap=Infinity):v is T[]{return Array.isArray(v)&&v.length<=cap&&v.every(check)&&new Set(v.map(key)).size===v.length;}
export const offices=(v:unknown):v is Office[]=>unique(v,office,x=>x.id);
export const policies=(v:unknown):v is Policy[]=>unique(v,policy,x=>x.employee_id);
export const requests=(v:unknown):v is RequestRow[]=>unique(v,request,x=>x.id,100);
export function meta(v:unknown):v is {employees:Employee[]}{return record(v)&&unique(v.employees,(x):x is Employee=>record(x)&&id(x.id)&&text(x.name)&&text(x.employee_code),x=>x.id);}
export function browse(raw:string|URLSearchParams){const q=new URLSearchParams(raw);return {view:(q.getAll('view').length===1&&['offices','policies','requests'].includes(q.get('view')!))?q.get('view') as View:'offices' as View,search:q.getAll('search').length===1?q.get('search')!.slice(0,300):''};}
export function href(view:View='offices',search=''){const q=new URLSearchParams();if(view!=='offices')q.set('view',view);if(search)q.set('search',search.slice(0,300));return ROOT+(q.size?'?'+q:'');}
export function safeReturn(raw:string|null){if(!raw||!(raw===ROOT||raw.startsWith(ROOT+'?'))||raw.includes('#'))return ROOT;const b=browse(raw.split('?')[1]||'');return href(b.view,b.search);}
export function route(path:string,query:URLSearchParams):Route{const fallback:Route={view:'offices',id:'',action:'browse',valid:false};if(path===ROOT)return {...fallback,view:browse(query).view,valid:true};if(!path.startsWith(ROOT+'/'))return fallback;const parts=path.slice(ROOT.length+1).split('/');const view=parts[0] as View;if(!['offices','policies','requests'].includes(view)||parts.length<2||parts.length>3)return fallback;if(parts[1]==='new'&&parts.length===2&&view!=='requests')return {view,id:'',action:'create',valid:true};if(!id(parts[1]))return fallback;const action=parts.length===2?'detail':parts[2]==='edit'&&view!=='requests'?'edit':parts[2]==='review'&&view==='requests'?'review':null;return action?{view,id:parts[1],action,valid:true}:fallback;}
export function itemHref(view:View,target:string,action='',back=href(view)){return `${ROOT}/${view}/${encodeURIComponent(target)}${action?'/'+action:''}?${new URLSearchParams({returnTo:safeReturn(back)})}`;}
export type Intent={kind:View;target:string;method:'POST'|'PATCH'|'PUT';url:string;payload:Record<string,unknown>;label:string;source:Office|Policy|RequestRow|null};
export function intent(r:Route,f:FormData,data:{offices:Office[];policies:Policy[];requests:RequestRow[];employees:Employee[]}):Intent|null {
 if(!r.valid)return null;
 const str=(k:string)=>typeof f.get(k)==='string'?String(f.get(k)).trim():'';
 if(r.view==='offices'&&['create','edit'].includes(r.action)){
  const old=r.action==='edit'?data.offices.find(x=>x.id===r.id):null;if(r.action==='edit'&&!old)return null;
  const name=str('name'),lat=str('latitude'),lng=str('longitude'),radius=str('radius_meters');
  const payload={name,latitude:Number(lat),longitude:Number(lng),radius_meters:Number(radius),is_active:f.get('is_active')==='on'};
  if(!lat||!lng||!radius||!office({id:'validation',...payload}))return null;
  return {kind:r.view,target:old?.id||'',method:old?'PATCH':'POST',url:'/api/hr/attendance/offices'+(old?'/'+encodeURIComponent(old.id):''),payload,label:name,source:old||null};
 }
 if(r.view==='policies'&&['create','edit'].includes(r.action)){
  const employeeId=r.action==='edit'?r.id:str('employee_id'),employee=data.employees.find(x=>x.id===employeeId);const old=data.policies.find(x=>x.employee_id===employeeId);if(!employee&&!(r.action==='edit'&&old))return null;
  const weekly=DAYS.map((_,i)=>str('day_'+i));const officeId=str('office_id')||null;
  if(!modes(weekly)||(weekly.includes('office')&&!officeId)||(officeId&&!data.offices.some(x=>x.id===officeId&&x.is_active)))return null;
  return {kind:r.view,target:employeeId,method:'PUT',url:'/api/hr/attendance/policies/'+encodeURIComponent(employeeId),payload:{office_id:officeId,weekly_modes:weekly},label:employee?.name||old!.employee_name,source:old||null};
 }
 if(r.view==='requests'&&r.action==='review'){
  const row=data.requests.find(x=>x.id===r.id),status=str('status'),notes=str('review_notes');if(!row||row.status!=='pending'||!['approved','rejected'].includes(status)||notes.length>1000||!note(notes))return null;
  return {kind:r.view,target:row.id,method:'POST',url:'/api/hr/attendance/requests/'+encodeURIComponent(row.id)+'/review',payload:{status,review_notes:notes||null},label:row.employee_name||row.employee_id,source:row};
 }
 return null;
}
export function receipt(v:unknown,i:Intent,status:number){if(i.kind==='offices')return status===(i.method==='POST'?201:200)&&office(v)&&(!i.target||v.id===i.target)&&Object.entries(i.payload).every(([k,x])=>v[k as keyof Office]===x);
 if(i.kind==='policies')return status===200&&record(v)&&v.employee_id===i.target&&v.office_id===i.payload.office_id&&modes(v.weekly_modes)&&JSON.stringify(v.weekly_modes)===JSON.stringify(i.payload.weekly_modes);
 const old=i.source as RequestRow;return status===200&&request(v)&&v.id===i.target&&v.employee_id===old.employee_id&&v.status===i.payload.status&&v.review_notes===i.payload.review_notes&&['work_date','request_type','requested_mode','reason','proposed_check_in_at','proposed_check_out_at','created_at'].every(k=>v[k as keyof RequestRow]===old[k as keyof RequestRow]);}
export const EFFECTS={offices:'Office changes affect future location checks. An assigned office cannot be disabled until employee policies are reassigned.',policies:"This replaces Monday–Sunday work modes immediately. Changes after today's organization-local check-in are rejected. This does not change HR shift assignments or recalculate payroll.",requests:'Your own request must be reviewed by another HR manager. Approving a correction changes attendance timestamps and clears GPS verification; it does not recalculate posted payroll. The server rechecks schedule and attendance conflicts.'};
/** Exact characterized pre-write conflicts only; generic 400/409 remains uncertain. */
export function knownPrecommit(status:number,body:unknown,kind:View){if(!record(body)||typeof body.detail!=='string')return false;const allowed:Record<View,Record<number,string[]>>={offices:{409:['Reassign employee policies before disabling this office']},policies:{400:['Assign an office for office workdays','Choose an active office in this organization','Provide Monday–Sunday modes: office, remote, field or off'],409:["Cannot change the weekly policy after today's check-in"]},requests:{400:['Review status must be approved or rejected'],409:['Request has already been reviewed','Cannot approve a past remote workday','Office schedule has changed; review the request again','Attendance already started for this day','Correction times are no longer valid']}};return allowed[kind][status]?.includes(body.detail)===true;}
