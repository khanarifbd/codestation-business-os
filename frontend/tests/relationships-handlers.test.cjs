/** Synthetic handler/component checks: no browser, real API, outreach, invitations or deletions. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const success=value=>({ok:true,status:200,json:async()=>value});
const failure=(status,detail='Synthetic denial')=>({ok:false,status,json:async()=>({detail})});
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
const client={id:'synthetic-client',client_code:'SYN-CLIENT',client_type:'company',display_name:'Synthetic client',contact_name:'Synthetic contact',email:'client@example.invalid',billing_email:null,phone:null,country_code:'BD',currency:'BDT',status:'active',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-24T00:00:00Z',source_lead_code:null,acquisition_source_id:null};
const status={id:'synthetic-open',name:'Open',slug:'open',category:'open',color:'#64748b',sort_order:1,is_default:true,is_active:true};
const won={...status,id:'synthetic-won',name:'Won',slug:'won',category:'won',is_default:false};
const source={id:'synthetic-source',name:'Synthetic source',slug:'synthetic',is_active:true,sort_order:1};
const meta={statuses:[status,won],sources:[source],employees:[{id:'synthetic-employee',full_name:'Synthetic employee',employee_code:'SYN-E1'}],default_country_code:'BD',default_currency:'BDT'};
const lead={id:'synthetic-lead',lead_code:'SYN-LEAD',lead_type:'company',company_name:'Synthetic company',contact_name:'Synthetic contact',email:'lead@example.invalid',phone:null,status_id:status.id,status_name:status.name,status_color:status.color,status_category:'open',source_id:source.id,source_name:source.name,estimated_value:'120.50',currency:'USD',probability_percent:25,next_follow_up_at:null,converted_client_id:null};
const leadDetail={lead,website:null,whatsapp:null,country_code:'BD',state_region:null,city:null,address_line1:null,notes:null,interactions:[]};
const portal={client_id:client.id,enabled:false,active_access_count:0,pending_invitation_count:0,has_email:true};
const access={clients_manage:true,quotations:true,quotations_manage:true,orders:true,projects:true,finance:true,finance_manage:true};
const workspace={client,access,counts:{quotations:1,orders:2,projects:3,active_projects:2,invoices:4,overdue_invoices:1},business_value:[{currency:'USD',amount:'100'},{currency:'BDT',amount:'200'}],invoice_summary:[{currency:'USD',invoiced:'100',paid:'30',outstanding:'70'},{currency:'BDT',invoiced:'200',paid:'50',outstanding:'150'}],quotations:[],orders:[],projects:[],invoices:[],payments:[],timeline:[]};
const config={crm:['src/app/dashboard/crm/page.tsx','CrmPage',['api','queryString','loadMeta','loadSummary','loadLeads','reloadDetail','applyRefresh','run','loadMore','openLead','closeLead','activeStatuses','activeSources']],clients:['src/app/dashboard/clients/page.tsx','ClientsPage',['api','queryString','loadList','loadSummary','loadMore','loadPortalStatuses','refreshAfterMutation','refreshDetail','openClient','closeClient','createClient','updateClient','changeStatus','togglePortalAccess','clientPayload']],detail:['src/app/dashboard/clients/[clientId]/page.tsx','ClientWorkspacePage',['load','tabs']]};
function all(node,type,out=[]){if(Array.isArray(node))node.forEach(n=>all(n,type,out));else if(node?.props){if(node.type===type||node.type?.name===type)out.push(node);for(const value of Object.values(node.props))if(Array.isArray(value)||value?.props)all(value,type,out);}return out;}
function label(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(label).join(' ');return label(node.props?.children);}
function hasJsx(node){let found=false;function visit(n){if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n))found=true;ts.forEachChild(n,visit);}visit(node);return found;}
function harness(kind,name){const [file,main,exposed]=config[kind];name??=main;const filename=path.join(root,file);let sourceCode=fs.readFileSync(filename,'utf8');const ast=ts.createSourceFile(file,sourceCode,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const functions=ast.statements.filter(ts.isFunctionDeclaration);const target=functions.find(n=>n.name?.text===name);assert.ok(target,name);const names=target.body.statements.filter(ts.isVariableStatement).flatMap(n=>n.declarationList.declarations).filter(n=>ts.isArrayBindingPattern(n.name)&&n.initializer?.getText(ast).startsWith('useState')).map(n=>n.name.elements[0].name.text);const renderStart=target.body.statements.find(hasJsx).getStart(ast);sourceCode=sourceCode.slice(0,renderStart)+'__handlers={'+(name===main?exposed.join(','):'')+'};\n'+sourceCode.slice(renderStart);sourceCode+='\nlet __handlers; export const __test={'+functions.map(n=>n.name.text).join(',')+'}; export const getHandlers=()=>__handlers;';
 const states=[],refs=[],effects=[],requests=[],navigation=[],timers=[];let cursor=0,refCursor=0,tenant={is_owner:true,permissions:['clients.manage','crm.manage']},params={clientId:client.id};
 let respond=(url)=>success(url.startsWith('/api/client-access')?{can_manage:true,items:[portal]}:url.endsWith('/meta')?meta:url.includes('/workspace?')?workspace:url.endsWith('/detail')?client:url.includes('/clients?')?{items:[client],next_cursor:null}:url.endsWith('/clients/summary')?{total:1,active:1,inactive:0}:url.includes('/leads?')?{items:[lead],next_cursor:null}:url.endsWith('/summary')?{total_leads:1,open_leads:1,won_leads:0,due_followups:0,converted_leads:0}:url.includes('/leads/')?leadDetail:{});
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod.require=id=>{if(id==='react')return {useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:initial=>{const i=refCursor++;return refs[i]??=( {current:initial});},useEffect:effect=>effects.push(effect),useMemo:fn=>fn(),useCallback:fn=>fn};if(id==='next/navigation')return{useRouter:()=>({replace:value=>navigation.push(['replace',value]),push:value=>navigation.push(['push',value])}),useParams:()=>params};if(id==='next/link')return{default:'a'};if(id.endsWith('.css'))return{};if(id==='@/components/dashboard-session-context')return {useDashboardSession:()=>({tenant})};if(id.startsWith('@/components/'))return new Proxy({},{get:(_t,key)=>String(key)});if(['@/lib/company-options','@/lib/sales-money-preview','@/lib/api-error','@/lib/crm-decimal'].includes(id)){const local=path.join(root,id.replace('@/','src/')+'.ts');const library=new Module(local,module);library.filename=local;library.paths=module.paths;library._compile(ts.transpileModule(fs.readFileSync(local,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,local);return library.exports;}return require(id);};mod._compile(ts.transpileModule(sourceCode,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,filename);
 const original={fetch:global.fetch,window:global.window,FormData:global.FormData,Date:global.Date};global.fetch=async(url,options)=>{requests.push({url,options});return respond(url,options);};global.window={location:{search:''},setTimeout:(callback,delay)=>{const timer={callback,delay,cancelled:false};timers.push(timer);return timer;},clearTimeout:timer=>{timer.cancelled=true;}};global.FormData=class{constructor(form){this.fields=form?.fields??{};}get(key){return this.fields[key]??null;}};global.Date=class extends original.Date{constructor(...args){super(...(args.length?args:['2026-10-24T12:00:00Z']));}static now(){return new original.Date('2026-10-24T12:00:00Z').getTime();}};
 return {all,requests,navigation,effects,timers,helpers:mod.exports.__test,handlers:()=>mod.exports.getHandlers(),render:props=>{cursor=0;refCursor=0;effects.length=0;return mod.exports.__test[name]({canManage:true,...(props??{})});},state:key=>states[names.indexOf(key)],setState:(key,value)=>{const i=names.indexOf(key);assert.ok(i>=0,key);states[i]=value;},setResponse:fn=>{respond=fn;},setParams:value=>{params=value;},setTenant:value=>{tenant=value;},cleanup:()=>Object.assign(global,original)};
}
function withCase(kind,title,check,name){test(title,async()=>{const h=harness(kind,name);try{await check(h);}finally{h.cleanup();}});}
const button=(tree,text)=>all(tree,'button').find(n=>label(n).replace(/\s+/g,' ').trim()===text);
const event=fields=>({preventDefault(){},currentTarget:{fields,reset(){this.resetCalled=true;}}});
function ready(h,kind){h.render();if(kind==='detail')h.setState('workspace',structuredClone(workspace));else h.setState('meta',structuredClone(meta));h.setState('loading',false);return h.render();}

for(const kind of ['crm','clients']) {
 const listName=kind==='crm'?'loadLeads':'loadList', stateName=kind==='crm'?'leads':'clients';
 withCase(kind,`${kind}: search debounce waits 250 ms, trims and cancels obsolete timers`,h=>{
  h.render();h.setState('searchDraft','  synthetic search  ');h.render();const cancel=h.effects[0]();
  assert.equal(h.timers[0].delay,250);assert.equal(h.state('search'),'');
  h.timers[0].callback();assert.equal(h.state('search'),'synthetic search');cancel();assert.equal(h.timers[0].cancelled,true);assert.equal(h.requests.length,0);
 });
 withCase(kind,`${kind}: filter query preserves limit 30 and original parameter names`,h=>{
  h.render();h.setState('search','A & B');h.setState('statusFilter','synthetic-status');
  if(kind==='crm'){h.setState('sourceFilter','source/id');h.setState('assigneeFilter','employee/id');}
  h.render();const params=new URLSearchParams(h.handlers().queryString);
  assert.equal(params.get('limit'),'30');assert.equal(params.get('search'),'A & B');
  assert.equal(params.get(kind==='crm'?'status_id':'status'),'synthetic-status');
  if(kind==='crm'){assert.equal(params.get('source_id'),'source/id');assert.equal(params.get('assigned_employee_id'),'employee/id');}
 });
 for(const code of [401,403])withCase(kind,`${kind}: ${code} preserves authentication/role error behavior`,async h=>{
  h.render();h.setResponse(()=>failure(code));
  await assert.rejects(()=>h.handlers().api('/synthetic'),code===401?/Authentication required/:/role does not have permission/);
  assert.deepEqual(h.navigation,code===401?[['replace','/login']]:[]);
 });
 withCase(kind,`${kind}: latest list request wins over older success and preserves its cursor`,async h=>{
  h.render();const pending=[];h.setResponse(url=>url.startsWith('/api/client-access')?success({can_manage:false,items:[]}):new Promise(resolve=>pending.push(resolve)));
  const older=h.handlers()[listName]();h.setState('search','newer');h.render();const newer=h.handlers()[listName]();
  pending[1](success({items:[{...(kind==='crm'?lead:client),id:'newer'}],next_cursor:'newer-cursor'}));await newer;
  pending[0](success({items:[{...(kind==='crm'?lead:client),id:'older'}],next_cursor:'older-cursor'}));await older;await settle();
  assert.deepEqual(h.state(stateName).map(item=>item.id),['newer']);assert.equal(h.state('nextCursor'),'newer-cursor');assert.equal(h.state('loading'),false);
 });
 withCase(kind,`${kind}: stale list failure cannot replace a newer successful result`,async h=>{
  h.render();const pending=[];h.setResponse(url=>url.startsWith('/api/client-access')?success({can_manage:false,items:[]}):new Promise(resolve=>pending.push(resolve)));
  const older=h.handlers()[listName](),newer=h.handlers()[listName]();pending[1](success({items:[],next_cursor:null}));await newer;pending[0](failure(500,'Old synthetic failure'));await older;
  assert.equal(h.state('error'),null);assert.equal(h.state('loading'),false);
 });
 withCase(kind,`${kind}: cursor pagination appends, and absent cursor makes no request`,async h=>{
  h.render();await h.handlers().loadMore();assert.equal(h.requests.length,0);
  h.setState(stateName,[kind==='crm'?lead:client]);h.setState('nextCursor','cursor +/');h.setState('search','synthetic');h.render();
  h.setResponse(url=>success(url.startsWith('/api/client-access')?{can_manage:false,items:[]}:{items:[{...(kind==='crm'?lead:client),id:'second'}],next_cursor:null}));
  await h.handlers().loadMore();await settle();const params=new URL(h.requests[0].url,'https://example.invalid').searchParams;
  assert.equal(params.get('cursor'),'cursor +/');assert.equal(params.get('search'),'synthetic');assert.equal(params.get('limit'),'30');
  assert.equal(h.state(stateName).length,2);assert.equal(h.state('nextCursor'),null);assert.equal(h.state('loadingMore'),false);
 });
 withCase(kind,`${kind}: page from an obsolete filter cannot append to the new result`,async h=>{
  h.render();h.setState('nextCursor','old-page');h.render();const pending=[];
  h.setResponse(url=>url.startsWith('/api/client-access')?success({can_manage:false,items:[]}):new Promise(resolve=>pending.push(resolve)));
  const oldPage=h.handlers().loadMore();h.setState('search','new filter');h.render();const fresh=h.handlers()[listName]();
  pending[1](success({items:[{...(kind==='crm'?lead:client),id:'fresh'}],next_cursor:null}));await fresh;
  pending[0](success({items:[{...(kind==='crm'?lead:client),id:'stale'}],next_cursor:'old-next'}));await oldPage;
  assert.deepEqual(h.state(stateName).map(item=>item.id),['fresh']);assert.equal(h.state('nextCursor'),null);
 });
 withCase(kind,`${kind}: reset clears search and filters without a mutation`,h=>{
  ready(h,kind);h.setState('searchDraft','x');h.setState('search','x');h.setState('statusFilter','active');
  if(kind==='crm'){h.setState('sourceFilter','x');h.setState('assigneeFilter','x');}
  button(h.render(),'Reset').props.onClick();for(const key of ['searchDraft','search','statusFilter',...(kind==='crm'?['sourceFilter','assigneeFilter']:[])])assert.equal(h.state(key),'');assert.equal(h.requests.length,0);
 });
 withCase(kind,`${kind}: loading suppresses empty state and empty result retains recovery guidance`,h=>{
  h.render();assert.doesNotMatch(label(h.render()),kind==='crm'?/No leads found/:/No clients found/);
  h.setState('loading',false);assert.match(label(h.render()),kind==='crm'?/No leads found/:/No clients found/);
 });
}

for(const [policy,expected] of [['none',[]],['meta',['/api/crm/meta']],['summary-list',['/api/crm/summary','/api/crm/leads?limit=30']],['detail',['/api/crm/leads/synthetic-lead']],['detail-summary-list',['/api/crm/leads/synthetic-lead','/api/crm/summary','/api/crm/leads?limit=30']]])withCase('crm',`CRM refresh policy ${policy} keeps its exact request scope`,async h=>{
 h.render();if(policy.includes('detail')) { await h.handlers().openLead(lead.id); h.requests.length=0; } await h.handlers().applyRefresh(policy,lead.id);assert.deepEqual(h.requests.map(r=>r.url).sort(),expected.sort());
});
withCase('crm','CRM mutation runner clears pending state and preserves work/refresh failure messages',async h=>{
 h.render();await h.handlers().run(async()=>{throw new Error('Synthetic save denied');},'Saved','none');assert.equal(h.state('saving'),false);assert.equal(h.state('error'),'Synthetic save denied');assert.equal(h.state('message'),null);assert.equal(h.requests.length,0);
 await h.handlers().run(async()=>{},'Synthetic saved','none');assert.equal(h.state('message'),'Synthetic saved');assert.equal(h.state('error'),null);
});
withCase('crm','CRM active options exclude disabled statuses and sources',h=>{
 h.render();h.setState('meta',{...meta,statuses:[status,{...won,is_active:false}],sources:[source,{...source,id:'inactive',is_active:false}]});h.render();assert.deepEqual(h.handlers().activeStatuses.map(s=>s.id),[status.id]);assert.deepEqual(h.handlers().activeSources.map(s=>s.id),[source.id]);
});
withCase('crm','Create lead retains trimmed, nullable, numeric and datetime payload plus list/summary refresh',async h=>{
 ready(h,'crm');h.setState('newLeadOpen',true);const tree=h.render();const modal=all(tree,'Modal').find(n=>n.props.title==='Create lead');const form=all(modal,'form')[0];
 const e=event({contact_name:'  Synthetic contact  ',company_name:' Synthetic Co ',email:' lead@example.invalid ',estimated_value:'120.50',probability_percent:'25',currency:'USD',next_follow_up_at:'2026-10-24T12:00:00Z'});
 form.props.onSubmit(e);await settle();const request=h.requests.find(r=>r.options?.method==='POST');assert.equal(request.url,'/api/crm/leads');
 assert.deepEqual(JSON.parse(request.options.body),{lead_type:'company',company_name:'Synthetic Co',contact_name:'Synthetic contact',email:'lead@example.invalid',phone:null,whatsapp:null,website:null,country_code:null,state_region:null,city:null,address_line1:null,source_id:null,status_id:null,assigned_employee_id:null,estimated_value:'120.50',currency:'USD',probability_percent:25,next_follow_up_at:'2026-10-24T12:00:00.000Z',notes:null});
 assert.equal(e.currentTarget.resetCalled,true);assert.equal(h.state('newLeadOpen'),false);assert.equal(h.state('message'),'Lead created');assert.ok(h.requests.some(r=>r.url==='/api/crm/summary'));
});
withCase('crm','Create lead Cancel and drawer Close dismiss locally without a request',h=>{
 ready(h,'crm');h.setState('newLeadOpen',true);button(h.render(),'Cancel').props.onClick();assert.equal(h.state('newLeadOpen'),false);
 h.setState('detail',leadDetail);all(h.render(),'LeadDrawer')[0].props.onClose();assert.equal(h.state('detail'),null);assert.equal(h.requests.length,0);
});
function drawerProps(overrides={}){const runs=[],closed=[];return{props:{detail:leadDetail,loading:false,meta,saving:false,onClose:()=>closed.push(true),reloadDetail:async()=>{},api:async(url,options)=>{const response=await fetch('/api/crm'+url,options);if(!response.ok)throw new Error('Synthetic denied');return response.json();},run:async(work,message,policy,id)=>{runs.push({message,policy,id});await work();},...overrides},runs,closed};}
withCase('crm','Won and converted lead detail locks status changes and conversion eligibility',h=>{
 for(const [category,converted,statusSelect,convert] of [['open',null,true,false],['won',null,false,true],['won',client.id,false,false]]){
  const {props}=drawerProps({detail:{...leadDetail,lead:{...lead,status_category:category,converted_client_id:converted}}});const tree=h.render(props);
  assert.equal(all(tree,'StatusSelect').length>0,statusSelect);assert.equal(Boolean(button(tree,'Convert to Client')),convert);if(converted)assert.ok(all(tree,'a').some(n=>n.props.href==='/dashboard/clients'));
 }
},'LeadDrawer');
withCase('crm','Lead status change retains PATCH payload, refresh policy and won notice',async h=>{
 const {props,runs}=drawerProps();const tree=h.render(props);all(tree,'StatusSelect')[0].props.onChange(won.id);await settle();assert.equal(h.requests[0].url,`/api/crm/leads/${lead.id}/status`);assert.equal(h.requests[0].options.method,'PATCH');assert.deepEqual(JSON.parse(h.requests[0].options.body),{status_id:won.id});assert.equal(runs[0].policy,'detail-summary-list');assert.equal(runs[0].id,lead.id);assert.equal(h.state('wonNoticeOpen'),true);
},'LeadDrawer');
for(const type of ['note','follow_up'])withCase('crm',`${type} activity preserves request body and precise refresh scope`,async h=>{
 const {props,runs}=drawerProps();const tree=h.render(props);const form=all(tree,'form')[0];const e=event({interaction_type:type,subject:' Synthetic subject ',body:' Synthetic body ',scheduled_at:type==='follow_up'?'2026-10-25T08:00:00Z':''});form.props.onSubmit(e);await settle();
 assert.equal(h.requests[0].url,`/api/crm/leads/${lead.id}/interactions`);assert.deepEqual(JSON.parse(h.requests[0].options.body),{interaction_type:type,subject:'Synthetic subject',body:'Synthetic body',scheduled_at:type==='follow_up'?'2026-10-25T08:00:00.000Z':null});assert.equal(runs[0].policy,type==='follow_up'?'detail-summary-list':'detail');assert.equal(e.currentTarget.resetCalled,true);
},'LeadDrawer');
withCase('crm','Won-lead conversion Cancel has no mutation and submit preserves client linkage payload',async h=>{
 const {props,runs}=drawerProps({detail:{...leadDetail,lead:{...lead,status_category:'won'}}});h.render(props);h.setState('convertOpen',true);let tree=h.render(props);button(tree,'Cancel').props.onClick();assert.equal(h.state('convertOpen'),false);assert.equal(h.requests.length,0);
 h.setState('convertOpen',true);tree=h.render(props);const modal=all(tree,'Modal').find(n=>n.props.title==='Create client from won lead');all(modal,'form')[0].props.onSubmit(event({display_name:' Synthetic converted ',currency:'USD'}));await settle();
 assert.equal(h.requests[0].url,`/api/crm/leads/${lead.id}/convert`);const body=JSON.parse(h.requests[0].options.body);assert.equal(body.client_type,'company');assert.equal(body.display_name,'Synthetic converted');assert.equal(body.currency,'USD');assert.equal(body.email,null);assert.equal(body.assigned_employee_id,null);assert.equal(runs[0].policy,'detail-summary-list');assert.equal(h.state('convertOpen'),false);
},'LeadDrawer');
for(const [component,collection,endpoint,deleteLabel] of [['PipelineStatuses','statuses','statuses','Delete status'],['PipelineSources','sources','sources','Delete source']]){
 withCase('crm',`${component}: destructive actions require decision confirmation and Cancel is inert`,async h=>{
  const runs=[];const item=component==='PipelineStatuses'?{...status,is_default:false}:source;const props={[collection]:[item],saving:false,api:async(url,options)=>{const response=await fetch('/api/crm'+url,options);return response.json();},run:async(work,message,policy)=>{runs.push({message,policy});await work();}};
  let tree=h.render(props);button(tree,'Delete').props.onClick();assert.equal(h.requests.length,0);tree=h.render(props);button(tree,'Cancel').props.onClick();assert.equal(h.state('deleteId'),null);assert.equal(h.requests.length,0);
  h.setState('deleteId',item.id);button(h.render(props),deleteLabel).props.onClick();await settle();assert.equal(h.requests[0].url,`/api/crm/settings/${endpoint}/${item.id}`);assert.equal(h.requests[0].options.method,'DELETE');assert.equal(runs[0].policy,'meta');assert.equal(h.state('deleteId'),null);
 },component);
}
withCase('crm','Default pipeline status cannot be disabled or deleted',h=>{
 const tree=h.render({statuses:[status],saving:false,api:async()=>{},run:async()=>{}});assert.equal(button(tree,'Disable').props.disabled,true);assert.equal(button(tree,'Delete').props.disabled,true);
},'PipelineStatuses');

withCase('clients','Portal status lookup keeps encoded IDs, no-store and merges rather than discards existing statuses',async h=>{
 h.render();h.setState('portalAccess',{existing:{...portal,client_id:'existing'}});await h.handlers().loadPortalStatuses([]);assert.equal(h.requests.length,0);await h.handlers().loadPortalStatuses(['synthetic/client','other']);
 assert.equal(h.requests[0].url,'/api/client-access?client_ids=synthetic%2Fclient%2Cother');assert.equal(h.requests[0].options.cache,'no-store');assert.equal(h.state('canManagePortalAccess'),true);assert.ok(h.state('portalAccess').existing);assert.ok(h.state('portalAccess')[client.id]);
});
withCase('clients','Portal mutation guard rejects unknown status, missing permission, busy state and missing email',async h=>{
 h.render();await h.handlers().togglePortalAccess(client);assert.equal(h.requests.length,0);
 h.setState('portalAccess',{[client.id]:portal});h.render();await h.handlers().togglePortalAccess(client);assert.equal(h.requests.length,0);
 h.setState('canManagePortalAccess',true);h.setState('portalWorkingId','other-client');h.render();await h.handlers().togglePortalAccess(client);assert.equal(h.requests.length,0);
 h.setState('portalWorkingId',null);h.setState('portalAccess',{[client.id]:{...portal,has_email:false}});h.render();await h.handlers().togglePortalAccess(client);assert.equal(h.requests.length,0);assert.match(h.state('error'),/Add an email or billing email/);
});
for(const enabled of [false,true])withCase('clients',`Mocked portal ${enabled?'disable':'enable'} retains endpoint, payload and status refresh`,async h=>{
 h.render();h.setState('portalAccess',{[client.id]:{...portal,enabled}});h.setState('canManagePortalAccess',true);h.render();await h.handlers().togglePortalAccess(client);
 assert.equal(h.requests[0].url,enabled?'/api/client-access?client_id=synthetic-client':'/api/client-access');assert.equal(h.requests[0].options.method,enabled?'DELETE':'POST');
 if(!enabled)assert.deepEqual(JSON.parse(h.requests[0].options.body),{client_id:client.id,is_primary_contact:true});
 assert.equal(h.requests[1].url,'/api/client-access?client_ids=synthetic-client');assert.equal(h.state('portalWorkingId'),null);assert.match(h.state('message'),enabled?/disabled/:/enabled/);
});
withCase('clients','Portal server failure or 401 releases busy state without claiming success',async h=>{
 h.render();h.setState('portalAccess',{[client.id]:portal});h.setState('canManagePortalAccess',true);h.setResponse(()=>failure(403,'Synthetic access denied'));h.render();await h.handlers().togglePortalAccess(client);assert.equal(h.state('portalWorkingId'),null);assert.equal(h.state('error'),'Synthetic access denied');assert.equal(h.state('message'),null);
 h.setResponse(()=>failure(401));h.render();await h.handlers().togglePortalAccess(client);assert.deepEqual(h.navigation,[['replace','/login']]);assert.equal(h.state('portalWorkingId'),null);
});
withCase('clients','Portal access widget remains read-only for enabled, pending, missing-email and disabled statuses',h=>{
 for(const [patch,expected] of [[{enabled:true},'Enabled'],[{pending_invitation_count:1},'Invitation pending'],[{has_email:false},'No email'],[{},'Disabled']]){
  const tree=h.render({status:{...portal,...patch},canManage:true,working:false,onToggle:()=>{throw new Error('Display must not toggle access');}});assert.match(label(tree),new RegExp(expected));assert.equal(all(tree,'button').length,0);
 }
},'PortalAccessToggle');
const clientFields=['display_name','legal_name','contact_name','email','billing_email','phone','whatsapp','website','country_code','state_region','city','postal_code','address_line1','address_line2','tax_identifier','currency','acquisition_source_id','assigned_employee_id','notes'];
withCase('clients','Client creation retains all trimmed/nullable fields and refreshes list/summary',async h=>{
 ready(h,'clients');h.setState('createOpen',true);h.render();const e=event({display_name:' Synthetic client ',email:' client@example.invalid ',currency:' USD '});await h.handlers().createClient(e);
 const request=h.requests.find(r=>r.options?.method==='POST');assert.equal(request.url,'/api/crm/clients');assert.deepEqual(JSON.parse(request.options.body),{client_type:'company',...Object.fromEntries(clientFields.map(key=>[key,null])),display_name:'Synthetic client',email:'client@example.invalid',currency:'USD'});
 assert.equal(e.currentTarget.resetCalled,true);assert.equal(h.state('createOpen'),false);assert.equal(h.state('saving'),false);assert.equal(h.state('message'),'Client created');assert.ok(h.requests.some(r=>r.url==='/api/crm/clients/summary'));
});
withCase('clients','Client editing retains current status and refreshes detail/list/summary',async h=>{
 ready(h,'clients');h.setState('detail',{...client,status:'inactive'});h.render();await h.handlers().updateClient(event({display_name:' Synthetic updated '}));
 const request=h.requests[0];assert.equal(request.url,'/api/crm/clients/synthetic-client');assert.equal(request.options.method,'PATCH');assert.equal(JSON.parse(request.options.body).status,'inactive');assert.equal(JSON.parse(request.options.body).display_name,'Synthetic updated');
 for(const url of ['/api/crm/clients/synthetic-client/detail','/api/crm/clients?limit=30','/api/crm/clients/summary'])assert.ok(h.requests.some(r=>r.url===url));assert.equal(h.state('message'),'Client updated');
});
withCase('clients','Status change retains active/inactive toggle and PATCH payload',async h=>{
 ready(h,'clients');h.setState('detail',client);h.render();await h.handlers().changeStatus();assert.deepEqual(JSON.parse(h.requests[0].options.body),{status:'inactive'});
 h.requests.length=0;h.setState('detail',{...client,status:'inactive'});h.render();await h.handlers().changeStatus();assert.deepEqual(JSON.parse(h.requests[0].options.body),{status:'active'});assert.equal(h.state('saving'),false);
});
withCase('clients','Create failure retains form and error rather than reporting success',async h=>{
 ready(h,'clients');h.setState('createOpen',true);h.render();h.setResponse(()=>failure(422,'Synthetic validation failed'));const e=event({display_name:'Synthetic'});await h.handlers().createClient(e);
 assert.equal(h.state('error'),'Synthetic validation failed');assert.equal(h.state('createOpen'),true);assert.equal(h.state('saving'),false);assert.equal(e.currentTarget.resetCalled,undefined);assert.equal(h.requests.length,1);
});
withCase('clients','Create Cancel and drawer Close dismiss locally without API calls',h=>{
 ready(h,'clients');h.setState('createOpen',true);let tree=h.render();all(tree,'ClientForm')[0].props.onCancel();assert.equal(h.state('createOpen'),false);
 h.setState('detail',client);tree=h.render();all(tree,'ClientDrawer')[0].props.onClose();assert.equal(h.state('detail'),null);assert.equal(h.requests.length,0);
});
withCase('clients','Client editor keeps required name, current inactive source and country/currency defaults',h=>{
 const tree=h.render({meta:{...meta,sources:[source,{...source,id:'inactive',is_active:false}]},detail:{...client,acquisition_source_id:'inactive'},saving:false,onSubmit(){},onCancel(){}});
 assert.equal(all(tree,'Field').find(n=>n.props.name==='display_name').props.required,true);
 const sources=all(tree,'SearchableSelect').find(n=>n.props.name==='acquisition_source_id');assert.ok(sources.props.options.some(n=>n.value==='inactive'&&n.label.includes('Inactive')));
 assert.equal(all(tree,'SearchableSelect').find(n=>n.props.name==='currency').props.defaultValue,'BDT');assert.equal(button(tree,'Save changes').props.disabled,false);
},'ClientForm');
withCase('clients','Client list View uses encoded detail route and edit arrival reads only the requested record',async h=>{
 ready(h,'clients');h.setState('clients',[{...client,id:'synthetic/id'}]);let tree=h.render();const directory=all(tree,'ClientDirectory')[0];const rows=directory.type(directory.props);button(rows,'View').props.onClick();assert.deepEqual(h.navigation,[['push','/dashboard/clients/synthetic%2Fid']]);
 global.window.location.search='?edit=synthetic-client';tree=h.render();h.effects[3]();await settle();assert.ok(h.requests.some(r=>r.url==='/api/crm/clients/synthetic-client/detail'));assert.ok(tree);
});
withCase('clients','Cancelled metadata load cannot populate a dismissed client list effect',async h=>{
 h.render();const pending=[];h.setResponse(()=>new Promise(resolve=>pending.push(resolve)));const cancel=h.effects[1]();cancel();pending[0](success({total:20}));pending[1](success(meta));await settle();assert.equal(h.state('meta'),null);assert.equal(h.state('summary'),null);
});
withCase('clients','Extracted directory retains client/contact/ownership/status/portal data and View/Edit callbacks',h=>{
 const viewed=[],edited=[];
 const record={...client,assigned_employee_name:'Synthetic owner'};
 const tree=h.render({canEdit:true,clients:[record],portalAccess:{[client.id]:portal},canManage:false,workingId:null,onToggle:async()=>{},onView:value=>viewed.push(value.id),onEdit:value=>edited.push(value.id)});
 for(const value of [client.display_name,client.client_code,client.contact_name,client.email,'Synthetic owner','BD','BDT'])assert.ok(label(tree).includes(value),value);
 assert.equal(all(tree,'Status')[0].props.status,'active');
 const portalWidget=all(tree,'PortalAccessToggle')[0];assert.deepEqual(portalWidget.props.status,portal);assert.equal(portalWidget.props.canManage,false);
 assert.equal(all(tree,'th').filter(n=>n.props.scope==='col').length,5);
 button(tree,'View').props.onClick();button(tree,'Edit').props.onClick();button(tree,client.display_name).props.onClick();
 assert.deepEqual(viewed,[client.id,client.id]);assert.deepEqual(edited,[client.id]);assert.equal(h.requests.length,0);
},'ClientDirectory');
withCase('clients','Client editor preserves inactive quotation lock, pending status lock and named Close control',h=>{
 const closed=[];
 const tree=h.render({detail:{...client,status:'inactive'},loading:false,meta,saving:true,onClose:()=>closed.push(true),onSave(){},onStatus(){},onQuotation(){}});
 assert.equal(button(tree,'Quotation').props.disabled,true);assert.equal(button(tree,'Activate').props.disabled,true);
 const close=all(tree,'button').find(n=>n.props['aria-label']==='Close client editor');assert.ok(close);close.props.onClick();assert.deepEqual(closed,[true]);assert.equal(h.requests.length,0);
},'ClientDrawer');
for(const [kind,name] of [['crm','Modal'],['clients','Modal']])withCase(kind,`${kind}: modal backdrop only dismisses an outside click without a mutation`,h=>{
 const closed=[];const tree=h.render({title:'Synthetic form',onClose:()=>closed.push(true),children:'Synthetic contents'}),outside={};
 if(kind==='crm'){assert.equal(tree.type,'CrmDialog');assert.equal(tree.props.label,'Synthetic form');assert.notEqual(tree.props.closeOnBackdrop,false);tree.props.onClose();assert.deepEqual(closed,[true]);assert.equal(h.requests.length,0);return;}
 tree.props.onMouseDown({target:{},currentTarget:outside});assert.equal(closed.length,0);
 tree.props.onMouseDown({target:outside,currentTarget:outside});assert.equal(closed.length,1);assert.equal(h.requests.length,0);
},name);

withCase('detail','Client workspace request preserves encoded ID, limit 50 and no-store',async h=>{
 h.setParams({clientId:'synthetic/id'});h.setResponse(()=>success({...workspace,client:{...client,id:'synthetic/id'}}));h.render();await h.handlers().load();assert.equal(h.requests[0].url,'/api/crm/clients/synthetic%2Fid/workspace?limit=50');assert.deepEqual(h.requests[0].options,{cache:'no-store'});assert.equal(h.state('loading'),false);assert.equal(h.state('workspace').client.id,'synthetic/id');
});
for(const code of [401,403])withCase('detail',`Client detail ${code} retains login/error behavior and back route`,async h=>{
 h.render();h.setResponse(()=>failure(code));await h.handlers().load();const tree=h.render();assert.equal(h.state('loading'),false);assert.deepEqual(h.navigation,code===401?[['replace','/login']]:[]);if(code===403)assert.equal(h.state('error'),'Synthetic denial');assert.ok(all(tree,'a').some(n=>n.props.href==='/dashboard/clients'));
});
withCase('detail','Default tab is Overview and access masks Sales/Projects/Finance menu entries',h=>{
 ready(h,'detail');assert.equal(h.state('tab'),'overview');assert.equal(h.handlers().tabs.length,10);
 h.setState('workspace',{...workspace,access:Object.fromEntries(Object.keys(access).map(key=>[key,false]))});h.render();assert.deepEqual(h.handlers().tabs.map(n=>n.value),['overview','activity','access','services','notes','documents','credentials']);
});
withCase('detail','Client actions retain management masks, active-state guard and encoded existing destinations',h=>{
 ready(h,'detail');h.setParams({clientId:'synthetic/id'});h.setState('workspace',{...workspace,client:{...client,id:'synthetic/id'}});let links=all(h.render(),'a').map(n=>n.props.href);
 for(const route of ['/dashboard/clients?edit=synthetic%2Fid','/dashboard/quotations?client_id=synthetic%2Fid','/dashboard/accounting/invoices?client_id=synthetic%2Fid'])assert.ok(links.includes(route));
 h.setParams({clientId:client.id});h.setState('workspace',{...workspace,client:{...client,status:'inactive'}});links=all(h.render(),'a').map(n=>n.props.href);assert.ok(links.some(n=>n.includes('?edit=')));assert.equal(links.some(n=>n.includes('?client_id=')),false);
 h.setState('workspace',{...workspace,access:Object.fromEntries(Object.keys(access).map(key=>[key,false]))});links=all(h.render(),'a').map(n=>n.props.href);assert.equal(links.some(n=>n.includes('?edit=')||n.includes('?client_id=')),false);
});
withCase('detail','Counts and financial rows receive existing access restrictions without combining currencies',h=>{
 ready(h,'detail');h.setState('workspace',{...workspace,access:{...access,orders:false,finance:false,projects:false,quotations:false}});const tree=h.render();
 assert.ok(all(tree,'CountCard').filter(n=>n.props.label!=='Relationship').every(n=>n.props.restricted));assert.equal(all(tree,'MoneyCard')[0].props.restricted,true);
 assert.ok(all(tree,'InvoiceMoneyCard').every(n=>n.props.restricted));assert.deepEqual(all(tree,'InvoiceMoneyCard')[0].props.rows,workspace.invoice_summary);
 const money=h.helpers.MoneyCard({title:'Synthetic',icon:'i',rows:workspace.business_value,restricted:true});assert.match(label(money),/Restricted by role/);assert.doesNotMatch(label(money),/USD 100/);
 const visible=h.helpers.MoneyCard({title:'Synthetic',icon:'i',rows:workspace.business_value,restricted:false});assert.match(label(visible),/USD 100.00/);assert.match(label(visible),/BDT 200.00/);assert.doesNotMatch(label(visible),/300.00/);
});
withCase('detail','Resource tabs preserve client ID and management flags without fetching resources during parent render',h=>{
 ready(h,'detail');h.setState('workspace',{...workspace,access:{...access,clients_manage:false}});
 for(const [tab,component] of [['notes','ClientNotesSection'],['documents','ClientDocumentsSection'],['credentials','ClientCredentialsSection']]){h.setState('tab',tab);const child=all(h.render(),component)[0];assert.equal(child.props.clientId,client.id);assert.equal(child.props.canManage,false);}
 assert.equal(h.requests.length,0);
});
withCase('detail','Finance presentation keeps invoice and receiving currencies separate and retains encoded invoice route',h=>{
 const payment={id:'synthetic-payment',payment_number:'SYN-PAY',invoice_id:'synthetic/invoice',invoice_number:'SYN-INV',payment_date:'2026-10-24',invoice_currency:'USD',invoice_amount:'20',account_currency:'BDT',account_amount:'2400',method:'bank_transfer',reference:null};
 const tree=h.render({invoices:[],payments:[payment]});assert.match(label(tree),/USD 20.00/);assert.match(label(tree),/BDT 2,400.00/);assert.ok(all(tree,'a').every(n=>n.props.href==='/dashboard/finance/invoices/synthetic%2Finvoice'));
},'FinanceTab');
withCase('detail','Empty project/finance/activity panels retain explicit empty-state messages',h=>{
 assert.ok(all(h.helpers.ProjectsTab({projects:[]}),'Empty').some(n=>/No projects/.test(n.props.text)));
 assert.equal(all(h.helpers.FinanceTab({invoices:[],payments:[]}),'Empty').length,2);
 assert.ok(all(h.helpers.ActivityTab({events:[]}),'Empty').some(n=>/No activity/.test(n.props.text)));
});

withCase('detail','Client workspace ignores older success and old authentication failure after route switch',async h=>{
 h.render();const pending=[];h.setResponse(()=>new Promise(resolve=>pending.push(resolve)));
 const old=h.handlers().load();h.setParams({clientId:'new-client'});h.render();const current=h.handlers().load();
 pending[1](success({...workspace,client:{...client,id:'new-client'}}));await current;
 pending[0](failure(401));await old;assert.equal(h.state('workspace').client.id,'new-client');assert.deepEqual(h.navigation,[]);assert.equal(h.state('error'),null);
});
withCase('detail','Client workspace suppresses prior route data and rejects a mismatched response',async h=>{
 ready(h,'detail');h.setParams({clientId:'other-client'});assert.doesNotMatch(label(h.render()),/Synthetic client/);
 await h.handlers().load();assert.equal(h.state('workspace'),null);assert.match(h.state('error'),/does not match/);assert.ok(button(h.render(),'Retry client workspace'));
});
withCase('detail','Client workspace cleanup invalidates pending reads',async h=>{
 h.render();let resolve;h.setResponse(()=>new Promise(r=>resolve=r));const cleanup=h.effects[0]();cleanup();resolve(success(workspace));await settle();assert.equal(h.state('workspace'),null);
});
withCase('clients','Client editor latest selection wins and dismiss invalidates late success or auth errors',async h=>{
 h.render();const pending=[];h.setResponse(()=>new Promise(resolve=>pending.push(resolve)));
 const old=h.handlers().openClient('old'),current=h.handlers().openClient('new');
 pending[1](success({...client,id:'new'}));await current;pending[0](success({...client,id:'old'}));await old;assert.equal(h.state('detail').id,'new');
 const late=h.handlers().openClient('late');h.handlers().closeClient();pending[2](failure(401));await late;
 assert.equal(h.state('detail'),null);assert.equal(h.state('detailLoading'),false);assert.deepEqual(h.navigation,[]);assert.equal(h.state('error'),null);
});
withCase('clients','Client validation arrays are readable and form retains values for retry',async h=>{
 h.render();h.setResponse(()=>failure(422,[{loc:['body','display_name'],msg:'Value error, display_name cannot be null',type:'value_error'}]));
 await h.handlers().createClient(event({display_name:'   ',client_type:'company'}));assert.match(h.state('error'),/display_name cannot be null/);assert.doesNotMatch(h.state('error'),/object Object/);assert.equal(h.state('saving'),false);
});
withCase('clients','Client form exposes inline validation and internationally usable phone limits',h=>{
 const tree=h.render({meta,detail:client,saving:false,error:'Display name is required',onSubmit(){}});
 assert.equal(label(all(tree,'p').find(n=>n.props.role==='alert')),'Display name is required');
 const fields=all(tree,'Field');for(const name of ['phone','whatsapp']){const field=fields.find(n=>n.props.name===name);assert.equal(field.props.type,'tel');}
},'ClientForm');
withCase('clients','International phone field keeps stable accessible name and backend-aligned limit',h=>{
 const tree=h.render({label:'Phone',name:'phone',type:'tel'}),input=all(tree,'input')[0];assert.equal(input.props['aria-label'],'Phone');assert.equal(input.props.maxLength,64);assert.equal(input.props.type,'tel');assert.match(label(tree),/country code/);
},'Field');
withCase('detail','Client exact financial formatter preserves large cents and viewer timezone is explicit',h=>{
 assert.equal(h.helpers.money('99999999999999.99','GBP'),'GBP 99,999,999,999,999.99');assert.match(h.helpers.dateTime('2026-10-24T12:00:00Z'),/UTC|GMT|[A-Z]{2,5}$/);
});
withCase('clients','Client viewer sees read-only guidance and cannot invoke manage handlers',async h=>{
 h.setTenant({is_owner:false,permissions:['clients.view']});ready(h,'clients');h.setState('clients',[client]);h.setState('detail',client);const tree=h.render();
 assert.equal(button(tree,'Add client'),undefined);assert.match(label(tree),/Read-only client directory/);assert.equal(all(tree,'ClientDrawer').length,0);
 const directory=all(tree,'ClientDirectory')[0];assert.equal(directory.props.canEdit,false);assert.equal(button(directory.type(directory.props),'Edit'),undefined);
 await h.handlers().openClient(client.id);await h.handlers().createClient(event({display_name:'No write'}));await h.handlers().updateClient(event({display_name:'No write'}));await h.handlers().changeStatus();assert.equal(h.requests.length,0);
});
withCase('clients','Client manager without owner status retains permitted editing',async h=>{
 h.setTenant({is_owner:false,permissions:['clients.view','clients.manage']});ready(h,'clients');assert.ok(button(h.render(),'Add client'));await h.handlers().openClient(client.id);assert.equal(h.state('detail').id,client.id);
});
withCase('clients','Client localization defaults apply to create only and cleared edit values stay empty',h=>{
 let tree=h.render({meta,saving:false,onSubmit(){}});let selects=all(tree,'SearchableSelect');assert.equal(selects.find(n=>n.props.name==='country_code').props.defaultValue,'BD');assert.equal(selects.find(n=>n.props.name==='currency').props.defaultValue,'BDT');
 tree=h.render({meta,detail:{...client,country_code:null,currency:null},saving:false,onSubmit(){}});selects=all(tree,'SearchableSelect');assert.equal(selects.find(n=>n.props.name==='country_code').props.defaultValue,'');assert.equal(selects.find(n=>n.props.name==='currency').props.defaultValue,'');
},'ClientForm');
withCase('clients','Pending client save blocks duplicate mutation and close without automatic retries',async h=>{
 h.render();await h.handlers().openClient(client.id);h.render();let release;h.setResponse(()=>new Promise(resolve=>release=resolve));
 const write=h.handlers().updateClient(event({display_name:'Edited'}));const before=h.requests.length;h.handlers().closeClient();await h.handlers().updateClient(event({display_name:'Duplicate'}));await h.handlers().changeStatus();assert.equal(h.requests.length,before);assert.equal(h.state('detail').id,client.id);
 release(failure(422,[{loc:['body','display_name'],msg:'Rejected synthetic change'}]));await write;assert.equal(h.state('saving'),false);assert.match(h.state('error'),/Rejected synthetic change/);h.handlers().closeClient();assert.equal(h.state('detail'),null);
});
withCase('clients','Client wildcard authorization matches existing tenant shell policy',h=>{
 h.setTenant({is_owner:false,permissions:['*']});ready(h,'clients');assert.ok(button(h.render(),'Add client'));
});
for(const manage of [false,true])withCase('clients',`Client ${manage?'manager':'viewer'} initialization preserves existing metadata boundary and skips unused reads`,async h=>{
 h.setTenant({is_owner:false,permissions:manage?['clients.view','clients.manage']:['clients.view']});h.render();const cleanup=h.effects[1]();await settle();
 assert.deepEqual(h.requests.map(r=>r.url).sort(),manage?['/api/crm/clients/summary','/api/crm/meta']:['/api/crm/clients/summary']);assert.equal(h.state('error'),null);assert.equal(h.state('summary').total,1);if(!manage)assert.equal(h.state('meta'),null);cleanup();
});
withCase('clients','Older client-directory authentication failure cannot redirect newer results',async h=>{
 h.render();const pending=[];h.setResponse(url=>url.startsWith('/api/client-access')?success({can_manage:false,items:[]}):new Promise(resolve=>pending.push(resolve)));
 const old=h.handlers().loadList(),current=h.handlers().loadList();pending[1](success({items:[],next_cursor:null}));await current;pending[0](failure(401));await old;assert.deepEqual(h.navigation,[]);assert.equal(h.state('error'),null);
});
