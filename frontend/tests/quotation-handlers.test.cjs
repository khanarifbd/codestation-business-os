/** Synthetic quotation handlers/render trees only. All requests, confirmations and print/navigation are mocked. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const file='src/app/dashboard/quotations/quotation-v2-workspace.tsx';
const success=value=>({ok:true,status:200,json:async()=>value});
const failure=(status,detail='Synthetic failure')=>({ok:false,status,json:async()=>({detail})});
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
const meta={default_currency:'USD',default_tax_calculation_mode:'exclusive',default_tax_rate:'5',default_validity_days:30,employees:[]};
const client={id:'synthetic-client',client_code:'SYN-C',display_name:'Synthetic client',currency:'BDT',contact_name:'Synthetic contact'};
const draftItem={product_id:null,lead_interest_id:null,item_name:'Synthetic service',item_type:'service',unit:'hour',description:'Synthetic work',quantity:2,unit_price:100,discount_percent:10,tax_rate:5};
const core={id:'synthetic-quote',quotation_number:'SYN-Q',client_id:client.id,client_name:client.display_name,client_name_snapshot:client.display_name,status:'draft',is_expired:false,subject:'Synthetic scope',issue_date:'2026-10-25',valid_until:'2026-11-24',currency:'USD',total:'189.00',subtotal:'200',discount_total:'20',tax_total:'9',source_lead_id:null,tax_calculation_mode:'exclusive',assigned_employee_id:null,internal_notes:null,items:[{id:'synthetic-item',product_id:null,lead_interest_id:null,sort_order:0,item_name_snapshot:'Synthetic service',item_type_snapshot:'service',unit_snapshot:'hour',description:'Synthetic work',quantity:'2',unit_price:'100',discount_percent:'10',tax_rate:'5',line_total:'189'}]};
const proposal={...core,revision_number:1,revision_reason:null,project_title:'Synthetic project',executive_summary:null,estimated_start_date:null,estimated_end_date:null,estimated_duration:null,start_condition:null,sections:[],milestones:[],payment_milestones:[]};
function all(node,type,out=[]){if(Array.isArray(node))node.forEach(n=>all(n,type,out));else if(node?.props){if(node.type===type||node.type?.name===type)out.push(node);for(const v of Object.values(node.props))if(Array.isArray(v)||v?.props)all(v,type,out);}return out;}
function label(node){if(node==null||typeof node==='boolean')return'';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(label).join(' ');return label(node.props?.children);}
function jsx(node){let found=false;function visit(n){if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n))found=true;ts.forEachChild(n,visit);}visit(node);return found;}
function harness(name='QuotationV2Workspace', options={}){
 const activeFile=options.file||file;const filename=path.join(root,activeFile);let source=fs.readFileSync(filename,'utf8');const ast=ts.createSourceFile(activeFile,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const functions=ast.statements.filter(ts.isFunctionDeclaration);const fn=functions.find(n=>n.name?.text===name);assert.ok(fn,name);const names=fn.body.statements.filter(ts.isVariableStatement).flatMap(n=>n.declarationList.declarations).filter(n=>ts.isArrayBindingPattern(n.name)&&n.initializer?.getText(ast).startsWith('useState')).map(n=>n.name.elements[0].name.text);
 const firstRender=fn.body.statements.find(jsx);const beforeRender=fn.body.statements.slice(0,fn.body.statements.indexOf(firstRender));
 const exposed=beforeRender.flatMap(statement=>ts.isFunctionDeclaration(statement)?[statement.name.text]:ts.isVariableStatement(statement)?statement.declarationList.declarations.flatMap(d=>ts.isIdentifier(d.name)?[d.name.text]:[]):[]);
 const renderStart=fn.body.statements.find(jsx).getStart(ast);source=source.slice(0,renderStart)+'__handlers={'+exposed.join(',')+'};\n'+source.slice(renderStart);source+='\nlet __handlers;export const getHandlers=()=>__handlers;export const __test={'+functions.map(n=>n.name.text).join(',')+'};';
 let tenant={is_owner:true,permissions:['quotations.view','quotations.manage','orders.manage']};
 const states=[],refs=[],effects=[],requests=[],navigation=[],opened=[],confirmations=[];let cursor=0,refCursor=0,confirmResult=true;let renderProps={mode:'edit',quotationId:core.id,...options.props};let searchParams=new URLSearchParams();let pathname='/dashboard/quotations/'+core.id+'/edit';const guardCalls=[];const router={replace:url=>navigation.push(['replace',url]),push:url=>navigation.push(['push',url]),back:()=>navigation.push(['back']),refresh:()=>navigation.push(['refresh'])};
 const defaultResponse=(url)=>success(url.endsWith('/meta')?meta:url.endsWith('/summary')?{total:1,draft:1,sent:0,accepted:0,rejected:0,cancelled:0}:url.includes('/client-options?')?[client]:url.includes('/catalog-options?')?[]:url.endsWith('/commercial')?proposal:url.endsWith('/revisions')?[]:url.includes('/quotations?')?{items:[core],next_cursor:null}:core);let respond=defaultResponse;
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod.require=id=>{
  if(id==='react')return{Suspense:'Suspense',useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef:initial=>{const i=refCursor++;return refs[i]??={current:initial};},useEffect:fn=>effects.push(fn),useMemo:fn=>fn(),useCallback:fn=>fn};
  if(id==='next/navigation')return{useRouter:()=>router,useSearchParams:()=>searchParams,usePathname:()=>pathname,useParams:()=>({quotationId:renderProps.quotationId})};
  if(id==='@/hooks/use-quotation-navigation-guard')return{useQuotationNavigationGuard:(dirty,options={})=>{guardCalls.push({kind:'state',dirty,options});return{confirmLeave:()=>!dirty||confirmResult,markClean:()=>guardCalls.push({kind:'clean'}),navigate:(url,opts={})=>{guardCalls.push({kind:'navigate',url,options:opts});if(!opts.discard&&dirty&&!confirmResult)return false;navigation.push(['navigate',url,opts]);return true;}};}};
  if(id==='@/components/dashboard-session-context')return{useDashboardSession:()=>({tenant})};
  if(id==='next/link')return{default:'a'};if(id.endsWith('.css'))return{};if(id.startsWith('@/components/'))return new Proxy({},{get:(_t,key)=>String(key)});
  if(id.startsWith('@/lib/')){function local(p){const m=new Module(p,module);m.filename=p;m.paths=module.paths;m.require=child=>child.startsWith('.')?local(path.resolve(path.dirname(p),child+'.ts')):require(child);m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,p);return m.exports;}return local(path.join(root,'src',id.slice(2)+'.ts'));}
  return require(id);
 };mod._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,filename);
 const original={fetch:global.fetch,window:global.window,Date:global.Date};global.fetch=async(url,options)=>{requests.push({url,options});return respond(url,options);};global.window={location:{search:'',origin:'https://example.invalid',assign:url=>navigation.push(['assign',url]),replace:url=>navigation.push(['location-replace',url])},confirm:text=>{confirmations.push(text);return confirmResult;},open:(...args)=>opened.push(args)};global.Date=class extends original.Date{constructor(...args){super(...(args.length?args:['2026-10-25T12:00:00Z']));}static now(){return new original.Date('2026-10-25T12:00:00Z').getTime();}};
 return{effects,requests,navigation,opened,confirmations,guardCalls,setTenant:value=>{tenant=value;},setProps:value=>{renderProps={...renderProps,...value};},setQuery:value=>{searchParams=new URLSearchParams(value);global.window.location.search=searchParams.toString()?'?'+searchParams.toString():'';},setPathname:value=>{pathname=value;},helpers:mod.exports.__test,handlers:()=>mod.exports.getHandlers(),render:props=>{cursor=0;refCursor=0;effects.length=0;return mod.exports.__test[name]({...renderProps,...props});},state:key=>states[names.indexOf(key)],setState:(key,v)=>{const i=names.indexOf(key);assert.ok(i>=0,key);states[i]=v;},setResponse:fn=>{respond=fn;},defaultResponse,setConfirm:v=>{confirmResult=v;},cleanup:()=>Object.assign(global,original)};
}
function withCase(title,check,name){test(title,async()=>{const h=harness(name);try{await check(h);}finally{h.cleanup();}});}
const button=(tree,text)=>all(tree,'button').find(n=>label(n).replace(/\s+/g,' ').trim()===text);
function effect(h,pattern){const fn=h.effects.find(f=>pattern.test(f.toString()));assert.ok(fn,`effect ${pattern}`);return fn();}
function markBaseline(h){h.render();effect(h,/setCleanSnapshot/);return h.render();}
function ready(h,status='draft',mode='edit'){h.setProps({mode});h.render();h.setState('meta',meta);h.handlers().applyCore({...core,status});h.handlers().applyCommercial({...proposal,status});h.setState('loadingQuotation',false);h.setState('draftReady',true);return markBaseline(h);}
function validNew(h){h.setProps({mode:'create',quotationId:undefined});h.render();h.setState('meta',meta);h.render();h.handlers().startNew(client);h.setState('draftReady',true);markBaseline(h);h.setState('currency','USD');h.setState('items',[{...draftItem}]);h.setState('subject',' Synthetic scope ');return h.render();}
for(const status of [401,403])withCase(`Sales API ${status} retains authentication/role handling`,async h=>{h.render();h.setResponse(()=>failure(status));await assert.rejects(()=>h.handlers().api('/quotations'),status===401?/Authentication required/:/permission to manage quotations/);assert.deepEqual(h.navigation,status===401?[['replace','/login']]:[]);});
withCase('Structured validation errors retain message text without object coercion',h=>{assert.equal(h.helpers.errorMessage({detail:[{msg:'First'},{msg:'Second'}]},'fallback'),'First Second');assert.equal(h.helpers.errorMessage(null,'fallback'),'fallback');assert.equal(h.helpers.errorMessage({detail:'Denied'},'fallback'),'Denied');});
withCase('Detail load keeps three encoded endpoints and hydrates numeric snapshots',async h=>{h.render();await h.handlers().loadQuotation('synthetic/id');assert.deepEqual(h.requests.map(r=>r.url),['/api/sales/quotations/synthetic%2Fid','/api/sales/quotations/synthetic%2Fid/commercial','/api/sales/quotations/synthetic%2Fid/revisions']);assert.equal(h.state('items')[0].quantity,'2');assert.equal(h.state('items')[0].unit_price,'100');assert.equal(h.state('loadingQuotation'),false);assert.equal(h.state('creating'),false);});
withCase('Failed detail load clears stale core/commercial/revisions and releases pending state',async h=>{ready(h);h.setState('revisions',[proposal]);h.setResponse(()=>failure(404,'Synthetic not found'));await h.handlers().loadQuotation('missing');assert.equal(h.state('core'),null);assert.equal(h.state('proposal'),null);assert.deepEqual(h.state('revisions'),[]);assert.equal(h.state('error'),'Synthetic not found');assert.equal(h.state('loadingQuotation'),false);});
withCase('Commercial hydration preserves milestone links, visibility and numeric payment values',h=>{h.render();h.handlers().applyCommercial({...proposal,sections:[{section_type:'scope',title:null,content:'Synthetic scope',is_visible:false}],milestones:[{id:'m1',title:'Synthetic milestone',description:null}],payment_milestones:[{quotation_milestone_id:'m1',title:'Payment',payment_type:'percentage',percentage:'50',amount:'94.5',description:null}]});assert.equal(h.state('sections')[0].is_visible,false);assert.equal(h.state('milestones')[0].source_id,'m1');assert.equal(h.state('payments')[0].milestone_index,0);assert.equal(h.state('payments')[0].percentage,'50');assert.equal(h.state('payments')[0].amount,'94.5');});
withCase('New draft defaults preserve client currency, tax defaults and validity dates',h=>{h.render();h.handlers().startNew();assert.equal(h.state('creating'),false);h.setState('meta',meta);h.render();h.handlers().startNew(client);assert.equal(h.state('currency'),'BDT');assert.equal(h.state('issueDate'),'2026-10-25');assert.equal(h.state('validUntil'),'2026-11-24');assert.equal(h.state('items')[0].tax_rate,'5');assert.equal(h.state('sourceLeadId'),null);assert.deepEqual(h.state('payments'),[]);assert.equal(h.state('tab'),'pricing');});
withCase('Currency change Cancel preserves work; confirmed change clears line and lead linkage',h=>{validNew(h);h.setState('sourceLeadId','synthetic-lead');h.render();h.setConfirm(false);h.handlers().changeCurrency('EUR');assert.equal(h.state('currency'),'USD');assert.equal(h.state('items')[0].item_name,'Synthetic service');h.setConfirm(true);h.handlers().changeCurrency('EUR');assert.equal(h.state('currency'),'EUR');assert.equal(h.state('sourceLeadId'),null);assert.equal(h.state('items')[0].item_name,'');assert.equal(h.confirmations.length,2);assert.equal(h.requests.length,0);});
withCase('Selecting current currency is inert and catalog selection retains product snapshots',h=>{validNew(h);h.handlers().changeCurrency('USD');assert.equal(h.confirmations.length,0);h.setState('catalog',[{id:'product',sku:'SYN',name:'Catalog service',description:null,item_type:'service',unit:'hour',currency:'USD',selling_price:'25.50',tax_rate:null}]);h.render();h.handlers().selectLineSource(0,'catalog:product');assert.equal(h.state('items')[0].product_id,'product');assert.equal(h.state('items')[0].unit_price,'25.50');assert.equal(h.state('items')[0].tax_rate,0);assert.equal(h.state('items')[0].description,'Catalog service');h.render();h.handlers().selectLineSource(0,'custom:non_stock_item');assert.equal(h.state('items')[0].product_id,null);assert.equal(h.state('items')[0].item_type,'non_stock_item');});
withCase('Exclusive and inclusive preview calculations retain discount-before-tax math',h=>{const exclusive=h.helpers.previewLine(draftItem,'exclusive'),inclusive=h.helpers.previewLine(draftItem,'inclusive');assert.deepEqual(exclusive,{subtotal:'200.00',discount:'20.00',tax:'9.00',total:'189.00'});assert.equal(inclusive.subtotal,'200.00');assert.equal(inclusive.discount,'20.00');assert.equal(inclusive.total,'180.00');assert.equal(inclusive.tax,'8.57');const included=h.helpers.previewLine({...draftItem,quantity:1,unit_price:110,discount_percent:0,tax_rate:10},'inclusive');assert.equal(included.total,'110.00');assert.equal(included.tax,'10.00');});
withCase('Unsaved draft totals refresh from current lines and tax mode, immutable totals use server snapshot',h=>{ready(h);h.setState('items',[{...draftItem,unit_price:200}]);h.render();assert.equal(h.handlers().documentTotal,'378.00');h.setState('taxMode','inclusive');h.render();assert.equal(h.handlers().documentTotal,'360.00');h.setState('core',{...core,status:'sent',total:'999.99'});h.render();assert.equal(h.handlers().editable,false);assert.equal(h.handlers().documentTotal,'999.99');});
withCase('Percentage and fixed schedules retain document-total basis and reconciliation difference',h=>{validNew(h);h.setState('payments',[{...h.helpers.blankPayment(),title:'Half',percentage:50},{...h.helpers.blankPayment(),title:'Remaining',payment_type:'fixed',amount:94.5}]);h.render();assert.equal(h.handlers().scheduledTotal,'189.00');assert.equal(h.handlers().scheduleDifference,'0.00');assert.equal(h.handlers().validateDraft(),true);});
const validationCases=[['missing client',{clientId:''},'pricing',/Select a client/],['validity before issue',{validUntil:'2026-10-01'},'pricing',/Valid-until/],['empty item',{items:[]},'pricing',/pricing line/],['zero quantity',{items:[{...draftItem,quantity:0}]},'pricing',/pricing line/],['negative price',{items:[{...draftItem,unit_price:-1}]},'pricing',/pricing line/],['discount above 100',{items:[{...draftItem,discount_percent:101}]},'pricing',/pricing line/],['tax above 100',{items:[{...draftItem,tax_rate:101}]},'pricing',/pricing line/],['project dates',{estimatedStartDate:'2026-10-26',estimatedEndDate:'2026-10-25'},'overview',/end date/],['empty section',{sections:[{...hBlankSection(),content:'   '}]},'sections',/contain content/],['unnamed milestone',{milestones:[{title:'',estimated_start_date:'',estimated_end_date:''}]},'delivery',/delivery milestones/],['invalid payment',{payments:[{title:'Invalid',payment_type:'percentage',percentage:0}]},'payments',/valid percentage/],['schedule mismatch',{payments:[{title:'Mismatch',payment_type:'fixed',amount:100}]},'payments',/must equal/]];
function hBlankSection(){return{section_type:'scope',title:'Scope',content:'',is_visible:true};}
for(const [name,patch,tab,pattern] of validationCases)withCase(`Validation rejects ${name} locally and focuses ${tab}`,async h=>{validNew(h);for(const [key,value]of Object.entries(patch))h.setState(key,value);h.render();await h.handlers().saveDraft();assert.equal(h.requests.length,0);assert.equal(h.state('tab'),tab);assert.match(h.state('error'),pattern);});
withCase('Payment schedule rejects a one-cent mismatch exactly like backend',h=>{validNew(h);h.setState('payments',[{title:'Almost',payment_type:'fixed',amount:188.99}]);h.render();assert.equal(h.handlers().validateDraft(),false);h.setState('payments',[{title:'Outside tolerance',payment_type:'fixed',amount:188.98}]);h.render();assert.equal(h.handlers().validateDraft(),false);});
withCase('Create draft preserves exact core payload, commercial payload and revision/list refresh',async h=>{validNew(h);h.setState('sourceLeadId','synthetic-lead');h.setState('internalNotes',' Internal only ');h.setState('sections',[{section_type:'scope',title:' Scope ',content:' Synthetic scope ',is_visible:false}]);h.setState('milestones',[{...h.helpers.blankMilestone(),title:' Delivery ',description:' Milestone ',acceptance_criteria:' Approved '}]);h.setState('payments',[{...h.helpers.blankPayment(),title:' All ',percentage:100,milestone_index:0}]);h.render();await h.handlers().saveDraft();const coreRequest=h.requests[0],commercial=h.requests[1];assert.equal(coreRequest.url,'/api/sales/quotations');assert.equal(coreRequest.options.method,'POST');assert.deepEqual(JSON.parse(coreRequest.options.body),{client_id:client.id,source_lead_id:'synthetic-lead',subject:'Synthetic scope',issue_date:'2026-10-25',valid_until:'2026-11-24',currency:'USD',tax_calculation_mode:'exclusive',assigned_employee_id:null,notes:null,terms_conditions:null,internal_notes:'Internal only',items:[{...draftItem,quantity:'2',unit_price:'100',discount_percent:'10',tax_rate:'5'}]});assert.equal(commercial.url,'/api/sales/quotations/synthetic-quote/commercial');assert.equal(commercial.options.method,'PATCH');assert.deepEqual(JSON.parse(commercial.options.body),{project_title:'Synthetic scope',executive_summary:null,estimated_start_date:null,estimated_end_date:null,estimated_duration:null,start_condition:null,sections:[{section_type:'scope',title:'Scope',content:'Synthetic scope',sort_order:0,is_visible:false}],milestones:[{title:'Delivery',description:'Milestone',estimated_start_date:null,estimated_end_date:null,estimated_duration:null,acceptance_criteria:'Approved',sort_order:0}],payment_milestones:[{quotation_milestone_index:0,title:'All',description:null,payment_type:'percentage',percentage:'100',amount:null,due_condition:null,due_date:null,sort_order:0}]});assert.equal(h.state('saving'),false);assert.equal(h.state('creating'),false);assert.match(h.state('message'),/saved as draft/);assert.equal(h.requests.length,2);assert.ok(h.navigation.some(n=>n[0]==='navigate'&&n[1].includes('/synthetic-quote?')));});
withCase('Existing draft updates use PATCH without resubmitting client/source identifiers',async h=>{ready(h);h.setState('taxMode','inclusive');h.render();await h.handlers().saveDraft();assert.equal(h.requests[0].url,'/api/sales/quotations/synthetic-quote');assert.equal(h.requests[0].options.method,'PATCH');const body=JSON.parse(h.requests[0].options.body);assert.equal(body.tax_calculation_mode,'inclusive');assert.equal('client_id'in body,false);assert.equal('source_lead_id'in body,false);});
withCase('Immutable quotation cannot invoke draft save and never makes a mutation',async h=>{ready(h,'sent');await h.handlers().saveDraft();assert.equal(h.requests.length,0);});
for(const [status,expected]of [['draft',['Mark sent','Cancel quotation']],['sent',['Accept','Reject','Cancel quotation','Create revision']],['accepted',['Create / view order']],['rejected',['Create revision']],['cancelled',['Create revision']]])withCase(`${status} exposes only the existing lifecycle actions`,h=>{const tree=ready(h,status,'view');assert.deepEqual(all(tree,'Action').map(n=>n.props.label),expected);assert.equal(Boolean(button(tree,'Save draft')),false);});
withCase('Status change retains status payload and reloads authoritative snapshots',async h=>{ready(h,'draft','view');h.setResponse(url=>success(url.endsWith('/revisions')?[]:url.endsWith('/commercial')?{...proposal,status:'sent'}:{...core,status:'sent'}));await h.handlers().changeStatus('sent');assert.equal(h.requests[0].url,'/api/sales/quotations/synthetic-quote/status');assert.deepEqual(JSON.parse(h.requests[0].options.body),{status:'sent'});assert.equal(h.requests[0].options.method,'PATCH');assert.ok(h.requests.some(r=>r.url.endsWith('/commercial')));assert.match(h.state('message'),/marked sent/);assert.equal(h.state('saving'),false);});
withCase('Revision validation blocks empty reason and inverted dates before requests',async h=>{ready(h,'sent','view');await h.handlers().createRevision();assert.equal(h.requests.length,0);assert.match(h.state('error'),/reason/);h.setState('revisionReason','Synthetic reason');h.setState('revisionIssueDate','2026-10-25');h.setState('revisionValidUntil','2026-10-01');h.render();await h.handlers().createRevision();assert.equal(h.requests.length,0);assert.match(h.state('error'),/before the issue date/);});
withCase('Revision cloning retains payload and selects the returned editable revision',async h=>{ready(h,'sent','view');h.setState('revisionReason',' Synthetic scope change ');h.setState('revisionOpen',true);h.render();h.setResponse((url,options)=>options?.method==='POST'&&url.endsWith('/revisions')?success({...proposal,id:'synthetic-revision-2',revision_number:2}):h.defaultResponse(url));await h.handlers().createRevision();assert.deepEqual(JSON.parse(h.requests[0].options.body),{revision_reason:'Synthetic scope change',issue_date:'2026-10-25',valid_until:'2026-11-24'});assert.equal(h.state('revisionOpen'),false);assert.ok(h.navigation.some(n=>n[0]==='navigate'&&n[1].includes('/synthetic-revision-2/edit?')));});
withCase('Revision Cancel closes without creating or modifying a quotation',h=>{ready(h,'sent','view');h.setState('revisionOpen',true);button(h.render(),'Cancel').props.onClick();assert.equal(h.state('revisionOpen'),false);assert.equal(h.requests.length,0);});
withCase('Print/PDF targets saved encoded document and accepted quotation routes to Orders without mutation',h=>{ready(h,'accepted','view');h.setState('core',{...core,id:'synthetic/id',status:'accepted'});const tree=h.render();all(tree,'button').find(n=>/^Print \/ PDF/.test(label(n).trim())).props.onClick();assert.deepEqual(h.opened,[['/print/quotations/synthetic%2Fid','_blank','noopener,noreferrer']]);all(tree,'Action').find(n=>n.props.label==='Create / view order').props.onClick();assert.deepEqual(h.navigation,[['navigate','/dashboard/orders?quotation_id=synthetic%2Fid',{}]]);assert.equal(h.requests.length,0);});
withCase('Client query prefill uses encoded option lookup and the client currency without a mutation', async h => {
  h.setProps({mode:'create',quotationId:undefined}); h.render(); h.setState('meta',meta); global.window.location.search='?client_id=synthetic%2Fclient'; h.render(); effect(h,/prefillHandled/); await settle();
  assert.equal(h.requests[0].url,'/api/sales/client-options?client_id=synthetic%2Fclient&limit=1'); assert.equal(h.state('creating'),true);
  assert.equal(h.state('clientId'),client.id); assert.equal(h.state('currency'),'BDT'); assert.ok(h.requests.every(r=>!r.options?.method));
});
withCase('Lead query prefill retains lineage, default tax, client lookup and item snapshots', async h => {
  const lead={lead_id:'synthetic/lead',client_id:client.id,subject:'Synthetic requirement',currency:'EUR',interests:[{id:'interest-1',product_id:'product-1',item_name:'Synthetic item',item_type:'non_stock_item',unit:null,description:null,quantity:'3',estimated_unit_price:'25.50'}]};
  h.setProps({mode:'create',quotationId:undefined}); h.render(); h.setState('meta',meta); global.window.location.search='?lead_id=synthetic%2Flead'; h.setResponse(url=>url.includes('/lead-quotation-source/')?success(lead):h.defaultResponse(url)); h.render(); effect(h,/prefillHandled/); await settle();
  assert.deepEqual(h.requests.map(r=>r.url),['/api/sales/lead-quotation-source/synthetic%2Flead',`/api/sales/client-options?client_id=${client.id}&limit=1`]);
  assert.equal(h.state('sourceLeadId'),lead.lead_id); assert.equal(h.state('currency'),'EUR'); assert.equal(h.state('projectTitle'),lead.subject);
  assert.deepEqual(h.state('items'),[{product_id:'product-1',lead_interest_id:'interest-1',item_name:'Synthetic item',item_type:'non_stock_item',unit:'unit',description:'Synthetic item',quantity:'3',unit_price:'25.50',discount_percent:0,tax_rate:'5'}]);
});
withCase('Catalog/client option effects remain read-only and respect draft state and currency', async h => {
  ready(h,'sent','view'); effect(h,/client-options\?limit=100/); effect(h,/catalog-options\?currency/); assert.equal(h.requests.length,0);
  h.setProps({mode:'create'}); h.setState('creating',true); h.setState('currency','A & B'); h.render(); effect(h,/client-options\?limit=100/); effect(h,/catalog-options\?currency/); await settle();
  assert.deepEqual(h.requests.map(r=>r.url),['/api/sales/client-options?limit=100','/api/sales/catalog-options?currency=A%20%26%20B&limit=200']);
});
for(const [tab,component]of [['pricing','PricingTab'],['overview','OverviewTab'],['sections','SectionsTab'],['delivery','DeliveryTab'],['payments','PaymentsTab']])withCase(`Immutable ${tab} tab passes its disabled guard to the existing editor`,h=>{
  ready(h,'sent'); h.setState('tab',tab); const editor=all(h.render(),component)[0]; assert.ok(editor); assert.equal(editor.props.disabled,true);
  h.setState('core',{...core,status:'draft'}); assert.equal(all(h.render(),component)[0].props.disabled,false); assert.equal(h.requests.length,0);
});
withCase('Delivery deletion clears matching payment links and reindexes only later links',h=>{
  validNew(h); h.setState('tab','delivery'); h.setState('milestones',[0,1,2].map(i=>({...h.helpers.blankMilestone(),title:`Phase ${i}`})));
  h.setState('payments',[null,0,1,2].map(i=>({...h.helpers.blankPayment(),milestone_index:i}))); const editor=all(h.render(),'DeliveryTab')[0]; editor.props.onRemove(1);
  assert.deepEqual(h.state('milestones').map(m=>m.title),['Phase 0','Phase 2']); assert.deepEqual(h.state('payments').map(p=>p.milestone_index),[null,0,null,1]); assert.equal(h.requests.length,0);
});
withCase('Standard sections retain existing content and do not duplicate existing section types',h=>{
  validNew(h); h.setState('tab','sections'); const original={section_type:'scope',title:'Custom scope',content:'Keep existing content',is_visible:false}; h.setState('sections',[original]);
  all(h.render(),'SectionsTab')[0].props.onAddStandard(); const once=h.state('sections'); assert.deepEqual(once[0],original); assert.equal(once.filter(s=>s.section_type==='scope').length,1);
  all(h.render(),'SectionsTab')[0].props.onAddStandard(); assert.deepEqual(h.state('sections'),once); assert.equal(h.requests.length,0);
});
withCase('Payment type controls clear the inactive value and keep delivery-link null semantics',h=>{
  const patches=[]; const payment={...h.helpers.blankPayment(),title:'Synthetic payment',percentage:50,amount:100}; const props={disabled:false,currency:'USD',total:200,scheduledTotal:100,difference:100,milestones:[],payments:[payment],onPatch:(...args)=>patches.push(args),onAdd(){},onRemove(){}};
  const tree=h.render(props),selectors=all(tree,'select'); selectors.find(n=>n.props.value==='percentage').props.onChange({target:{value:'fixed'}});
  assert.deepEqual(patches.shift(),[0,{payment_type:'fixed',percentage:0,amount:100}]);
  selectors.find(n=>n.props.value==='').props.onChange({target:{value:''}}); assert.deepEqual(patches.shift(),[0,{milestone_index:null}]);
  const fixed=h.render({...props,payments:[{...payment,payment_type:'fixed'}]}); all(fixed,'select').find(n=>n.props.value==='fixed').props.onChange({target:{value:'percentage'}});
  assert.deepEqual(patches.shift(),[0,{payment_type:'percentage',percentage:50,amount:0}]); assert.equal(h.requests.length,0);
},'PaymentsTab');
withCase('Revision overlay ignores interior clicks and closes only on backdrop without a mutation',h=>{
  ready(h,'sent'); h.setState('revisionOpen',true); const overlay=all(h.render(),'div').find(n=>n.props.onMouseDown); const backdrop={};
  overlay.props.onMouseDown({target:{},currentTarget:backdrop}); assert.equal(h.state('revisionOpen'),true);
  overlay.props.onMouseDown({target:backdrop,currentTarget:backdrop}); assert.equal(h.state('revisionOpen'),false); assert.equal(h.requests.length,0);
});
withCase('Pricing keeps catalog name/unit locks, fallback source and last-line deletion guard',h=>{
  ready(h); h.setState('items',[{...draftItem,product_id:'retired-product'}]); h.setState('catalog',[]); const props=all(h.render(),'PricingTab')[0].props;
  const tree=h.helpers.PricingTab(props); const source=all(tree,'SearchableSelect').find(n=>n.props.label==='Source');
  assert.equal(source.props.value,'catalog:retired-product'); assert.ok(source.props.options.some(o=>o.value==='catalog:retired-product'));
  for(const field of ['Item / service name','Unit'])assert.equal(all(tree,'Field').find(n=>n.props.label===field).props.disabled,true);
  assert.equal(all(tree,'Field').find(n=>n.props.label==='Description').props.disabled,false); assert.equal(all(tree,'button').find(n=>n.props['aria-label']==='Remove line').props.disabled,true);
  h.setState('items',[{...draftItem},{...draftItem}]); const editable=h.helpers.PricingTab(all(h.render(),'PricingTab')[0].props);
  assert.equal(all(editable,'Field').find(n=>n.props.label==='Item / service name').props.disabled,false); assert.equal(all(editable,'button').find(n=>n.props['aria-label']==='Remove line').props.disabled,false);
});
withCase('Pricing rendered line and footer totals both use the current inclusive draft mode and currency',h=>{
  validNew(h); h.setState('taxMode','inclusive'); h.setState('currency','BDT'); h.setState('items',[{...draftItem,quantity:1,unit_price:110,discount_percent:0,tax_rate:10}]);
  const pricing=h.helpers.PricingTab(all(h.render(),'PricingTab')[0].props); assert.match(label(pricing),/BDT 110\.00/);
  const totals=Object.fromEntries(all(pricing,'Total').map(n=>[n.props.label,n.props.value])); assert.equal(totals.Total,'BDT 110.00'); assert.equal(totals['Tax included'],'BDT 10.00'); assert.equal(totals.Subtotal,'BDT 110.00');
});
withCase('Document setup requests metadata only, not list rows or summary',async h=>{h.render();effect(h,/api\("\/meta"\)/);await settle();assert.deepEqual(h.requests.map(r=>r.url),['/api/sales/meta']);assert.equal(h.state('meta').default_currency,'USD');});
withCase('View mode defaults to Review and is readonly even for a draft',async h=>{
 const tree=ready(h,'draft','view');assert.equal(h.state('tab'),'review');assert.equal(h.handlers().editable,false);assert.equal(all(tree,'PricingTab').length,0);assert.equal(all(tree,'ReviewTab').length,1);assert.equal(button(tree,'Save draft'),undefined);assert.ok(all(tree,'a').some(n=>n.props.href.includes('/synthetic-quote/edit?')));await h.handlers().saveDraft();assert.equal(h.requests.length,0);
});
withCase('Edit mode has save/cancel edits but no saved-document lifecycle or print actions',async h=>{
 const tree=ready(h);assert.ok(button(tree,'Save draft'));assert.ok(button(tree,'Cancel edits'));assert.equal(all(tree,'Action').length,0);assert.equal(all(tree,'button').some(n=>/^Print \/ PDF/.test(label(n).trim())),false);await h.handlers().changeStatus('sent');h.setState('revisionReason','Unsaved');h.render();await h.handlers().createRevision();assert.equal(h.requests.length,0);
});
for(const status of ['sent','accepted','rejected','cancelled'])withCase(`Immutable ${status} Edit route blocks saving and explains the lock`,async h=>{const tree=ready(h,status,'edit');assert.equal(h.handlers().editable,false);assert.equal(button(tree,'Save draft'),undefined);assert.match(label(tree),/no longer a draft/);assert.ok(all(tree,'a').some(n=>n.props.href.includes('/synthetic-quote?')));await h.handlers().saveDraft();assert.equal(h.requests.length,0);});
withCase('Editing fields produces dirty state without mutation; restoring the value becomes clean',h=>{ready(h);assert.equal(h.handlers().hasChanges,false);h.setState('subject','Locally changed');h.render();assert.equal(h.handlers().hasChanges,true);h.setState('subject',core.subject);h.render();assert.equal(h.handlers().hasChanges,false);assert.equal(h.requests.length,0);});
for(const [field,value]of Object.entries({sourceLeadId:'lead-new',clientId:'client-new',issueDate:'2026-10-26',validUntil:'2026-12-01',currency:'BDT',taxMode:'inclusive',assignedEmployeeId:'employee-new',internalNotes:'Internal change',items:[{...draftItem,quantity:3}],projectTitle:'Project change',executiveSummary:'Summary change',estimatedStartDate:'2026-10-26',estimatedEndDate:'2026-11-01',estimatedDuration:'2 weeks',startCondition:'Approval',sections:[{section_type:'scope',content:'Changed'}],milestones:[{title:'Changed'}],payments:[{title:'Changed',amount:1}]}))withCase(`Dirty tracking includes ${field}`,h=>{ready(h);h.setState(field,value);h.render();assert.equal(h.handlers().hasChanges,true);});
withCase('Cancel edits routes through dirty guard and canceled discard preserves all local input',h=>{ready(h);h.setState('subject','Keep my input');h.render();h.setConfirm(false);h.handlers().cancelNew();assert.equal(h.navigation.length,0);assert.equal(h.state('subject'),'Keep my input');assert.equal(h.handlers().hasChanges,true);assert.equal(h.guardCalls.at(-1).kind,'navigate');h.setConfirm(true);h.handlers().cancelNew();assert.ok(h.navigation[0][1].includes('/synthetic-quote?'));assert.equal(h.requests.length,0);});
withCase('Create Cancel returns through the safe list context, never auto-selects a document',h=>{validNew(h);h.setState('returnHref','/dashboard/quotations?search=Synthetic&status=draft&pages=2');h.render();h.handlers().cancelNew();assert.equal(h.navigation[0][1],'/dashboard/quotations?search=Synthetic&status=draft&pages=2');assert.equal(h.requests.length,0);});
withCase('Latest detail request wins when responses resolve out of order',async h=>{
 h.render();const pending=new Map();h.setResponse(url=>new Promise(resolve=>pending.set(url,resolve)));const first=h.handlers().loadQuotation('first'),second=h.handlers().loadQuotation('second');
 for(const id of ['second','first']){pending.get(`/api/sales/quotations/${id}`)(success({...core,id}));pending.get(`/api/sales/quotations/${id}/commercial`)(success({...proposal,id}));pending.get(`/api/sales/quotations/${id}/revisions`)(success([]));await settle();}
 await Promise.all([first,second]);assert.equal(h.state('core').id,'second');assert.equal(h.state('proposal').id,'second');assert.equal(h.state('loadingQuotation'),false);
});
withCase('Unmounted document ignores delayed snapshots and errors',async h=>{h.render();const cleanup=effect(h,/mountedRef.current = true/);const pending=[];h.setResponse(()=>new Promise(resolve=>pending.push(resolve)));const loading=h.handlers().loadQuotation('delayed');cleanup();pending.forEach(resolve=>resolve(failure(404,'Late failure')));await loading;assert.equal(h.state('core'),null);assert.equal(h.state('error'),null);});
withCase('Duplicate Save calls synchronously share one in-flight create operation',async h=>{
 validNew(h);let release;h.setResponse((url,options)=>options?.method==='POST'?new Promise(resolve=>{release=resolve;}):h.defaultResponse(url));const first=h.handlers().saveDraft(),second=h.handlers().saveDraft();assert.equal(h.requests.length,1);h.render();assert.equal(all(h.render(),'PricingTab')[0].props.disabled,true);release(success(core));await Promise.all([first,second]);assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,1);assert.equal(h.requests.filter(r=>r.options?.method==='PATCH').length,1);assert.equal(h.state('saving'),false);
});
withCase('Two-stage save failure preserves every input, remains dirty, and retry never duplicates the core',async h=>{
 validNew(h);h.setState('executiveSummary','Keep this unsaved proposal');h.setState('sections',[{section_type:'scope',title:'Scope',content:'Keep scope text',is_visible:false}]);h.render();const snapshot=h.handlers().draftSnapshot;
 h.setResponse((url,options)=>url.endsWith('/commercial')&&options?.method==='PATCH'?failure(422,'Synthetic commercial validation'):h.defaultResponse(url));await h.handlers().saveDraft();h.render();assert.equal(h.handlers().draftSnapshot,snapshot);assert.equal(h.state('partialSave'),true);assert.equal(h.handlers().hasChanges,true);assert.match(h.state('error'),/Pricing was saved.*inputs are retained/);assert.equal(h.state('core').id,core.id);assert.equal(h.navigation.length,0);assert.equal(h.requests.length,2);assert.ok(button(h.render(),'Retry save'));
 h.setResponse(h.defaultResponse);await h.handlers().saveDraft();h.render();assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,1);assert.equal(h.requests[2].url,'/api/sales/quotations/synthetic-quote');assert.equal(h.requests[2].options.method,'PATCH');assert.equal(h.state('partialSave'),false);assert.equal(h.handlers().hasChanges,false);assert.ok(h.guardCalls.some(c=>c.kind==='clean'));assert.equal(h.navigation.length,1);
});
withCase('First-stage save failure keeps dirty fields and never applies a server snapshot',async h=>{validNew(h);const before=h.handlers().draftSnapshot;h.setResponse(()=>failure(422,'Synthetic core failure'));await h.handlers().saveDraft();h.render();assert.equal(h.handlers().draftSnapshot,before);assert.equal(h.handlers().hasChanges,true);assert.equal(h.state('partialSave'),false);assert.equal(h.state('core'),null);assert.equal(h.navigation.length,0);});
withCase('Pending save disables every editable tab and marks the navigation guard busy',h=>{ready(h);h.setState('saving',true);for(const[tab,component]of [['pricing','PricingTab'],['overview','OverviewTab'],['sections','SectionsTab'],['delivery','DeliveryTab'],['payments','PaymentsTab']]){h.setState('tab',tab);assert.equal(all(h.render(),component)[0].props.disabled,true);}assert.equal(h.guardCalls.filter(c=>c.kind==='state').at(-1).options.isBusy,true);});
function listCase(title,run){test(`Browse route: ${title}`,async()=>{const h=harness('QuotationsList',{file:'src/app/dashboard/quotations/quotations-list.tsx'});try{await run(h);}finally{h.cleanup();}});}
listCase('loads only register and all-status summary, never auto-fetches a document',async h=>{h.render();for(const fn of [...h.effects])fn();await settle();assert.deepEqual(h.requests.map(r=>r.url),['/api/sales/quotations?limit=30','/api/sales/quotations/summary']);const tree=h.render();assert.equal(all(tree,'PricingTab').length,0);assert.equal(all(tree,'ReviewTab').length,0);assert.equal(all(tree,'QuotationV2Workspace').length,0);assert.equal(h.state('rows').length,1);});
listCase('search/status/loaded pages hydrate from the URL with encoded cursors',async h=>{h.setQuery('search=A%20%26%20B&status=sent&pages=3');h.render();let page=0;h.setResponse(url=>url.endsWith('/summary')?success({total:3}):success({items:[{...core,id:`row-${++page}`}],next_cursor:page<3?`cursor +/${page}`:null}));effect(h,/new AbortController/);await settle();const calls=h.requests.filter(r=>r.url.includes('/quotations?'));assert.equal(calls.length,3);for(const r of calls){const p=new URL(r.url,'https://example.invalid').searchParams;assert.equal(p.get('search'),'A & B');assert.equal(p.get('status'),'sent');assert.equal(p.get('limit'),'30');}assert.equal(new URL(calls[1].url,'https://example.invalid').searchParams.get('cursor'),'cursor +/1');assert.equal(h.state('rows').length,3);});
listCase('filter changes reset loaded pages and query restoration rehydrates controls',h=>{h.setQuery('search=Original&status=draft&pages=4');let tree=h.render();assert.equal(all(tree,'select')[0].props.value,'draft');h.handlers().updateFilters({status:'sent'});const next=new URL(h.navigation[0][1],'https://example.invalid');assert.equal(next.searchParams.get('search'),'Original');assert.equal(next.searchParams.get('status'),'sent');assert.equal(next.searchParams.has('pages'),false);h.setQuery('search=Back%20restored&status=accepted&pages=2');tree=h.render();assert.equal(all(tree,'select')[0].props.value,'accepted');assert.equal(all(tree,'input')[0].props.defaultValue,'Back restored');assert.equal(h.handlers().pages,2);});
listCase('document links preserve list context and use explicit View destinations',h=>{h.setQuery('search=Synthetic&status=draft&pages=2');h.render();h.setState('loading',false);h.setState('rows',[core]);const tree=h.render(),row=all(tree,'a').find(n=>n.props['data-quotation-id']===core.id);assert.ok(row);assert.equal(row.props.prefetch,false);const url=new URL(row.props.href,'https://example.invalid');assert.equal(url.pathname,'/dashboard/quotations/synthetic-quote');const back=new URL(url.searchParams.get('returnTo'),'https://example.invalid');assert.equal(back.searchParams.get('search'),'Synthetic');assert.equal(back.searchParams.get('status'),'draft');assert.equal(back.searchParams.get('pages'),'2');assert.equal(back.searchParams.get('focus'),core.id);assert.equal(all(tree,'a').filter(n=>new URL(n.props.href,'https://example.invalid').pathname==='/dashboard/quotations/new').length,1);});
for(const [query,path,param]of [['quotation_id=legacy%2Fquote&lead_id=ignored','/dashboard/quotations/legacy%2Fquote',null],['lead_id=legacy%2Flead','/dashboard/quotations/new','lead_id'],['client_id=legacy%2Fclient','/dashboard/quotations/new','client_id']])listCase(`legacy ${query.split('=')[0]} routes before list loading`,h=>{h.setQuery(query);h.render();for(const fn of [...h.effects])fn();assert.equal(h.requests.length,0);assert.equal(h.navigation.length,1);const url=new URL(h.navigation[0][1],'https://example.invalid');assert.equal(url.pathname,path);if(param)assert.equal(url.searchParams.get(param),param==='lead_id'?'legacy/lead':'legacy/client');});
listCase('stale and aborted list responses cannot replace the latest query results',async h=>{h.render();const pending=[];h.setResponse((url)=>new Promise(resolve=>pending.push({url,resolve})));const cleanup=effect(h,/new AbortController/);h.setQuery('search=latest');h.render();cleanup();effect(h,/new AbortController/);for(const r of pending.slice(2))r.resolve(success(r.url.endsWith('/summary')?{total:1}:{items:[{...core,id:'latest'}],next_cursor:null}));await settle();for(const r of pending.slice(0,2))r.resolve(success(r.url.endsWith('/summary')?{total:99}:{items:[{...core,id:'stale'}],next_cursor:null}));await settle();assert.equal(h.state('rows')[0].id,'latest');assert.equal(h.state('summary').total,1);assert.equal(h.state('loading'),false);});
for(const status of [401,403])listCase(`${status} keeps authentication/role handling and clears stale rows`,async h=>{h.render();h.setState('rows',[core]);h.setResponse(()=>failure(status));effect(h,/new AbortController/);await settle();assert.deepEqual(h.state('rows'),[]);assert.equal(h.state('summary'),null);assert.equal(h.state('loading'),false);if(status===401)assert.ok(h.navigation.some(n=>n[0]==='replace'&&n[1]==='/login'));else assert.match(h.state('error'),/permission/);});
listCase('empty and failed register states remain browse-only and offer safe recovery',async h=>{h.render();h.setResponse(url=>success(url.endsWith('/summary')?{total:0}:{items:[],next_cursor:null}));effect(h,/new AbortController/);await settle();assert.match(label(h.render()),/No quotations yet/);h.setResponse(()=>failure(500,'Synthetic unavailable'));h.render();effect(h,/new AbortController/);await settle();assert.match(label(h.render()),/Synthetic unavailable/);assert.ok(button(h.render(),'Retry'));assert.equal(all(h.render(),'PricingTab').length,0);});
/** Real navigation hook, fake browser event targets: no browser or history API is driven. */
function guardHarness(dirty=true,busy=false,documentLabel){
 const filename=path.join(root,'src/hooks/use-quotation-navigation-guard.ts'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
 const refs=[],listeners=new Map(),calls=[],prompts=[];let cursor=0,effects=[],cleanups=[],answer=true,guard,throwNavigation=false;
 const original={window:global.window,Element:global.Element,Node:global.Node};
 class FakeNode{constructor(parentElement=null){this.parentElement=parentElement;}}
 class FakeElement extends FakeNode{constructor(href,attrs={}){super();this.attrs={href,...attrs};}closest(){return this;}getAttribute(name){return this.attrs[name]??null;}hasAttribute(name){return name in this.attrs;}}
 const current='https://example.invalid/dashboard/quotations/synthetic/edit?returnTo=%2Fdashboard%2Fquotations';
 const key=(type,capture)=>`${type}:${Boolean(capture)}`;
 global.Node=FakeNode;global.Element=FakeElement;global.window={location:{href:current,assign:href=>{if(throwNavigation)throw Error('Synthetic blocked navigation');calls.push(['assign',href]);},replace:href=>{if(throwNavigation)throw Error('Synthetic blocked navigation');calls.push(['replace',href]);}},confirm:message=>{prompts.push(message);return answer;},addEventListener:(type,fn,capture)=>{const k=key(type,capture);if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener:(type,fn,capture)=>listeners.get(key(type,capture))?.delete(fn)};
 const utilityFilename=path.join(root,'src/lib/workspace-navigation.ts'),utility=new Module(utilityFilename,module);utility.filename=utilityFilename;utility.paths=module.paths;utility._compile(ts.transpileModule(fs.readFileSync(utilityFilename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,utilityFilename);
 global.window.dispatchEvent=event=>{for(const capture of [true,false])for(const fn of listeners.get(key(event.type,capture))||[])fn(event);return !event.defaultPrevented;};
 mod.require=id=>id==='react'?{useRef:value=>refs[cursor++]??={current:value},useCallback:fn=>fn,useEffect:fn=>effects.push(fn)}:id==='@/lib/workspace-navigation'?utility.exports:require(id);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
 const render=(nextDirty=dirty,nextBusy=busy)=>{cleanups.forEach(fn=>fn?.());cursor=0;effects=[];guard=mod.exports.useQuotationNavigationGuard(nextDirty,{isBusy:nextBusy,...(documentLabel?{documentLabel}:{})});cleanups=effects.map(fn=>fn());return guard;};render();
 const event=(type,attrs={})=>{const e={defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...attrs};for(const capture of [true,false])for(const fn of listeners.get(key(type,capture))||[])fn(e);return e;};
 return{guard:()=>guard,render,calls,prompts,current,requestExit:utility.exports.requestWorkspaceExit,exitEvent:utility.exports.WORKSPACE_EXIT_EVENT,detach:()=>{cleanups.forEach(fn=>fn?.());cleanups=[];},classify:mod.exports.quotationAnchorDestination,answer:value=>{answer=value;},throwNavigation:value=>{throwNavigation=value;},event,anchor:(href,attrs)=>new FakeElement(href,attrs),textNode:anchor=>new FakeNode(anchor),count:type=>[...(listeners.get(key(type,true))||[]),...(listeners.get(key(type,false))||[])].length,cleanup:()=>{cleanups.forEach(fn=>fn?.());Object.assign(global,original);}};
}
function guardCase(title,run){test(`Navigation guard: ${title}`,()=>{const h=guardHarness();try{run(h);}finally{h.cleanup();}});}
guardCase('dirty native unload requests a browser warning',h=>{const event=h.event('beforeunload');assert.equal(event.defaultPrevented,true);assert.equal(event.returnValue,'');assert.equal(h.prompts.length,0);});
guardCase('clean render removes unload warning but still captures ordinary navigation',h=>{h.render(false);assert.equal(h.count('beforeunload'),0);const event=h.event('click',{target:h.anchor('/dashboard/clients'),button:0});assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.deepEqual(h.calls,[['assign','https://example.invalid/dashboard/clients']]);assert.equal(h.prompts.length,0);});
guardCase('Cancel discard preserves dirty protection and prevents shell Link propagation',h=>{h.answer(false);const event=h.event('click',{target:h.anchor('/dashboard/clients'),button:0});assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(h.calls.length,0);assert.equal(h.prompts.length,1);assert.equal(h.event('beforeunload').defaultPrevented,true);});
guardCase('accepted explicit navigation suppresses only the next unload',h=>{assert.equal(h.guard().navigate('/dashboard/quotations'),true);assert.equal(h.prompts.length,1);assert.equal(h.event('beforeunload').defaultPrevented,false);assert.equal(h.event('beforeunload').defaultPrevented,true);});
for(const type of ['pageshow','pointerdown','keydown'])guardCase(`${type} re-arms protection after an earlier accepted exit`,h=>{h.guard().navigate('/dashboard/quotations');h.event(type);assert.equal(h.event('beforeunload').defaultPrevented,true);});
guardCase('confirmLeave alone never marks the form clean',h=>{assert.equal(h.guard().confirmLeave(),true);assert.equal(h.calls.length,0);assert.equal(h.event('beforeunload').defaultPrevented,true);});
guardCase('busy navigation rejects even discard bypass and native unload still warns',h=>{h.render(false,true);assert.equal(h.guard().confirmLeave(),false);assert.equal(h.guard().navigate('/dashboard/quotations',{discard:true}),false);assert.equal(h.calls.length,0);assert.equal(h.prompts.length,0);assert.equal(h.event('beforeunload').defaultPrevented,true);});
guardCase('authoritative markClean enables immediate success navigation while pending state unwinds',h=>{h.render(true,true);h.guard().markClean();assert.equal(h.guard().navigate('/dashboard/quotations/saved',{discard:true,replace:true}),true);assert.deepEqual(h.calls,[['replace','https://example.invalid/dashboard/quotations/saved']]);assert.equal(h.prompts.length,0);assert.equal(h.event('beforeunload').defaultPrevented,false);});
guardCase('failed location navigation does not leave an unload bypass armed',h=>{h.throwNavigation(true);assert.equal(h.guard().navigate('/dashboard/quotations'),false);assert.equal(h.event('beforeunload').defaultPrevented,true);});
guardCase('same-document hash programmatic navigation neither confirms nor consumes dirty protection',h=>{assert.equal(h.guard().navigate('#scope'),true);assert.equal(h.prompts.length,0);assert.equal(h.event('beforeunload').defaultPrevented,true);});
guardCase('text-node anchor target is protected before the application router',h=>{h.answer(false);const event=h.event('click',{target:h.textNode(h.anchor('/dashboard/clients')),button:0});assert.equal(event.stopped,true);assert.equal(h.prompts.length,1);assert.equal(h.calls.length,0);});
for(const intent of [{href:'#scope'},{href:'#'},{href:'mailto:test@example.invalid'},{href:'tel:123'},{href:'/dashboard/clients',target:'_blank'},{href:'/dashboard/clients',download:true},{href:'/dashboard/clients',ctrlKey:true},{href:'/dashboard/clients',metaKey:true},{href:'/dashboard/clients',shiftKey:true},{href:'/dashboard/clients',altKey:true},{href:'/dashboard/clients',button:1},{href:'/dashboard/clients',defaultPrevented:true}])guardCase(`non-leaving intent stays native ${JSON.stringify(intent)}`,h=>{assert.equal(h.classify(intent,h.current),null);});
guardCase('ordinary internal and external HTTP(S) anchors are classified as document exits',h=>{assert.equal(h.classify({href:'/dashboard/clients'},h.current),'https://example.invalid/dashboard/clients');assert.equal(h.classify({href:'https://external.example.invalid'},h.current),'https://external.example.invalid/');assert.equal(h.classify({href:h.current+'#'},h.current),null);});
guardCase('non-web programmatic destinations are rejected without prompts or navigation',h=>{assert.equal(h.guard().navigate('javascript:alert(1)'),false);assert.equal(h.calls.length,0);assert.equal(h.prompts.length,0);});
withCase('Dirty revision switching and Back use the guard without discarding canceled input',h=>{ready(h);h.setState('subject','Keep draft edits');h.setState('revisions',[{...proposal,id:'other-revision',revision_number:2,status:'sent'}]);h.render();h.setConfirm(false);const tree=h.render();all(tree,'button').find(n=>n.props['aria-pressed']===false).props.onClick();assert.equal(h.navigation.length,0);button(tree,'Back to quotations').props.onClick();assert.equal(h.navigation.length,0);assert.equal(h.state('subject'),'Keep draft edits');assert.equal(h.requests.length,0);h.setConfirm(true);all(tree,'button').find(n=>n.props['aria-pressed']===false).props.onClick();assert.ok(h.navigation[0][1].includes('/other-revision?'));});
withCase('Catalog cleanup prevents a previous currency response from replacing current options',async h=>{ready(h);const pending=[];h.setResponse(url=>new Promise(resolve=>pending.push({url,resolve})));const cleanup=effect(h,/catalog-options\?currency/);h.setState('currency','EUR');h.render();cleanup();effect(h,/catalog-options\?currency/);pending[1].resolve(success([{id:'eur',currency:'EUR'}]));await settle();pending[0].resolve(success([{id:'usd',currency:'USD'}]));await settle();assert.deepEqual(h.state('catalog'),[{id:'eur',currency:'EUR'}]);});
for(const[tab,component]of [['pricing','PricingTab'],['overview','OverviewTab'],['sections','SectionsTab'],['delivery','DeliveryTab'],['payments','PaymentsTab']])withCase(`Draft View keeps ${tab} controls readonly`,h=>{ready(h,'draft','view');h.setState('tab',tab);assert.equal(all(h.render(),component)[0].props.disabled,true);assert.equal(h.requests.length,0);});
guardCase('imperative workspace-exit preflight allows normal operation outside an editor guard',h=>{h.detach();assert.equal(h.requestExit(),true);assert.equal(h.prompts.length,0);assert.equal(h.calls.length,0);});
guardCase('actual workspace-exit utility returns false on dirty Cancel without clearing changes',h=>{h.answer(false);assert.equal(h.requestExit(),false);assert.equal(h.prompts.length,1);assert.equal(h.calls.length,0);assert.equal(h.event('beforeunload').defaultPrevented,true);});
guardCase('accepted workspace-exit preflight does not clean or consume native-unload protection',h=>{h.answer(true);assert.equal(h.requestExit(),true);assert.equal(h.prompts.length,1);assert.equal(h.calls.length,0);assert.equal(h.event('beforeunload').defaultPrevented,true);});
guardCase('busy workspace-exit preflight is blocked without prompting even on a clean snapshot',h=>{h.render(false,true);assert.equal(h.requestExit(),false);assert.equal(h.prompts.length,0);assert.equal(h.event('beforeunload').defaultPrevented,true);});
guardCase('clean workspace-exit preflight requires no prompt',h=>{h.render(false,false);assert.equal(h.requestExit(),true);assert.equal(h.prompts.length,0);});
guardCase('already-canceled workspace-exit events remain canceled without a second prompt',h=>{const event=new Event(h.exitEvent,{cancelable:true});event.preventDefault();assert.equal(global.window.dispatchEvent(event),false);assert.equal(h.prompts.length,0);});

guardCase('generic guard keeps the delivered quotation wording when documentLabel is omitted',h=>{h.answer(false);assert.equal(h.guard().confirmLeave(),false);assert.equal(h.prompts[0],'You have unsaved quotation changes. Discard them and leave this page?');});
test('Navigation guard: optional order label changes only wording while Cancel and busy protection remain intact',()=>{const h=guardHarness(true,false,'order');try{h.answer(false);assert.equal(h.requestExit(),false);assert.equal(h.prompts[0],'You have unsaved order changes. Discard them and leave this page?');assert.equal(h.event('beforeunload').defaultPrevented,true);h.render(true,true);assert.equal(h.guard().navigate('/dashboard/orders',{discard:true}),false);assert.equal(h.calls.length,0);}finally{h.cleanup();}});

withCase('Existing legacy notes and terms are never overwritten by V2 draft PATCH', async h => {
  ready(h); h.setState('core', {...core, notes:'Legacy Unicode note — বাংলা', terms_conditions:'Existing agreed terms'}); h.render();
  await h.handlers().saveDraft();
  const request=h.requests.find(r=>r.options?.method==='PATCH' && r.url.endsWith('/synthetic-quote'));
  const body=JSON.parse(request.options.body);
  assert.equal(Object.hasOwn(body,'notes'),false);
  assert.equal(Object.hasOwn(body,'terms_conditions'),false);
  assert.equal(body.internal_notes,null);
});

withCase('Acknowledged status survives failed refresh and retry never repeats the write', async h => {
  ready(h,'draft','view');
  h.setResponse((url,options) => options?.method === 'PATCH' ? success({...core,status:'sent'}) : failure(503,'Read unavailable'));
  await h.handlers().changeStatus('sent'); h.render();
  assert.equal(h.state('core').status,'sent');
  assert.equal(h.state('proposal').status,'sent');
  assert.equal(h.state('refreshRequired'),true);
  assert.match(h.state('error'),/status request was acknowledged.*could not be refreshed/);
  assert.match(h.state('message'),/saved as sent.*refresh is pending/);
  assert.ok(all(h.render(),'Action').every(node=>node.props.disabled));
  const count=h.requests.length;
  await h.handlers().changeStatus('accepted');
  await h.handlers().createRevision();
  assert.equal(h.requests.length,count);
  h.setResponse(url=>success(url.endsWith('/revisions')?[]:url.endsWith('/commercial')?{...proposal,status:'sent'}:{...core,status:'sent'}));
  button(h.render(),'Retry document refresh').props.onClick(); await settle(); h.render();
  assert.equal(h.requests.filter(r=>r.options?.method==='PATCH').length,1);
  assert.equal(h.state('refreshRequired'),false);
  assert.equal(h.state('error'),null);
  assert.match(h.state('message'),/Current verified status: sent/);
});
withCase('Initial detail failure offers only read retry and current authentication failures still redirect', async h => {
  ready(h); h.setResponse(()=>failure(503,'Temporarily unavailable'));
  await h.handlers().loadQuotation(core.id); h.render();
  assert.ok(button(h.render(),'Retry document refresh'));
  assert.equal(h.state('core'),null);
  h.setResponse(()=>failure(401));
  await h.handlers().loadQuotation(core.id);
  assert.ok(h.navigation.some(item=>item[0]==='replace'&&item[1]==='/login'));
});
withCase('Superseded and unmounted quotation reads cannot redirect on late 401', async h => {
  h.render(); const cleanup=effect(h,/mountedRef.current = true/);
  const pending=[];h.setResponse(()=>new Promise(resolve=>pending.push(resolve)));
  const old=h.handlers().loadQuotation('old');
  h.setResponse(h.defaultResponse);await h.handlers().loadQuotation(core.id);
  pending.splice(0).forEach(resolve=>resolve(failure(401))); await old;
  assert.equal(h.navigation.length,0);
  h.setResponse(()=>new Promise(resolve=>pending.push(resolve)));
  const unmounted=h.handlers().loadQuotation('gone');cleanup();
  pending.forEach(resolve=>resolve(failure(401)));await unmounted;
  assert.equal(h.navigation.length,0);
});

withCase('Draft validation or save rejection never offers a destructive document reload', async h => {
  ready(h);h.setResponse(()=>failure(422,'Keep your input'));h.setState('subject','Unsaved user change');h.render();
  await h.handlers().saveDraft();h.render();
  assert.equal(h.state('subject'),'Unsaved user change');
  assert.equal(button(h.render(),'Retry document refresh'),undefined);
});
withCase('Four-place loaded prices and request payloads preserve every digit', async h=>{
  const precise={...core,items:[{...core.items[0],quantity:'1.0000',unit_price:'999999999999.9903',discount_percent:'0.0000',tax_rate:'0.0000'}]};
  ready(h);h.handlers().applyCore(precise);h.render();
  assert.equal(h.state('items')[0].unit_price,'999999999999.9903');
  assert.equal(h.handlers().documentTotal,'999999999999.99');
  await h.handlers().saveDraft();
  const body=JSON.parse(h.requests[0].options.body);assert.equal(body.items[0].unit_price,'999999999999.9903');assert.equal(body.items[0].quantity,'1.0000');
});
withCase('Invalid decimal input and one-cent schedule errors prevent all writes',async h=>{
  validNew(h);h.setState('items',[{...draftItem,unit_price:'1.00001'}]);h.render();await h.handlers().saveDraft();assert.equal(h.requests.length,0);assert.match(h.state('error'),/pricing line/);
  h.setState('items',[draftItem]);h.setState('payments',[{...h.helpers.blankPayment(),title:'Fixed',payment_type:'fixed',amount:'188.99'}]);h.render();await h.handlers().saveDraft();assert.equal(h.requests.length,0);assert.match(h.state('error'),/must equal/);
});
withCase('Numeric editor keeps empty and exact decimal text instead of coercing to zero',h=>{
 let changed;const tree=h.helpers.NumberField({label:'Exact price',value:'999999999999.9903',onChange:value=>{changed=value;}});const input=all(tree,'input')[0];assert.equal(input.props.value,'999999999999.9903');input.props.onChange({target:{value:''}});assert.equal(changed,'');input.props.onChange({target:{value:'1.2345'}});assert.equal(changed,'1.2345');
});

for(const permissions of [[],['quotations.view'],['orders.manage']])withCase(`Quotation manager guards deny write handlers for ${permissions.join(',')||'empty permissions'}`,async h=>{
 h.setTenant({is_owner:false,permissions});ready(h,'draft','view');
 assert.equal(all(h.render(),'Action').some(n=>['Mark sent','Cancel quotation'].includes(n.props.label)),false);
 const print=all(h.render(),'button').find(n=>/^Print \/ PDF/.test(label(n).trim()));assert.ok(print);
 await h.handlers().changeStatus('sent');await h.handlers().createRevision();
 h.setProps({mode:'edit'});h.render();await h.handlers().saveDraft();
 assert.equal(h.requests.length,0);assert.equal(h.handlers().editable,false);
});
withCase('Revoking management blocks a retained stale handler without hiding viewer document',async h=>{
 ready(h,'draft','view');const action=h.handlers().changeStatus;
 h.setTenant({is_owner:false,permissions:['quotations.view']});h.render();await action('sent');assert.equal(h.requests.length,0);
 assert.equal(h.state('core').id,core.id);
});
withCase('Order viewers retain read navigation without a create-action label',h=>{
 h.setTenant({is_owner:false,permissions:['quotations.view','orders.view']});const tree=ready(h,'accepted','view');
 const action=all(tree,'Action').find(n=>n.props.label==='View related orders');assert.ok(action);action.props.onClick();assert.match(h.navigation[0][1],/orders\?quotation_id=/);assert.equal(h.requests.length,0);
});
listCase('Quotation viewer register remains readable without New quotation',h=>{
 h.setTenant({is_owner:false,permissions:['quotations.view']});h.render();h.setState('loading',false);h.setState('rows',[core]);const tree=h.render();
 assert.equal(all(tree,'a').some(n=>label(n).includes('New quotation')),false);
 assert.ok(all(tree,'a').some(n=>n.props['data-quotation-id']===core.id));
});
withCase('Revision uses shared focus lifecycle and blocks close during an in-flight write',async h=>{
 ready(h,'sent','view');h.setState('revisionReason','Synthetic revision');h.setState('revisionOpen',true);h.render();
 let finish;h.setResponse(()=>new Promise(resolve=>{finish=resolve;}));const pending=h.handlers().createRevision();
 const tree=h.render(),focus=all(tree,'ProjectDialogFocus')[0];assert.ok(focus);assert.equal(focus.props.busy,true);focus.props.onClose();assert.equal(h.state('revisionOpen'),true);
 const overlay=all(tree,'div').find(n=>n.props.role==='dialog');const target={};overlay.props.onMouseDown({target,currentTarget:target});assert.equal(h.state('revisionOpen'),true);
 finish(failure(422,'Keep reason'));await pending;h.render();all(h.render(),'ProjectDialogFocus')[0].props.onClose();assert.equal(h.state('revisionOpen'),false);assert.equal(h.state('revisionReason'),'Synthetic revision');
});

withCase('Aggregate subtotal overflow cannot hide behind a zero payable total',async h=>{
 validNew(h);const line={...draftItem,quantity:'100',unit_price:'999999999999.99',discount_percent:'100',tax_rate:'0'};
 h.setState('items',[line,{...line}]);h.render();assert.equal(h.handlers().preview.total,'0.00');assert.equal(h.handlers().preview.subtotal,'');await h.handlers().saveDraft();assert.equal(h.requests.length,0);assert.match(h.state('error'),/pricing line/);
});

for(const [name,payload] of [['null',null],['empty',{}],['array',[]],['foreign',{...core,id:'foreign-quote',status:'sent'}],['missing-items',{...core,items:null,status:'sent'}],['unsafe-field',{...core,subject:{unexpected:true},status:'sent'}]])withCase(`Acknowledged ${name} status body retains prior verified data and locks until read reconciliation`,async h=>{
 ready(h,'draft','view');h.setState('revisionReason','Retained revision draft');h.render();const statusAction=h.handlers().changeStatus;const revisionAction=h.handlers().createRevision;
 h.setResponse((url,options)=>options?.method==='PATCH'?success(payload):failure(503,'Read unavailable'));
 await statusAction('sent');
 assert.equal(h.state('core').id,core.id);assert.equal(h.state('core').status,'draft');assert.equal(h.state('refreshRequired'),true);
 assert.match(h.state('message'),/acknowledged.*unverified/);
 const before=h.requests.length;await statusAction('sent');await revisionAction();assert.equal(h.requests.length,before);
 h.render();assert.ok(button(h.render(),'Retry document refresh'));
 h.setResponse(url=>success(url.endsWith('/revisions')?[]:url.endsWith('/commercial')?{...proposal,status:'sent'}:{...core,status:'sent'}));
 button(h.render(),'Retry document refresh').props.onClick();await settle();h.render();
 assert.equal(h.state('core').status,'sent');assert.equal(h.state('refreshRequired'),false);assert.equal(h.requests.filter(r=>r.options?.method==='PATCH').length,1);
});
withCase('Malformed JSON2xx locks before body reading finishes and cannot repeat mutation',async h=>{
 ready(h,'draft','view');let rejectBody;const action=h.handlers().changeStatus;
 h.setResponse((url,options)=>options?.method==='PATCH'?{ok:true,status:200,json:()=>new Promise((_,reject)=>{rejectBody=reject;})}:failure(503,'Read unavailable'));
 const pending=action('sent');await settle();assert.equal(h.state('refreshRequired'),true);assert.equal(h.handlers().statusReconciliationRef.current,true);
 await action('sent');assert.equal(h.requests.length,1);rejectBody(new SyntaxError('Invalid JSON'));await pending;
 assert.equal(h.state('core').status,'draft');assert.equal(h.state('refreshRequired'),true);assert.match(h.state('message'),/unverified/);await action('sent');assert.equal(h.requests.filter(r=>r.options?.method==='PATCH').length,1);
});
withCase('Foreign or malformed reconciliation reads cannot unlock an acknowledged status',async h=>{
 ready(h,'draft','view');h.setResponse((url,options)=>options?.method==='PATCH'?success(null):failure(503));await h.handlers().changeStatus('sent');h.render();
 for(const payload of [null,{...core,id:'wrong-id',status:'sent'},{...core,items:[],total:null,status:'sent'},{...core,status:['sent']},{...core,status:'sent',tax_calculation_mode:['exclusive']}]){
   h.setResponse(url=>success(url.endsWith('/commercial')?proposal:url.endsWith('/revisions')?[]:payload));await h.handlers().loadQuotation(core.id,true);h.render();
   assert.equal(h.state('refreshRequired'),true);assert.equal(h.state('core').id,core.id);assert.equal(h.state('core').status,'draft');
 }
 assert.equal(h.requests.filter(r=>r.options?.method==='PATCH').length,1);
});

withCase('Non-owner wildcard retains quotation writes and related order management',async h=>{
 h.setTenant({is_owner:false,permissions:['*']});
 let tree=ready(h,'draft','view');assert.ok(all(tree,'Action').some(n=>n.props.label==='Mark sent'));
 h.setResponse((url,options)=>success(url.endsWith('/revisions')?[]:url.endsWith('/commercial')?{...proposal,status:'sent'}:{...core,status:'sent'}));
 await h.handlers().changeStatus('sent');assert.equal(h.requests.filter(r=>r.options?.method==='PATCH').length,1);
 tree=ready(h,'accepted','view');assert.ok(all(tree,'Action').some(n=>n.props.label==='Create / view order'));
});
withCase('Non-owner wildcard can save a new quotation',async h=>{
 h.setTenant({is_owner:false,permissions:['*']});validNew(h);assert.equal(h.handlers().editable,true);await h.handlers().saveDraft();assert.ok(h.requests.some(r=>r.options?.method==='POST'));
});
listCase('Non-owner wildcard retains New quotation in the readable register',h=>{
 h.setTenant({is_owner:false,permissions:['*']});h.render();h.setState('loading',false);h.setState('rows',[core]);const tree=h.render();
 assert.ok(all(tree,'a').some(n=>label(n).includes('New quotation')));assert.ok(all(tree,'a').some(n=>n.props['data-quotation-id']===core.id));
});
