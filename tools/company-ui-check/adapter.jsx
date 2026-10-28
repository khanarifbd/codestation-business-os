// Synthetic boundary only. Actual Company page and form widgets remain unchanged.
import React,{useSyncExternalStore} from 'react';
const scenarios=['initial-get-failure','initial-network-failure','initial-json-failure','saved-refresh-failure','partial-profile-failure'];
const requested=new URLSearchParams(location.search).get('scenario');
export const state={scenario:scenarios.includes(requested)?requested:scenarios[0],calls:[],blocked:[]};
const listeners=new Set();let version=0,getCount=0,refreshFailurePending=false;
const emit=()=>{version++;for(const f of listeners)f();};
export function useFixture(){useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},()=>version);return state;}
export function resetScenario(s){if(!scenarios.includes(s))throw Error('Unknown scenario');location.href='/dashboard/company?scenario='+encodeURIComponent(s);}
const router={push:path=>{state.blocked.push('Navigation intercepted: '+String(path));emit();},replace:path=>{state.blocked.push('Redirect intercepted: '+String(path));emit();}};
export function useRouter(){return router;}
export function CurrencySettingsPanel(){return <p>Currency provider panel excluded from this bounded synthetic check.</p>;}
export function PaymentGatewaysSettingsPanel(){return <p>Payment provider panel excluded; no provider access.</p>;}
export function SystemDefaultsPanel(){return <p>System Defaults panel excluded from this check.</p>;}
const bundle={organization:{id:'synthetic-company',name:'Synthetic Company',slug:'synthetic',status:'active',country_code:'US',timezone:'UTC',currency:'USD',business_type:null,team_size:null,financial_year_start_month:1},profile:{legal_name:'Synthetic Company Ltd',trading_name:null,industry:null,company_size:null,incorporation_date:null,website:null,description:null,primary_email:null,billing_email:null,support_email:null,phone:null,alternate_phone:null,whatsapp:null,fax:null,internal_notes:null},identifiers:[],addresses:[],localization:{default_language:'en',date_format:'YYYY-MM-DD',time_format:'24h',number_format:'1,234.56',decimal_places:2,currency_position:'before',first_day_of_week:1},financial:{accounting_currency:'USD',default_payment_terms_days:30,tax_calculation_mode:'exclusive',default_tax_rate:0,prices_include_tax:false},sequences:[],branding:{logo_url:null,square_icon_url:null,invoice_logo_url:null,primary_color:null,secondary_color:null,document_footer:null},online_legal:{privacy_policy_url:null,terms_url:null,linkedin_url:null,facebook_url:null,x_url:null,instagram_url:null,youtube_url:null},documents:[]};
globalThis.fetch=async(input,init={})=>{
 const url=typeof input==='string'?input:'[non-string request]',method=(init.method||'GET').toUpperCase();
 const allowed=(method==='GET'&&url==='/api/company-settings')||(method==='PATCH'&&['/api/company-settings/core','/api/company-settings/profile'].includes(url));
 const row={sequence:state.calls.length+1,url,method,scenario:state.scenario,status:'PENDING',bodyKeys:[]};state.calls.push(row);
 if(!allowed){row.status='BLOCKED';state.blocked.push('Nonallowlisted request blocked');emit();throw Error('Synthetic fixture transport refuses request');}
 let value,status=200,jsonFailure=false;
 if(method==='GET'){
  getCount++;
  if(state.scenario==='initial-network-failure'&&getCount===1){row.status='FETCH_REJECTED';emit();throw new TypeError('Synthetic fetch rejection');}
  if(state.scenario==='initial-json-failure'&&getCount===1)jsonFailure=true;
  if((state.scenario==='initial-get-failure'&&getCount===1)||refreshFailurePending){refreshFailurePending=false;status=500;value={detail:'Synthetic settings read failure'};}
  else value=structuredClone(bundle);
 }else{
  const body=JSON.parse(init.body||'{}');row.bodyKeys=Object.keys(body);
  if(url.endsWith('/core')){Object.assign(bundle.organization,body);value=structuredClone(bundle.organization);}
  else if(state.scenario==='partial-profile-failure'){status=422;value={detail:[{loc:['body','legal_name'],msg:'Synthetic profile validation rejection'}]};}
  else{Object.assign(bundle.profile,body);value=structuredClone(bundle.profile);if(state.scenario==='saved-refresh-failure')refreshFailurePending=true;}
 }
 row.status=status;emit();return {ok:status>=200&&status<300,status,json:async()=>{if(jsonFailure){row.json='REJECTED';emit();throw new SyntaxError('Synthetic malformed JSON');}return structuredClone(value);}};
};
for(const key of ['XMLHttpRequest','WebSocket','EventSource'])globalThis[key]=function(){state.blocked.push(key+' blocked');emit();throw Error('Synthetic fixture forbids '+key);};
if(navigator.sendBeacon)navigator.sendBeacon=()=>{state.blocked.push('Beacon blocked');emit();return false;};
for(const event of ['click','auxclick'])document.addEventListener(event,e=>{if(e.target.closest?.('a')){e.preventDefault();state.blocked.push('Link navigation blocked');emit();}},true);
window.__companyFixture={getSnapshot:()=>structuredClone(state)};
