// Fixture-only adapters. Actual Hiring hooks and component source remain unchanged.
import {useSyncExternalStore} from 'react';
import {hiringRead} from './hiring-data.cjs';
const listeners=new Set();let version=0;
export const state={scenario:sessionStorage.getItem('hiring-fixture-scenario')||'normal',company:'A',denied:false,calls:[],blocked:[]};
const emit=()=>{version++;for(const fn of listeners)fn();};
export function useFixture(){useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>version);return state;}
export function update(patch){Object.assign(state,patch);sessionStorage.setItem('hiring-fixture-scenario',state.scenario);emit();}
window.addEventListener('popstate',emit);
const ROOT='/dashboard/hr/talent/hiring';
export function navigate(href,replace=false){const u=new URL(href,location.origin);if(u.origin!==location.origin||!(u.pathname===ROOT||u.pathname.startsWith(ROOT+'/'))){state.blocked.push('Navigation blocked: '+u.pathname);emit();return;}history[replace?'replaceState':'pushState']({},'',u.pathname+u.search);emit();}
const router={push:href=>navigate(href),replace:href=>navigate(href,true),refresh:()=>emit()};
export function useRouter(){return router;}
export function usePathname(){useFixture();return location.pathname;}
export function useSearchParams(){useFixture();return new URLSearchParams(location.search);}
export function useDashboardSession(){useFixture();return {loading:false,profile:{email:'synthetic@example.invalid'},tenant:{organization:{id:state.company},membership_id:'synthetic-member',role_id:'synthetic-role',status:'active',permissions:[]}};}
export function useHRAccess(){useFixture();return {loading:false,error:null,access:{can_view:!state.denied,can_manage:!state.denied,can_view_people:!state.denied,can_self:false,can_manage_people:false,can_invite_employees:false,can_manage_structure:false,is_employee:false,timezone:"UTC",currency:"USD"}};}
// Captured response ownership permits delayed old responses without accessing a backend.
globalThis.fetch=async(input,init={})=>{const url=String(input),scenario=state.scenario,company=state.company,denied=state.denied;state.calls.push({url,method:init.method||'GET',company,scenario});
 if((init.method||'GET')!=='GET'||!['/api/hr/jobs','/api/hr/candidates'].includes(url)){state.blocked.push('Transport refused');throw Error('Read-only fixture refuses this request');}
 if(scenario==='slow'||scenario==='stale401')await new Promise(r=>setTimeout(r,1800));
 let result=scenario==='error'?{status:500,value:{detail:'Synthetic read failed'}}:scenario==='unauthorized'||scenario==='stale401'?{status:401,value:{detail:'Synthetic session expired'}}:scenario==='malformed'?{status:200,value:{items:[]}}:hiringRead(url.endsWith('jobs')?'hiringJobs':'hiringCandidates',{identity:{company},access:{can_view:!denied}},scenario);
 if(scenario==='normal'&&url.endsWith('candidates'))result.value[0].rating='0.00';
 return {ok:result.status===200,status:result.status,json:async()=>result.value};};
// No external files, legacy screens, provider actions or real navigation from fixture.
const guardLink=e=>{const a=e.target.closest?.('a');if(!a)return;const u=new URL(a.href,location.origin);if(u.origin!==location.origin||!(u.pathname===ROOT||u.pathname.startsWith(ROOT+'/'))){e.preventDefault();state.blocked.push('Link blocked: '+u.pathname);emit();}};document.addEventListener('click',guardLink,true);document.addEventListener('auxclick',guardLink,true);

// Browser transport APIs cannot bypass synthetic fetch. CSP independently denies connect.
for(const key of ["XMLHttpRequest","WebSocket","EventSource"]){globalThis[key]=function(){throw Error("Fixture forbids "+key);};}
if(navigator.sendBeacon)navigator.sendBeacon=()=>false;

// Make non-fixture links inert in rendered DOM as well as intercepting clicks.
// Original component source is unchanged; this is an explicitly synthetic safety constraint.
function inertLinks(){for(const a of document.querySelectorAll('a[href]')){const u=new URL(a.getAttribute('href'),location.origin);if(u.origin!==location.origin||!(u.pathname===ROOT||u.pathname.startsWith(ROOT+'/'))){a.removeAttribute('href');a.removeAttribute('target');a.setAttribute('aria-disabled','true');a.setAttribute('title','Disabled by synthetic read-only fixture');}}}
new MutationObserver(inertLinks).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});inertLinks();
