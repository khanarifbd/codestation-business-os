import {record,timeId} from '@/components/hr-time/hr-time-model';
export const HIRING='/dashboard/hr/talent/hiring';
export type View='jobs'|'candidates';
export type Job={id:string;title:string;department_id:string|null;employment_type:string;location:string|null;openings:number;status:string;description:string|null};
export type Candidate={id:string;job_opening_id:string;job_title:string|null;full_name:string;email:string;phone:string|null;stage:string;rating:string|null;resume_url:string|null;notes:string|null};
const text=(v:unknown):v is string=>typeof v==='string';
const nullable=(v:unknown):v is string|null=>v===null||text(v);
export const hiringId=(v:unknown):v is string=>timeId(v)&&v!=='new'&&/^[A-Za-z0-9_-]+$/.test(v);
export function job(v:unknown):v is Job{return record(v)&&hiringId(v.id)&&text(v.title)&&(v.department_id===null||hiringId(v.department_id))&&text(v.employment_type)&&nullable(v.location)&&typeof v.openings==='number'&&Number.isSafeInteger(v.openings)&&v.openings>=1&&text(v.status)&&nullable(v.description);}
export function candidate(v:unknown):v is Candidate{return record(v)&&hiringId(v.id)&&hiringId(v.job_opening_id)&&nullable(v.job_title)&&text(v.full_name)&&text(v.email)&&nullable(v.phone)&&text(v.stage)&&(v.rating===null||typeof v.rating==='string'&&/^\d+(?:\.\d+)?$/.test(v.rating)&&Number(v.rating)>=0&&Number(v.rating)<=5)&&nullable(v.resume_url)&&nullable(v.notes);}
function unique<T>(v:unknown,check:(x:unknown)=>x is T,key:(x:T)=>string,cap:number):v is T[]{return Array.isArray(v)&&v.length<=cap&&v.every(check)&&new Set(v.map(key)).size===v.length;}
export const jobs=(v:unknown):v is Job[]=>unique(v,job,x=>x.id,100);
export const candidates=(v:unknown):v is Candidate[]=>unique(v,candidate,x=>x.id,200);
export function browse(raw:string|URLSearchParams){const q=new URLSearchParams(raw);return {view:q.getAll('view').length===1&&q.get('view')==='candidates'?'candidates' as View:'jobs' as View,search:q.getAll('search').length===1?q.get('search')!.slice(0,300):''};}
export function hiringHref(view:View='jobs',search=''){const q=new URLSearchParams();if(view!=='jobs')q.set('view',view);if(search)q.set('search',search.slice(0,300));return HIRING+(q.size?'?'+q:'');}
export function hiringReturn(raw:string|null){if(!raw||!(raw===HIRING||raw.startsWith(HIRING+'?'))||raw.includes('#'))return HIRING;const b=browse(raw.split('?')[1]||'');return hiringHref(b.view,b.search);}
export function hiringRoute(path:string,q:URLSearchParams){if(path===HIRING)return {valid:true,view:browse(q).view,id:''};if(path.startsWith(HIRING+'/')){const parts=path.slice(HIRING.length+1).split('/');if(parts.length===2&&['jobs','candidates'].includes(parts[0])&&hiringId(parts[1]))return {valid:true,view:parts[0] as View,id:parts[1]};}return {valid:false,view:'jobs' as View,id:''};}
export function detailHref(view:View,id:string,back=hiringHref(view)){return `${HIRING}/${view}/${encodeURIComponent(id)}?${new URLSearchParams({returnTo:hiringReturn(back)})}`;}
/** External resume navigation is explicit only. Never fetch, preview or embed it. */
export function safeResume(raw:string|null){if(!raw||raw!==raw.trim()||/[\u0000-\u0020\u007f\\]/.test(raw)||!/^https?:\/\//i.test(raw))return null;try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&u.hostname?u.href:null;}catch{return null;}}
export const CAP={jobs:100,candidates:200};
export function searchJobs(rows:Job[],search:string){const n=search.toLocaleLowerCase();return rows.filter(x=>[x.title,x.location,x.employment_type,x.status,x.description].join(' ').toLocaleLowerCase().includes(n));}
export function searchCandidates(rows:Candidate[],search:string){const n=search.toLocaleLowerCase();return rows.filter(x=>[x.full_name,x.email,x.phone,x.job_title,x.stage,x.notes].join(' ').toLocaleLowerCase().includes(n));}
