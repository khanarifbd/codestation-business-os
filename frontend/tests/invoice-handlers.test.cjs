/** Synthetic component/handler tests. All requests, shares and browser actions are mocked. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
const success = value => ({ok:true,status:200,json:async()=>value});
const failure = (detail,status=400) => ({ok:false,status,json:async()=>({detail})});
const settle = async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
const fixtureInvoice = {id:'synthetic-invoice',invoice_number:'SYN-001',client_id:'synthetic-client',client_name:'Synthetic client',order_id:null,project_id:null,status:'draft',display_status:'draft',subject:'Synthetic scope',issue_date:'2026-10-24',due_date:'2026-11-24',currency:'USD',tax_calculation_mode:'exclusive',total:'210',amount_paid:'0',balance_due:'210',notes:null,terms_conditions:null,internal_notes:null,cancel_reason:null,seller_name_snapshot:'Synthetic seller',client_name_snapshot:'Synthetic client',subtotal:'200',discount_total:'0',tax_total:'10',items:[{id:'synthetic-line',item_name_snapshot:'Review item',description:'Review item',quantity:'2',unit_price:'100',discount_percent:'0',tax_rate:'5',line_total:'210'}]};
const fixturePayment = {id:'synthetic-payment',payment_number:'SYN-PAY-001',payment_date:'2026-10-24',account_name:'Synthetic bank',invoice_amount:'20',invoice_currency:'USD',account_amount:'2400',account_currency:'BDT',status:'confirmed',method:'bank_transfer',reference:'SYNTHETIC'};
const fixtureInstructions = {invoice_id:fixtureInvoice.id,invoice_number:fixtureInvoice.invoice_number,invoice_status:'draft',invoice_currency:'USD',payment_method:'bank_transfer',payment_account_id:'synthetic-bank',payment_account_name:'Synthetic bank',payment_provider:null,payment_account_holder:null,payment_account_reference:null,payment_currency:'BDT',payment_url:null,payment_instructions:'Synthetic instructions',locked:false};
const fixtureDestination={id:'synthetic-bank',name:'Synthetic bank',account_type:'bank',provider_name:null,account_holder_name:null,account_reference:null,currency:'BDT',payment_url:'https://pay.example.invalid/synthetic',payment_instructions:'Synthetic reference only'};
const mappings={list:['invoices-workspace-v2','InvoicesWorkspaceContent',['load','loadMore','applyFilters','restartFirstPage','submit','resetSource','clearFilters','changeManualCurrency','selectLineSource','selectPaymentDestination','updateLine','openCreate','closeCreate','applyClientIntent','changeDraft','filteredInvoices','overdueCount','outstandingCount','draftTotal','availableCatalog','projectOptions','orderOptions']],detail:['invoice-detail-workspace','InvoiceDetailWorkspace',['load','saveDraft','sendInvoice','shareInvoice','cancelInvoice','reversePayment','beginEdit','cancelEdit','openCancellation','closeCancellation','beginReversal','reviewReversal','closeReversal','changeForm','changeCancellationReason','changeReversalReason']],payment:['invoice-payment-workspace','InvoicePaymentWorkspace',['load','selectDestination','changeMethod','savePaymentInstructions','printInvoice','beginEdit','cancelEdit','changeField','changeDefaults']],workspace:['invoice-workspace','InvoiceWorkspace',[]]};
function all(node,type,result=[]){if(Array.isArray(node))node.forEach(child=>all(child,type,result));else if(node?.props){if(node.type===type||node.type?.name===type)result.push(node);for(const value of Object.values(node.props))if(Array.isArray(value)||value?.props)all(value,type,result);}return result;}
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join(' ');if(node.props)return Object.values(node.props).filter(v=>typeof v!=='function').map(text).join(' ');return '';}
function hasJsx(node){let yes=false;const visit=n=>{if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n))yes=true;ts.forEachChild(n,visit);};visit(node);return yes;}
function harness(kind){
 const [slug,name,exposed]=mappings[kind];const filename=path.join(root,'src/components/'+slug+'.tsx');let source=fs.readFileSync(filename,'utf8');
 const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);const firstRender=component.body.statements.find(hasJsx);
 const names=component.body.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations).filter(d=>ts.isArrayBindingPattern(d.name)&&d.initializer?.getText(ast).startsWith('useState')).map(d=>d.name.elements[0].name.text);
 // Expose existing closures in-memory only; the source file and their bodies stay unchanged.
 source=source.slice(0,firstRender.getStart(ast))+'__testHandlers = {'+exposed.join(',')+'};\n'+source.slice(firstRender.getStart(ast));source+='\nlet __testHandlers; export const getTestHandlers=()=>__testHandlers;';
 const states=[],refs=[],effects=[],layouts=[],requests=[],updated=[],shares=[],opened=[];let cursor=0,refCursor=0;let tenant={permissions:['*']};let response=(url)=>success(url.includes('/payments?')?[]:url.endsWith('/payment-instructions')?fixtureInstructions:url==='/api/finance/payment-destinations'?[fixtureDestination]:url.includes('/invoices/')?fixtureInvoice:url==='/api/finance/meta'?{clients:[],orders:[],projects:[]}:url.includes('invoice-page')?{items:[]}:[]);
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 function compileLibrary(id){const file=path.join(root,'src',id.slice(2)+'.ts');const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return mod.exports;}
 let ui; const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod.require=id=>{
  if(id==='@/components/invoices/invoice-ui'){ if(!ui){const uiFile=path.join(root,'src/components/invoices/invoice-ui.tsx');const child=new Module(uiFile,module);child.filename=uiFile;child.paths=module.paths;child.require=mod.require;child._compile(ts.transpileModule(fs.readFileSync(uiFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,uiFile);ui=child.exports;}return ui;}
  if(id==='react')return{useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useEffect:effect=>effects.push(effect),useLayoutEffect:effect=>layouts.push(effect),useMemo:fn=>fn(),useCallback:fn=>fn,useRef:initial=>{const i=refCursor++;return refs[i]??(refs[i]={current:initial});}};
  if(id==='next/link')return{default:'a'};
  if(id==='@/components/dashboard-session-context')return{useDashboardSession:()=>({tenant})};
  if(id.startsWith('@/components/'))return new Proxy({}, {get:(_t,key)=>String(key)});
  if(id==='@/lib/qrcode-svg')return{default:()=>{throw new Error('QR DOM creation is not exercised by synthetic handler tests');}};
  if(id.startsWith('@/lib/'))return compileLibrary(id);
  if(id.endsWith('.css'))return{};return require(id);
 };
 mod._compile(code,filename);
 const original={fetch:global.fetch,Date:global.Date,window:global.window,navigator:Object.getOwnPropertyDescriptor(global,'navigator')};
 global.fetch=async(url,options)=>{requests.push({url,options});return response(url,options);};
 global.Date=class extends original.Date{constructor(...args){super(...(args.length?args:['2026-10-24T12:00:00Z']));}};
 global.window={location:{origin:'https://preview.example.invalid'},open:(...args)=>opened.push(args)};
 Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>shares.push(value)}}});
 const render=props=>{cursor=0;refCursor=0;effects.length=0;return mod.exports[name](props??{invoiceId:fixtureInvoice.id,onUpdated:()=>updated.push('updated')});};
 return{states,effects,layouts,requests,updated,shares,opened,render,all,ui,handlers:()=>mod.exports.getTestHandlers(),state:n=>states[names.indexOf(n)],setState:(n,v)=>{const i=names.indexOf(n);assert.ok(i>=0,n);states[i]=v;},setResponse:fn=>{response=fn;},setTenant:value=>{tenant=value;},cleanup:()=>{global.fetch=original.fetch;global.Date=original.Date;global.window=original.window;if(original.navigator)Object.defineProperty(global,'navigator',original.navigator);else delete global.navigator;}};
}
function withCase(kind,name,check){test(name,async()=>{const h=harness(kind);try{await check(h);}finally{h.cleanup();}});}
const submitEvent={preventDefault(){}};
async function prepareCreate(h){h.render();await h.handlers().load();h.render();h.handlers().openCreate();h.render();h.requests.length=0;}
function readyDetail(h,patch={}){h.render();const invoice={...structuredClone(fixtureInvoice),...patch};h.setState('invoice',invoice);h.setState('form',{tax_calculation_mode:invoice.tax_calculation_mode,subject:invoice.subject??'',issue_date:invoice.issue_date,due_date:invoice.due_date??'',currency:invoice.currency,notes:invoice.notes??'',terms_conditions:invoice.terms_conditions??'',internal_notes:invoice.internal_notes??'',lines:invoice.items.map(i=>({description:i.description,quantity:String(i.quantity),unit_price:String(i.unit_price),discount_percent:String(i.discount_percent),tax_rate:String(i.tax_rate)}))});h.setState('loading',false);return h.render();}
function editDetail(h){h.handlers().beginEdit();h.render();}
function cancelDetail(h){h.handlers().openCancellation();h.render();}
function reverseDetail(h){h.setState('payments',[fixturePayment]);h.render();h.handlers().beginReversal(fixturePayment);h.setState('reversalReason','Synthetic reason');h.render();h.handlers().reviewReversal();h.render();}
function readyPayment(h,invoicePatch={},paymentPatch={}){h.render();h.setState('invoice',{...fixtureInvoice,...invoicePatch});h.setState('payment',{...fixtureInstructions,...paymentPatch});h.setState('destinations',[fixtureDestination]);h.setState('form',{method:'bank_transfer',accountId:'synthetic-bank',paymentUrl:'',instructions:'Synthetic instructions'});h.setState('loading',false);return h.render();}
function preparePaymentEdit(h){readyPayment(h);h.handlers().beginEdit();return h.render();}
function labelText(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(labelText).join(' ');return labelText(node.props?.children);}
const button=(h,tree,label)=>h.all(tree,'button').find(n=>labelText(n.props.children).replace(/\s+/g,' ').trim()===label);

withCase('list','Invoice load retains four no-store endpoints and server-provided items',async h=>{h.render();await h.handlers().load();assert.deepEqual(h.requests.map(r=>r.url),['/api/finance/meta','/api/finance/invoice-page?limit=100','/api/inventory/products','/api/accounting/tax/codes']);assert.ok(h.requests.every(r=>r.options.cache==='no-store'));assert.equal(h.state('loading'),false);});
withCase('list','List error preserves structured server detail and clears loading',async h=>{h.render();h.setResponse(url=>url.includes('invoice-page')?failure([{loc:['body','currency'],msg:'Synthetic invalid currency'}]):success(url.includes('meta')?{clients:[],orders:[],projects:[]}:[]));await h.handlers().load();assert.match(h.state('error'),/currency: Synthetic invalid currency/);assert.equal(h.state('loading'),false);});
withCase('list','Invoice filters apply full-history server search, currency, status and balance and reset cursors',async h=>{h.render();await h.handlers().load();h.setState('query',' Synthetic client ');h.setState('statusFilter','sent');h.setState('currencyFilter','GBP');h.setState('dueFilter','outstanding');h.render();h.handlers().applyFilters(submitEvent);await settle();const url=h.requests.filter(r=>r.url.includes('invoice-page')).at(-1).url;const params=new URL(url,'https://test.invalid').searchParams;assert.equal(params.get('search'),'Synthetic client');assert.equal(params.get('status'),'sent');assert.equal(params.get('currency'),'GBP');assert.equal(params.get('balance'),'outstanding');assert.equal(params.has('cursor'),false);h.render();h.handlers().clearFilters();await settle();assert.equal(h.state('query'),'');assert.equal(h.state('statusFilter'),'all');assert.equal(h.state('currencyFilter'),'all');assert.equal(h.state('dueFilter'),'all');assert.equal(h.requests.filter(r=>r.url.includes('invoice-page')).at(-1).url,'/api/finance/invoice-page?limit=100');});
withCase('list','Draft filter edits do not mislabel loaded rows; Apply uses server-backed search while currency remains explicit',async h=>{h.render();h.setResponse(url=>success(url.includes('invoice-page')?{items:[fixtureInvoice]}:url.includes('/meta')?{clients:[],orders:[],projects:[]}:[]));await h.handlers().load();h.setState('query','not-present');h.render();assert.equal(h.handlers().filteredInvoices.length,1);h.setResponse(url=>success(url.includes('invoice-page')?{items:[]}:url.includes('/meta')?{clients:[],orders:[],projects:[]}:[]));h.handlers().applyFilters(submitEvent);await settle();const register=h.all(h.render(),'InvoiceRegister')[0];assert.ok(register);assert.equal(register.props.invoices.length,0);assert.match(text(register.type(register.props)),/No matching invoices/);assert.equal(h.state('appliedFilters').search,'not-present');});
withCase('list','Cancelled project/order sources and inactive/foreign catalog items remain excluded',h=>{h.render();h.setState('meta',{clients:[],projects:[{id:'p1',status:'active',number:'P1',name:'Synthetic',currency:'USD',contract_value:100},{id:'p2',status:'cancelled'}],orders:[{id:'o1',status:'confirmed',number:'O1',client_name:'Synthetic',currency:'USD',total:100},{id:'o2',status:'cancelled'}]});h.setState('catalog',[{id:'a',is_active:true,currency:'USD'},{id:'b',is_active:false,currency:'USD'},{id:'c',is_active:true,currency:'BDT'}]);h.setState('form',{...h.state('form'),currency:'USD'});h.render();assert.deepEqual(h.handlers().projectOptions.map(i=>i.value),['p1']);assert.deepEqual(h.handlers().orderOptions.map(i=>i.value),['o1']);assert.deepEqual(h.handlers().availableCatalog.map(i=>i.id),['a']);});
withCase('list','Manual currency change clears catalog lines but preserves custom lines',async h=>{await prepareCreate(h);h.setState('form',{...h.state('form'),currency:'USD',lines:[{...h.state('form').lines[0],product_id:'product',description:'Synthetic'}]});h.render();h.handlers().changeManualCurrency('BDT');assert.equal(h.state('form').currency,'BDT');assert.equal(h.state('form').lines[0].product_id,null);assert.match(h.state('error'),/different currencies cannot be mixed/);h.setState('form',{...h.state('form'),lines:[{...h.state('form').lines[0],description:'Preserve custom'}]});h.render();h.handlers().changeManualCurrency('EUR');assert.equal(h.state('form').lines[0].description,'Preserve custom');});
withCase('list','Draft estimate retains discount-before-tax and inclusive versus exclusive math',h=>{h.render();const line={...h.state('form').lines[0],quantity:'2',unit_price:'100',discount_percent:'10',tax_rate:'5'};h.setState('form',{...h.state('form'),lines:[line],tax_calculation_mode:'exclusive'});h.render();assert.equal(h.handlers().draftTotal,'189.00');h.setState('form',{...h.state('form'),tax_calculation_mode:'inclusive'});h.render();assert.equal(h.handlers().draftTotal,'180.00');});
withCase('list','Catalog selection preserves snapshots and active sales-tax lookup',async h=>{await prepareCreate(h);h.setState('catalog',[{id:'p',sku:'SYN',name:'Synthetic service',description:'Synthetic description',item_type:'service',unit:'hour',currency:'USD',selling_price:'25.50',tax_code_id:'tax',is_active:true}]);h.setState('taxCodes',[{id:'tax',tax_kind:'sales',rate:'7.5',is_active:true}]);h.render();h.handlers().selectLineSource(0,'catalog:p');assert.equal(h.state('form').lines[0].unit_price,'25.50');assert.equal(h.state('form').lines[0].tax_rate,'7.5');assert.equal(h.state('form').lines[0].product_id,'p');h.render();h.handlers().selectLineSource(0,'custom:non_stock_item');assert.equal(h.state('form').lines[0].product_id,null);assert.equal(h.state('form').lines[0].item_type,'non_stock_item');});
withCase('list','Source reset clears source-specific draft values and errors',async h=>{await prepareCreate(h);h.setState('form',{...h.state('form'),client_id:'client',source_id:'source',notes:'Synthetic notes'});h.setState('error','Synthetic error');h.render();h.handlers().resetSource('order');assert.equal(h.state('source'),'order');assert.equal(h.state('form').source_id,'');assert.equal(h.state('form').client_id,'');assert.equal(h.state('form').lines.length,1);assert.equal(h.state('error'),null);});
withCase('list','Payment details without method are rejected before any creation request',async h=>{await prepareCreate(h);h.render();h.setState('payment',{method:'',accountId:'',url:'https://pay.example.invalid',instructions:''});h.render();await h.handlers().submit(submitEvent);assert.equal(h.requests.length,0);assert.match(h.state('error'),/Choose a payment method/);assert.equal(h.state('saving'),false);});
withCase('list','Invalid manual line is rejected locally without a creation request',async h=>{await prepareCreate(h);h.render();h.setState('source','client');h.render();await h.handlers().submit(submitEvent);assert.equal(h.requests.length,0);assert.equal(h.state('error'),'Complete all invoice lines.');});
for(const source of ['project','order'])withCase('list',`${source} invoice creation retains source endpoint and payment instructions payload`,async h=>{await prepareCreate(h);h.render();h.setState('source',source);h.setState('form',{...h.state('form'),source_id:'synthetic-source'});h.setState('payment',{method:'bank_transfer',accountId:'synthetic-bank',url:'  https://pay.example.invalid/synthetic  ',instructions:'  Synthetic only  '});h.setResponse((url,opt)=>opt?.method==='POST'?success({invoice_number:'SYN-NEW'}):success(url.includes('meta')?{clients:[],orders:[],projects:[]}:url.includes('invoice-page')?{items:[]}:[]));h.render();await h.handlers().submit(submitEvent);const req=h.requests.find(r=>r.options?.method==='POST');assert.equal(req.url,`/api/finance/invoices/from-${source}/synthetic-source`);assert.deepEqual(JSON.parse(req.options.body),{payment_details:{payment_method:'bank_transfer',payment_account_id:'synthetic-bank',payment_url:'https://pay.example.invalid/synthetic',payment_instructions:'Synthetic only'}});assert.equal(h.state('showForm'),false);assert.match(h.state('message'),/acknowledged as created/);});
withCase('list','Direct invoice submission retains exact numeric item payload and draft-only behavior',async h=>{await prepareCreate(h);h.render();h.setState('source','client');h.setState('form',{source_id:'',client_id:'synthetic-client',subject:'Synthetic scope',issue_date:'2026-10-24',due_date:'',currency:'USD',tax_calculation_mode:'inclusive',notes:'',lines:[{product_id:null,item_name:'Synthetic service',item_type:'service',unit:'hour',description:'Synthetic work',quantity:'2.5',unit_price:'10',discount_percent:'5',tax_rate:'7.5'}]});h.setResponse((_url,opt)=>opt?.method==='POST'?failure('Synthetic rejection'):success([]));h.render();await h.handlers().submit(submitEvent);assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/finance/invoices');assert.deepEqual(JSON.parse(h.requests[0].options.body),{client_id:'synthetic-client',subject:'Synthetic scope',issue_date:'2026-10-24',due_date:null,currency:'USD',tax_calculation_mode:'inclusive',notes:null,terms_conditions:null,payment_details:null,items:[{product_id:null,item_name:'Synthetic service',item_type:'service',unit:'hour',description:'Synthetic work',quantity:2.5,unit_price:10,discount_percent:5,tax_rate:7.5}]});assert.equal(h.state('error'),'Synthetic rejection');assert.equal(h.state('saving'),false);});
withCase('list','Payment destinations keep provider defaults and abort on closed creation form',async h=>{await prepareCreate(h);h.render();const cancel=h.effects.find(fn=>fn.toString().includes('/api/finance/payment-destinations'))();await settle();assert.equal(h.state('destinations')[0].id,'synthetic-bank');cancel();assert.equal(h.requests[0].options.signal.aborted,true);h.render();h.handlers().selectPaymentDestination('synthetic-bank');assert.equal(h.state('payment').method,'bank_transfer');assert.equal(h.state('payment').url,fixtureDestination.payment_url);});

withCase('detail','Detail load retains invoice and payment-history endpoints and snapshots',async h=>{h.render();await h.handlers().load();assert.deepEqual(h.requests.map(r=>r.url),['/api/finance/invoices/synthetic-invoice','/api/finance/payments?invoice_id=synthetic-invoice&limit=100']);assert.ok(h.requests.every(r=>r.options.cache==='no-store'));assert.equal(h.state('form').lines[0].quantity,'2');assert.equal(h.state('loading'),false);});
withCase('detail','Draft editing cancellation restores original form without sending a request',h=>{readyDetail(h);editDetail(h);h.setState('form',{...h.state('form'),subject:'Unsaved synthetic change'});button(h,h.render(),'Cancel edit').props.onClick();assert.equal(h.state('editing'),false);assert.equal(h.state('form').subject,'Synthetic scope');assert.equal(h.requests.length,0);});
withCase('detail','Draft save retains PATCH payload, reload and client-preview refresh callback',async h=>{readyDetail(h);editDetail(h);await h.handlers().saveDraft();const req=h.requests[0];assert.equal(req.url,'/api/finance/invoices/synthetic-invoice/draft');assert.equal(req.options.method,'PATCH');const body=JSON.parse(req.options.body);assert.equal(body.tax_calculation_mode,'exclusive');assert.equal(body.items[0].quantity,2);assert.equal(body.items[0].tax_rate,5);assert.equal(body.notes,null);assert.deepEqual(h.updated,['updated']);assert.equal(h.state('editing'),false);assert.equal(h.state('saving'),false);});
withCase('detail','Send invoice retains status action, reload and preview refresh',async h=>{readyDetail(h);await h.handlers().sendInvoice();assert.equal(h.requests[0].url,'/api/finance/invoices/synthetic-invoice/status');assert.deepEqual(JSON.parse(h.requests[0].options.body),{action:'send'});assert.match(h.state('message'),/Commercial details are now locked/);assert.deepEqual(h.updated,['updated']);});
withCase('detail','Draft/sent/paid/cancelled states keep edit, cancel and collect eligibility',h=>{for(const [status,paid,due,edit,collect,cancel] of [['draft',0,210,true,false,true],['sent',0,210,false,true,true],['partially_paid',20,190,false,true,false],['paid',210,0,false,false,false],['cancelled',0,210,false,false,false]]){const tree=readyDetail(h,{status,display_status:status,amount_paid:paid,balance_due:due});assert.equal(Boolean(button(h,tree,'Edit draft')),edit,status);assert.equal(h.all(tree,'a').some(n=>n.props.href?.includes('money-in?invoice_id=')),collect,status);assert.equal(Boolean(button(h,tree,'Cancel invoice')),cancel,status);}});
withCase('detail','Invoice cancellation requires a reason and preserves audit payload on confirmation',async h=>{readyDetail(h);cancelDetail(h);h.setState('cancelReason',' x ');h.render();await h.handlers().cancelInvoice();assert.equal(h.requests.length,0);h.setState('cancelReason','  Synthetic cancellation  ');h.setState('cancelOpen',true);h.render();await h.handlers().cancelInvoice();assert.deepEqual(JSON.parse(h.requests[0].options.body),{action:'cancel',reason:'Synthetic cancellation'});assert.equal(h.state('cancelOpen'),false);assert.equal(h.state('cancelReason'),'');assert.deepEqual(h.updated,['updated']);});
withCase('detail','Cancellation Go back dismisses the dialog without a mutation',h=>{readyDetail(h);cancelDetail(h);button(h,h.render(),'Go back').props.onClick();assert.equal(h.state('cancelOpen'),false);assert.equal(h.requests.length,0);});
withCase('detail','Payment reversal UI requires finance.manage or wildcard and a confirmed payment',h=>{readyDetail(h,{status:'partially_paid'});h.setState('payments',[fixturePayment]);h.setTenant({permissions:['finance.view']});assert.equal(Boolean(button(h,h.render(),'Reverse payment')),false);h.setTenant({permissions:['finance.manage']});assert.equal(Boolean(button(h,h.render(),'Reverse payment')),true);h.setState('payments',[{...fixturePayment,status:'reversed'}]);assert.equal(Boolean(button(h,h.render(),'Reverse payment')),false);});
withCase('detail','Reversal review and Back preserve reason without posting',h=>{readyDetail(h);reverseDetail(h);h.setState('selectedPayment',fixturePayment);h.setState('reversalReason','Synthetic reason');h.setState('confirmingReversal',true);const dialog=h.all(h.render(),'FinancialConfirmationDialog')[0];assert.equal(dialog.props.open,true);assert.ok(dialog.props.details.some(d=>d.label==='Receiving account'&&d.value.includes('BDT')));dialog.props.onCancel();assert.equal(h.state('confirmingReversal'),false);assert.equal(h.state('reversalReason'),'Synthetic reason');assert.equal(h.requests.length,0);});
withCase('detail','Reversal action guards status/reason then retains accounting correction payload',async h=>{readyDetail(h);h.setState('payments',[fixturePayment]);h.setState('selectedPayment',{...fixturePayment,status:'reversed'});h.setState('reversalReason','Synthetic reason');h.render();await h.handlers().reversePayment();assert.equal(h.requests.length,0);reverseDetail(h);h.setState('reversalReason','  Synthetic reason  ');h.render();await h.handlers().reversePayment();assert.equal(h.requests[0].url,'/api/accounting/corrections/reverse');assert.deepEqual(JSON.parse(h.requests[0].options.body),{source_type:'payment',source_id:'synthetic-payment',reason:'Synthetic reason'});assert.equal(h.state('selectedPayment'),null);assert.equal(h.state('confirmingReversal'),false);assert.equal(h.state('reversing'),false);assert.deepEqual(h.updated,['updated']);});
withCase('detail','Reversal server error closes confirmation, keeps error and releases pending guard',async h=>{readyDetail(h);reverseDetail(h);h.setState('payments',[fixturePayment]);h.setState('selectedPayment',fixturePayment);h.setState('reversalReason','Synthetic reason');h.setState('confirmingReversal',true);h.setResponse(()=>failure('Synthetic reversal denied'));h.render();await h.handlers().reversePayment();assert.equal(h.state('error'),'Synthetic reversal denied');assert.equal(h.state('selectedPayment'),null);assert.equal(h.state('confirmingReversal'),false);assert.equal(h.state('reversing'),false);assert.deepEqual(h.updated,[]);});
withCase('detail','Payment history keeps invoice and receiving currencies separate',h=>{readyDetail(h);h.setState('payments',[fixturePayment]);const content=text(h.render());assert.match(content,/USD 20\.00/);assert.match(content,/BDT 2,400\.00/);assert.match(content,/does not issue a refund or move real money/);});
withCase('detail','Share fallback copies only the original print URL with no API mutation',async h=>{readyDetail(h);await h.handlers().shareInvoice();assert.deepEqual(h.shares,['https://preview.example.invalid/print/invoices/synthetic-invoice']);assert.equal(h.requests.length,0);assert.match(h.state('message'),/link copied/);});
withCase('detail','Native share cancellation stays quiet and never posts',async h=>{readyDetail(h);global.navigator.share=async()=>{throw new DOMException('Synthetic cancel','AbortError');};await h.handlers().shareInvoice();assert.equal(h.state('error'),null);assert.equal(h.requests.length,0);assert.equal(h.shares.length,0);});

withCase('payment','Payment preview loads invoice, instruction snapshot and destinations without cache',async h=>{h.render();await h.handlers().load();assert.deepEqual(h.requests.map(r=>r.url),['/api/finance/invoices/synthetic-invoice','/api/finance/invoices/synthetic-invoice/payment-instructions','/api/finance/payment-destinations']);assert.equal(h.state('form').method,'bank_transfer');assert.equal(h.state('loading'),false);});
withCase('payment','Locked and non-draft invoices never expose payment editing',h=>{for(const [status,locked,allowed] of [['draft',false,true],['draft',true,false],['sent',false,false],['paid',true,false]]){const tree=readyPayment(h,{status},{locked});assert.equal(Boolean(button(h,tree,'Edit payment details')),allowed,status+' '+locked);}});
withCase('payment','Payment editing Cancel restores saved snapshot and clears save-defaults option',h=>{preparePaymentEdit(h);h.setState('saveDefaults',true);h.setState('form',{method:'cash',accountId:'',paymentUrl:'',instructions:'Unsaved change'});button(h,h.render(),'Cancel').props.onClick();assert.equal(h.state('form').instructions,'Synthetic instructions');assert.equal(h.state('editing'),false);assert.equal(h.state('saveDefaults'),false);assert.equal(h.requests.length,0);});
withCase('payment','Clearing payment method clears account/link/instructions and defaults toggle',h=>{preparePaymentEdit(h);h.setState('saveDefaults',true);h.render();h.handlers().changeMethod('');assert.deepEqual(h.state('form'),{method:'',accountId:'',paymentUrl:'',instructions:''});assert.equal(h.state('saveDefaults'),false);});
withCase('payment','Payment destination selection uses existing method inference and saved defaults',h=>{preparePaymentEdit(h);h.handlers().selectDestination('synthetic-bank');assert.deepEqual(h.state('form'),{method:'bank_transfer',accountId:'synthetic-bank',paymentUrl:fixtureDestination.payment_url,instructions:fixtureDestination.payment_instructions});});
withCase('payment','Payment save rejects orphan details locally and retains pending/error semantics',async h=>{preparePaymentEdit(h);h.setState('form',{method:'',accountId:'synthetic-bank',paymentUrl:'',instructions:''});h.render();await h.handlers().savePaymentInstructions();assert.equal(h.requests.length,0);assert.match(h.state('error'),/Choose a payment method/);});
withCase('payment','Payment instructions save keeps trimmed nullable snapshot payload and reload',async h=>{preparePaymentEdit(h);h.setState('form',{method:'other',accountId:'',paymentUrl:'  https://pay.example.invalid/review  ',instructions:'  Synthetic note  '});h.render();await h.handlers().savePaymentInstructions();assert.equal(h.requests[0].options.method,'PATCH');assert.deepEqual(JSON.parse(h.requests[0].options.body),{payment_method:'other',payment_account_id:null,payment_url:'https://pay.example.invalid/review',payment_instructions:'Synthetic note'});assert.equal(h.state('editing'),false);assert.equal(h.state('saveDefaults'),false);assert.equal(h.state('saving'),false);});
withCase('payment','Account-default update requires explicit toggle and preserves partial-success warning',async h=>{preparePaymentEdit(h);h.setState('saveDefaults',true);h.setResponse(url=>url==='/api/finance/payment-destinations/synthetic-bank'?failure('Synthetic defaults denied'):success(url.endsWith('/payment-instructions')?fixtureInstructions:url==='/api/finance/payment-destinations'?[fixtureDestination]:fixtureInvoice));h.render();await h.handlers().savePaymentInstructions();const req=h.requests.find(r=>r.url==='/api/finance/payment-destinations/synthetic-bank');assert.equal(req.options.method,'PATCH');assert.deepEqual(JSON.parse(req.options.body),{payment_url:null,payment_instructions:'Synthetic instructions'});assert.match(h.state('message'),/Invoice saved, but account defaults could not be updated/);});
withCase('payment','Client preview retains server totals and never sums different currencies',h=>{const tree=readyPayment(h);const totals=h.all(tree,'TotalRow');assert.deepEqual(totals.map(n=>[n.props.label,n.props.value]),[['Subtotal','USD 200.00'],['Discount','USD 0.00'],['Tax','USD 10.00'],['Total','USD 210.00'],['Paid','USD 0.00']]);assert.ok(h.all(tree,'Meta').some(n=>n.props.label==='Amount due'&&n.props.value==='USD 210.00'));});
withCase('payment','Print action retains encoded dedicated route and safe new-window flags',h=>{readyPayment(h,{id:'synthetic/id'},{invoice_id:'synthetic/id'});h.render({invoiceId:'synthetic/id'});h.layouts.forEach(effect=>effect());h.handlers().printInvoice();assert.deepEqual(h.opened,[['/print/invoices/synthetic%2Fid','_blank','noopener,noreferrer']]);assert.equal(h.requests.length,0);});
withCase('workspace','Detail refresh invalidates payment preview with original revision key',h=>{let tree=h.render({invoiceId:'synthetic-invoice'});const before=h.all(tree,'InvoicePaymentWorkspace')[0].key;h.all(tree,'InvoiceDetailWorkspace')[0].props.onUpdated();tree=h.render({invoiceId:'synthetic-invoice'});assert.match(before,/synthetic-invoice.*:0$/);assert.equal(h.all(tree,'InvoicePaymentWorkspace')[0].key,before.slice(0,-1)+'1');});

withCase('list', 'Register retains all seven data fields, detail links and currency-specific amounts', h => {
 h.render();
 h.setState('invoices', [fixtureInvoice, {...fixtureInvoice, id:'synthetic-bdt', currency:'BDT', total:'24000', amount_paid:'2400', balance_due:'21600'}]);
 h.setState('loading', false);
 h.setState('registerReady', true);
 const register = h.all(h.render(), 'InvoiceRegister')[0];
 const tree = register.type(register.props);
 assert.equal(h.all(tree, 'th').length, 7);
 assert.ok(h.all(tree, 'th').every(cell => cell.props.scope === 'col'));
 const rows = h.all(tree, 'tbody')[0].props.children;
 assert.equal(rows.length, 2);
 for (const row of rows) assert.equal(h.all(row, 'td').length, 7);
 assert.deepEqual(h.all(tree, 'a').map(link => link.props.href), ['/dashboard/accounting/invoices/synthetic-invoice', '/dashboard/accounting/invoices/synthetic-bdt']);
 assert.deepEqual(h.all(rows[0], 'td').slice(-3).map(labelText), ['USD 210.00','USD 0.00','USD 210.00']);
 assert.deepEqual(h.all(rows[1], 'td').slice(-3).map(labelText), ['BDT 24,000.00','BDT 2,400.00','BDT 21,600.00']);
 assert.deepEqual(h.all(tree, 'InvoiceStatus').map(status => status.props.status), ['draft','draft']);
 assert.equal(h.requests.length, 0);
});

withCase('list', 'Register loading and empty states are mutually exclusive and announce pending work', h => {
 h.render();
 for (const loading of [true,false]) {
  const tree = h.ui.InvoiceRegister({invoices:[], loading, currentDate:'2026-10-24', formatMoney:()=>''});
  assert.equal(tree.props['aria-busy'], loading);
  assert.equal(h.all(tree, 'p').some(p => p.props.role === 'status'), loading);
  assert.equal(labelText(tree).includes('No matching invoices'), !loading);
 }
});

withCase('list', 'New invoice and Close create preserve draft-only local navigation', async h => {
 h.render();await h.handlers().load();h.requests.length=0;let tree=h.render();
 h.setState('source', 'client');
 h.setState('payment', {method:'cash',accountId:'synthetic-bank',url:'',instructions:'Unsaved'});
 tree = h.render();
 button(h, tree, 'New invoice').props.onClick();
 assert.equal(h.state('source'), 'client');
 assert.equal(h.state('showForm'), true);
 assert.deepEqual(h.state('payment'), {method:'cash',accountId:'synthetic-bank',url:'',instructions:'Unsaved'});
 const close = h.all(h.render(), 'button').find(b => b.props['aria-label'] === 'Close create invoice');
 assert.ok(close);
 assert.equal(close.props.type, 'button');
 close.props.onClick();
 assert.equal(h.state('showForm'), false);
 assert.equal(h.requests.length, 0);
});

withCase('list', 'Source-required and pending create buttons retain their disabled guards', h => {
 h.render(); h.setState('showForm', true);
 for (const source of ['project','order']) {
  h.setState('source', source);
  h.setState('form', {...h.state('form'), source_id:''});
  assert.equal(button(h, h.render(), 'Create draft invoice').props.disabled, true);
  h.setState('form', {...h.state('form'), source_id:'synthetic-source'});
  assert.equal(button(h, h.render(), 'Create draft invoice').props.disabled, false);
 }
 h.setState('saving', true);
 assert.equal(button(h, h.render(), 'Creating…').props.disabled, true);
});

withCase('list', 'Accessible register filters continue to update their corresponding state', h => {
 const tree = h.render();
 const controls = [...h.all(tree,'input'), ...h.all(tree,'select')];
 for (const [label,state,value] of [['Search invoices','query','Synthetic'],['Invoice status','statusFilter','sent'],['Invoice currency','currencyFilter','BDT'],['Invoice balance','dueFilter','outstanding']]) {
  const control = controls.find(item => item.props['aria-label'] === label);
  assert.ok(control, label);
  control.props.onChange({target:{value}});
  assert.equal(h.state(state), value);
 }
 assert.equal(h.requests.length, 0);
});

withCase('list', 'Extracted line editor preserves native validation, catalog locks and field callbacks', h => {
 h.render();
 const changes = [], sources = [], removed = [];
 const line = {...h.state('form').lines[0], product_id:'synthetic-product',item_name:'Synthetic item'};
 const tree = h.ui.InvoiceLineEditor({line,index:0,sourceValue:'catalog:synthetic-product',sourceOptions:[],total:'USD 2.00',canRemove:false,onSourceChange:value=>sources.push(value),onChange:patch=>changes.push(patch),onRemove:()=>removed.push(true)});
 const fields = h.all(tree, 'InvoiceField');
 const input = label => fields.find(field => field.props.label === label).props.children;
 assert.equal(input('Item / service name').props.required, true);
 assert.equal(input('Description').props.required, true);
 assert.equal(input('Item / service name').props.disabled, true);
 assert.equal(input('Unit').props.disabled, true);
 assert.equal(input('Quantity').props.min, '0.0001');
 assert.equal(input('Unit price').props.min, '0');
 for (const label of ['Discount %','Tax %']) assert.deepEqual([input(label).props.min,input(label).props.max,input(label).props.step],['0','100','0.01']);
 for (const [label,key] of [['Item / service name','item_name'],['Quantity','quantity'],['Unit','unit'],['Description','description'],['Unit price','unit_price'],['Discount %','discount_percent'],['Tax %','tax_rate']]) input(label).props.onChange({target:{value:'synthetic-'+key}});
 assert.deepEqual(changes, ['item_name','quantity','unit','description','unit_price','discount_percent','tax_rate'].map(key=>({[key]:'synthetic-'+key})));
 h.all(tree, 'SearchableSelect')[0].props.onValueChange('custom:service');
 assert.deepEqual(sources, ['custom:service']);
 const remove = h.all(tree, 'button')[0];
 assert.equal(remove.props.disabled, true);
 assert.equal(remove.props.type, 'button');
 assert.equal(remove.props['aria-label'], 'Remove line 1');
 assert.match(labelText(tree), /USD 2\.00/);
 assert.deepEqual(removed, []);
});

withCase('list', 'Parent line-editor wiring keeps additions, per-line changes and last-line protection', async h => {
 await prepareCreate(h); h.setState('source','client');
 let tree = h.render();
 assert.equal(h.all(tree,'InvoiceLineEditor')[0].props.canRemove, false);
 button(h, tree, '+ Add line').props.onClick();
 tree = h.render();
 const lines = h.all(tree,'InvoiceLineEditor');
 assert.equal(lines.length, 2);
 assert.ok(lines.every(line=>line.props.canRemove));
 lines[1].props.onChange({description:'Second synthetic line'});
 assert.equal(h.state('form').lines[0].description, '');
 assert.equal(h.state('form').lines[1].description, 'Second synthetic line');
 h.all(h.render(),'InvoiceLineEditor')[0].props.onRemove();
 assert.equal(h.state('form').lines.length, 1);
 assert.equal(h.state('form').lines[0].description, 'Second synthetic line');
 assert.equal(h.all(h.render(),'InvoiceLineEditor')[0].props.canRemove, false);
 assert.equal(h.requests.length, 0);
});

for (const permissions of [[], ['finance.view']]) withCase('list',`Register read-only permissions ${permissions} block create and setup enumeration`,async h=>{
 h.setTenant({permissions});h.render();await h.handlers().load();await h.handlers().submit(submitEvent);h.handlers().openCreate();assert.equal(h.state('showForm'),false);assert.equal(h.requests.some(r=>r.options?.method==='POST'),false);assert.deepEqual(h.requests.map(r=>r.url),permissions.length?['/api/finance/invoice-page?limit=100']:[]);
});
withCase('list','Pending create blocks same-event duplicate, close, source and line mutation',async h=>{await prepareCreate(h);
 h.render();h.setState('showForm',true);h.setState('form',{...h.state('form'),source_id:'synthetic-source'});h.render();let release;h.setResponse(()=>new Promise(r=>release=r));const old=h.handlers();const pending=old.submit(submitEvent);await old.submit(submitEvent);old.closeCreate();old.resetSource('client');old.updateLine(0,{description:'Forbidden'});assert.equal(h.requests.length,1);assert.equal(h.state('showForm'),true);assert.equal(h.state('source'),'project');assert.equal(h.state('form').lines[0].description,'');release(failure('Validation',422));await pending;
});
for(const [kind,response] of [['network',()=>Promise.reject(new Error('Lost'))],['408',()=>failure('Timeout',408)],['409',()=>failure('Conflict',409)],['500',()=>failure('Failure',500)],['malformed422',()=>({ok:false,status:422,json:async()=>null})]])withCase('list',`Unknown ${kind} source create freezes draft and readonly load never unlocks`,async h=>{await prepareCreate(h);
 h.render();h.setState('showForm',true);h.setResponse(response);const old=h.handlers();await old.submit(submitEvent);h.render();assert.equal(h.state('unknownCreate'),true);old.resetSource('client');old.closeCreate();await old.submit(submitEvent);assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,1);assert.equal(h.state('showForm'),true);h.setResponse(url=>success(url.includes('meta')?{clients:[],orders:[],projects:[]}:url.includes('invoice-page')?{items:[]}:[]));await h.handlers().load();await h.handlers().submit(submitEvent);assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,1);assert.equal(h.state('unknownCreate'),true);
});
withCase('list','Acknowledged malformed create cannot repeat and fresh explicit draft invalidates old handler',async h=>{await prepareCreate(h);
 h.render();h.setResponse((url,opt)=>opt?.method?success(null):success(url.includes('meta')?{clients:[],orders:[],projects:[]}:url.includes('invoice-page')?{items:[]}:[]));const old=h.handlers();await old.submit(submitEvent);await old.submit(submitEvent);assert.equal(h.requests.filter(r=>r.options?.method).length,1);assert.match(h.state('message'),/acknowledged/);h.render();h.handlers().openCreate();h.render();await old.submit(submitEvent);assert.equal(h.requests.filter(r=>r.options?.method).length,1);
});
withCase('list','Unmounted and replaced tenant create callbacks cannot dispatch or apply old success',async h=>{
 h.setTenant({organization:{id:'old'},permissions:['*']});await prepareCreate(h);const cleanup=h.layouts.at(-1)();const old=h.handlers();cleanup();await old.submit(submitEvent);assert.equal(h.requests.length,0);
});
withCase('list','Committed role change rejects retained manager create callback',async h=>{
 h.setTenant({organization:{id:'old'},permissions:['*']});await prepareCreate(h);h.layouts.at(-1)();const old=h.handlers();h.setTenant({organization:{id:'old'},permissions:['finance.view']});h.render();h.layouts.at(-1)();await old.submit(submitEvent);assert.equal(h.requests.length,0);
});
withCase('list','Newer register response wins and malformed register is unavailable not empty success',async h=>{
 h.render();let releases=[];h.setResponse(()=>new Promise(r=>releases.push(r)));const old=h.handlers().load();h.setResponse(url=>success(url.includes('meta')?{clients:[],orders:[],projects:[]}:url.includes('invoice-page')?{items:[fixtureInvoice]}:[]));await h.handlers().load();releases.forEach((r,i)=>r(success(i===0?{clients:[],orders:[],projects:[]}:i===1?{items:[]}:[])));await old;assert.equal(h.state('invoices').length,1);h.setResponse(()=>success({}));await h.handlers().load();assert.match(h.state('error'),/could not be verified/);assert.equal(h.state('invoices').length,0);
});
withCase('list','Unknown unkeyed manual create never repeats opening draft submission',async h=>{await prepareCreate(h);
 h.render();h.setState('source','client');h.setState('form',{...h.state('form'),client_id:'synthetic-client',lines:[{...h.state('form').lines[0],item_name:'Synthetic',description:'Synthetic',unit_price:'1'}]});h.render();h.setResponse(()=>Promise.reject(new Error('Lost manual response')));await h.handlers().submit(submitEvent);h.render();await h.handlers().submit(submitEvent);assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/finance/invoices');assert.equal(h.state('unknownCreate'),true);
});
withCase('list','Late create success cannot close or replace a different committed scope',async h=>{
 h.setTenant({organization:{id:'one'},permissions:['*']});await prepareCreate(h);h.layouts.at(-1)();h.setState('showForm',true);h.render();let release;h.setResponse(()=>new Promise(r=>release=r));const pending=h.handlers().submit(submitEvent);h.setTenant({organization:{id:'two'},permissions:['*']});h.render();h.layouts.at(-1)();release(success({id:'old-invoice',invoice_number:'OLD'}));await pending;assert.equal(h.state('showForm'),true);assert.equal(h.state('message'),null);
});

withCase('list','Closed and reopened create sessions reject old submit while preserving draft fields',async h=>{
 await prepareCreate(h);h.setState('source','client');h.setState('form',{...h.state('form'),client_id:'synthetic-client',notes:'Retained',lines:[{...h.state('form').lines[0],item_name:'Synthetic',description:'Synthetic',unit_price:'1'}]});h.render();const old=h.handlers();old.closeCreate();await old.submit(submitEvent);assert.equal(h.requests.length,0);h.render();h.handlers().openCreate();h.render();await old.submit(submitEvent);assert.equal(h.requests.length,0);assert.equal(h.state('form').notes,'Retained');
});
withCase('list','Hidden form and unavailable creation setup cannot dispatch',async h=>{h.render();await h.handlers().submit(submitEvent);assert.equal(h.requests.length,0);await prepareCreate(h);h.setResponse(()=>success({}));await h.handlers().load();h.requests.length=0;await h.handlers().submit(submitEvent);assert.equal(h.requests.length,0);});
for(const action of ['saveDraft','sendInvoice','cancelInvoice','reversePayment'])withCase('detail',`Viewer cannot invoke ${action} and keeps readable invoice`,async h=>{h.setTenant({permissions:['finance.view']});const tree=readyDetail(h);h.setState('cancelReason','Synthetic reason');h.setState('selectedPayment',fixturePayment);h.setState('payments',[fixturePayment]);h.setState('reversalReason','Synthetic reason');h.render();await h.handlers()[action]();assert.equal(h.requests.length,0);assert.equal(h.state('invoice').id,fixtureInvoice.id);assert.equal(button(h,tree,'Edit draft'),undefined);});
withCase('detail','Pending invoice write blocks other same-event mutations and Cancel edit',async h=>{readyDetail(h);editDetail(h);h.render();let release;h.setResponse(()=>new Promise(r=>release=r));const old=h.handlers();const pending=old.saveDraft();await old.sendInvoice();await old.saveDraft();const cancel=button(h,h.render(),'Cancel edit');cancel.props.onClick();assert.equal(h.state('editing'),true);assert.equal(h.requests.length,1);release(failure('Validation',422));await pending;});
for(const kind of ['lost','408','409','500','malformed422'])withCase('detail',`Ambiguous invoice ${kind} freezes mutations and read refresh cannot repeat`,async h=>{readyDetail(h);h.setResponse(()=>kind==='lost'?Promise.reject(new Error('Lost')):kind==='malformed422'?{ok:false,status:422,json:async()=>null}:failure('Unknown',Number(kind)));await h.handlers().sendInvoice();h.render();assert.equal(h.state('writeOutcome'),'unknown');await h.handlers().sendInvoice();assert.equal(h.requests.length,1);h.setResponse(url=>success(url.includes('/payments?')?[]:fixtureInvoice));await h.handlers().load();h.render();await h.handlers().sendInvoice();assert.equal(h.requests.filter(r=>r.options?.method).length,1);assert.equal(h.state('writeOutcome'),'unknown');});
withCase('detail','Acknowledged send survives failed readback and blocks resend until verified status',async h=>{readyDetail(h);h.setResponse((url,opt)=>opt?.method?success(null):failure('Read failed',503));await h.handlers().sendInvoice();h.render();assert.equal(h.state('writeOutcome'),'acknowledged');assert.match(h.state('message'),/Invoice sent/);await h.handlers().sendInvoice();assert.equal(h.requests.filter(r=>r.options?.method).length,1);h.setResponse(url=>success(url.includes('/payments?')?[]:{...fixtureInvoice,status:'sent'}));await h.handlers().load();h.render();assert.equal(h.state('writeOutcome'),null);await h.handlers().sendInvoice();assert.equal(h.requests.filter(r=>r.options?.method).length,1);});
withCase('detail','Superseding invoice read invalidates retained pre-read mutation even before rerender',async h=>{readyDetail(h);const old=h.handlers();h.setResponse(url=>success(url.includes('/payments?')?[]:{...fixtureInvoice,status:'cancelled'}));await old.load();await old.sendInvoice();assert.equal(h.requests.filter(r=>r.options?.method).length,0);});
withCase('detail','Unmounted retained invoice mutation cannot dispatch',async h=>{readyDetail(h);const cleanup=h.layouts[0]();const old=h.handlers();cleanup();await old.sendInvoice();assert.equal(h.requests.length,0);});
withCase('detail','Late invoice write completion cannot update a replacement tenant scope',async h=>{h.setTenant({organization:{id:'one'},permissions:['*']});readyDetail(h);h.layouts[0]();let release;h.setResponse(()=>new Promise(r=>release=r));const pending=h.handlers().sendInvoice();h.setTenant({organization:{id:'two'},permissions:['*']});h.render();h.layouts.at(-2)();release(success({...fixtureInvoice,status:'sent'}));await pending;assert.equal(h.state('message'),null);assert.equal(h.updated.length,0);assert.equal(h.requests.length,1);});
withCase('detail','Read-only refresh preserves an unsaved invoice edit',async h=>{readyDetail(h);editDetail(h);h.setState('form',{...h.state('form'),subject:'Retain unsaved'});h.render();h.layouts.at(-1)();await h.handlers().load();assert.equal(h.state('form').subject,'Retain unsaved');});
withCase('detail','Live permission change rejects retained invoice write callback',async h=>{h.setTenant({organization:{id:'one'},permissions:['*']});readyDetail(h);h.layouts[0]();const old=h.handlers();h.setTenant({organization:{id:'one'},permissions:['finance.view']});h.render();h.layouts.at(-2)();await old.sendInvoice();assert.equal(h.requests.length,0);});

withCase('detail','Dismissed and reopened draft rejects every old edit callback and old neutral Send',async h=>{
 readyDetail(h);const neutral=h.handlers();editDetail(h);const old=h.handlers();old.cancelEdit();h.render();editDetail(h);const current=h.handlers();
 const snapshot=structuredClone(h.state('form'));old.cancelEdit();old.beginEdit();old.changeForm(v=>({...v,subject:'Stale'}));await old.saveDraft();await neutral.sendInvoice();
 assert.equal(h.state('editing'),true);assert.deepEqual(h.state('form'),snapshot);assert.equal(h.requests.length,0);
 h.setResponse(()=>failure('Synthetic validation',422));await current.saveDraft();assert.equal(h.requests.filter(r=>r.options?.method==='PATCH').length,1);
});
withCase('detail','Changed draft invalidates retained saved snapshot but current Save keeps new draft',async h=>{
 readyDetail(h);editDetail(h);const old=h.handlers();old.changeForm(v=>({...v,subject:'Current edit'}));await old.saveDraft();assert.equal(h.requests.length,0);h.render();h.setResponse(()=>failure('Synthetic validation',422));await h.handlers().saveDraft();assert.equal(JSON.parse(h.requests[0].options.body).subject,'Current edit');
});
withCase('detail','Dismissed and reopened cancellation rejects old close and final callback',async h=>{
 readyDetail(h);cancelDetail(h);h.setState('cancelReason','A reason');h.render();const old=h.handlers();old.closeCancellation();h.render();cancelDetail(h);h.setState('cancelReason','B reason');h.render();const current=h.handlers();old.closeCancellation();await old.cancelInvoice();assert.equal(h.state('cancelOpen'),true);assert.equal(h.requests.length,0);h.setResponse(()=>failure('Synthetic validation',422));await current.cancelInvoice();assert.equal(JSON.parse(h.requests[0].options.body).reason,'B reason');
});
withCase('detail','Dismissed and reopened reversal rejects old review close and final callback',async h=>{
 readyDetail(h);reverseDetail(h);const old=h.handlers();old.closeReversal(true);h.render();h.handlers().reviewReversal();h.render();const current=h.handlers();old.closeReversal();old.reviewReversal();await old.reversePayment();assert.equal(h.state('confirmingReversal'),true);assert.equal(h.state('selectedPayment').id,fixturePayment.id);assert.equal(h.requests.length,0);h.setResponse(()=>failure('Synthetic validation',422));await current.reversePayment();assert.equal(h.requests[0].url,'/api/accounting/corrections/reverse');
});
withCase('detail','Neutral Send retained before cancellation and reversal is never dispatched behind dialog',async h=>{
 readyDetail(h);const neutral=h.handlers();cancelDetail(h);await neutral.sendInvoice();assert.equal(h.requests.length,0);h.handlers().closeCancellation();h.render();const neutral2=h.handlers();reverseDetail(h);await neutral2.sendInvoice();assert.equal(h.requests.length,0);
});
withCase('list','Reopened draft rejects all retained DOM setters source changes close and submit',async h=>{
 await prepareCreate(h);h.setState('source','client');let tree=h.render();const old=h.handlers();const fields=[...h.all(tree,'input'),...h.all(tree,'textarea')].filter(n=>n.props.onChange);const selects=h.all(tree,'SearchableSelect').filter(n=>n.props.onValueChange);old.closeCreate();h.render();h.handlers().openCreate();h.render();const snapshot=structuredClone(h.state('form')),payment=structuredClone(h.state('payment'));for(const field of fields)field.props.onChange({target:{value:'Stale',checked:true}});for(const select of selects)select.props.onValueChange('stale');old.closeCreate();old.openCreate();old.resetSource('order');old.changeManualCurrency('EUR');old.updateLine(0,{description:'stale'});old.selectPaymentDestination('stale');await old.submit(submitEvent);assert.equal(h.state('showForm'),true);assert.deepEqual(h.state('form'),snapshot);assert.deepEqual(h.state('payment'),payment);assert.equal(h.requests.length,0);
});
withCase('list','Field change immediately invalidates prior submit payload until current render',async h=>{
 await prepareCreate(h);h.setState('source','client');h.setState('form',{...h.state('form'),client_id:'synthetic-client',lines:[{...h.state('form').lines[0],description:'Synthetic line',quantity:'1',unit_price:'1'}]});const tree=h.render(),old=h.handlers();const subject=h.all(tree,'input').find(n=>n.props.placeholder==='Website development');assert.ok(subject);subject.props.onChange({target:{value:'Current subject'}});await old.submit(submitEvent);assert.equal(h.requests.length,0);h.render();h.setResponse(()=>failure('Synthetic validation',422));await h.handlers().submit(submitEvent);assert.equal(h.requests.length,1);
});

withCase('detail','Identical reason and repeated payment selection do not invalidate a valid current confirmation',async h=>{readyDetail(h);cancelDetail(h);h.setState('cancelReason','Reason');h.render();const cancel=h.handlers();cancel.changeCancellationReason('Reason');h.setResponse(()=>failure('Synthetic validation',422));await cancel.cancelInvoice();assert.equal(h.requests.length,1);});
withCase('detail','Repeated active reversal selection and unchanged reason retain the current review callback',async h=>{readyDetail(h);h.setState('payments',[fixturePayment]);h.render();h.handlers().beginReversal(fixturePayment);h.setState('reversalReason','Reason');h.render();const current=h.handlers();current.beginReversal(fixturePayment);current.changeReversalReason('Reason');current.reviewReversal();assert.equal(h.state('confirmingReversal'),true);});
withCase('payment','Unchanged defaults toggle does not invalidate an admitted current Save',async h=>{preparePaymentEdit(h);const current=h.handlers();current.changeDefaults(false);await current.savePaymentInstructions();assert.equal(h.requests.filter(r=>r.options?.method==='PATCH').length,1);});

withCase('detail','Already reviewed reversal ignores repeated review without stranding final confirmation',async h=>{readyDetail(h);reverseDetail(h);const current=h.handlers();current.reviewReversal();h.setResponse(()=>failure('Synthetic validation',422));await current.reversePayment();assert.equal(h.requests.length,1);});
withCase('detail','Closing an inactive reversal review does not invalidate the open reason session',h=>{readyDetail(h);h.setState('payments',[fixturePayment]);h.render();h.handlers().beginReversal(fixturePayment);h.setState('reversalReason','Reason');h.render();const current=h.handlers();current.closeReversal(true);current.reviewReversal();assert.equal(h.state('confirmingReversal'),true);});

const intentId='d1042b77-53af-4ced-8d8e-ed28770da31b';
async function readyClientIntent(h,id=intentId){
  h.render({requestedClientId:id});
  h.setResponse(url=>success(url==='/api/finance/meta'?{clients:[{id:intentId,code:'CLI-01',name:'José / মোঃ আরিফ',currency:'GBP'}],orders:[],projects:[]}:url.includes('invoice-page')?{items:[]}:[]));
  await h.handlers().load();h.render({requestedClientId:id});
}
withCase('list','Verified current-company client intent opens manual GBP draft once without POST or navigation',async h=>{
  await readyClientIntent(h);h.handlers().applyClientIntent();h.render({requestedClientId:intentId});
  assert.equal(h.state('showForm'),true);assert.equal(h.state('source'),'client');assert.equal(h.state('form').client_id,intentId);assert.equal(h.state('form').currency,'GBP');assert.equal(h.state('form').terms_conditions,'');assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,0);
  h.handlers().changeDraft(v=>({...v,subject:'My draft',currency:'CAD'}));h.render({requestedClientId:intentId});h.handlers().applyClientIntent();assert.equal(h.state('form').subject,'My draft');assert.equal(h.state('form').currency,'CAD');
  h.handlers().closeCreate();h.render({requestedClientId:intentId});h.handlers().applyClientIntent();assert.equal(h.state('showForm'),false);
});
withCase('list','Unknown or other-company client intent stays closed and explains unavailable selection',async h=>{
  await readyClientIntent(h,'00000000-0000-0000-0000-000000000000');h.handlers().applyClientIntent();assert.equal(h.state('showForm'),false);assert.match(h.state('message'),/unavailable in this company/);assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,0);
});
withCase('list','Client intent never broadens finance-view permission or fetches manager setup',async h=>{
  h.setTenant({organization:{id:'company'},permissions:['finance.view']});await readyClientIntent(h);h.handlers().applyClientIntent();assert.equal(h.state('showForm'),false);assert.deepEqual(h.requests.map(r=>r.url),['/api/finance/invoice-page?limit=100']);
});
withCase('list','Client intent waits for verified setup and leaves existing live draft unchanged',async h=>{
  h.render({requestedClientId:intentId});h.handlers().applyClientIntent();assert.equal(h.state('showForm'),false);
  await readyClientIntent(h);h.handlers().openCreate();h.render({requestedClientId:intentId});h.handlers().changeDraft(v=>({...v,subject:'Preserve pending work',terms_conditions:'Keep original'}));h.render({requestedClientId:intentId});h.handlers().applyClientIntent();assert.equal(h.state('source'),'project');assert.equal(h.state('form').subject,'Preserve pending work');assert.equal(h.state('form').terms_conditions,'Keep original');
});
withCase('list','Retained intent callback cannot open after unmount or a newer URL intent layout',async h=>{
  await readyClientIntent(h);const old=h.handlers().applyClientIntent;const cleanups=h.layouts.splice(0).map(fn=>fn()).filter(Boolean);cleanups.forEach(fn=>fn());old();assert.equal(h.state('showForm'),false);
  h.render({requestedClientId:'00000000-0000-0000-0000-000000000000'});h.layouts.splice(0).forEach(fn=>fn());old();assert.equal(h.state('showForm'),false);assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,0);
});
withCase('list','Optional Unicode terms travel in manual invoice payload; source reset clears terms',async h=>{
  await readyClientIntent(h);h.handlers().applyClientIntent();h.render({requestedClientId:intentId});
  const terms='Due by agreement\nশর্তাবলী / 条件 — no automatic commitment';
  h.handlers().changeDraft(v=>({...v,terms_conditions:terms,lines:[{product_id:null,item_name:'Service',item_type:'service',unit:'unit',description:'Synthetic',quantity:'1',unit_price:'10',discount_percent:'0',tax_rate:'0'}]}));h.render({requestedClientId:intentId});
  h.setResponse(()=>failure('Synthetic rejection',422));await h.handlers().submit(submitEvent);
  const sent=JSON.parse(h.requests.find(r=>r.options?.method==='POST').options.body);assert.equal(sent.terms_conditions,terms);assert.equal(sent.client_id,intentId);assert.equal(sent.currency,'GBP');
  h.render({requestedClientId:intentId});h.handlers().resetSource('order');assert.equal(h.state('form').terms_conditions,'');
});
withCase('list','Missing finance.view prevents even manager-only URL intent from loading or opening',async h=>{
  h.setTenant({organization:{id:'company'},permissions:['finance.manage']});await readyClientIntent(h);h.handlers().applyClientIntent();assert.equal(h.requests.length,0);assert.equal(h.state('showForm'),false);
});
withCase('list','Pending and unknown draft cannot be replaced by a newer URL intent',async h=>{
  await readyClientIntent(h);h.handlers().openCreate();h.render({requestedClientId:intentId});h.setState('source','project');h.setState('form',{...h.state('form'),source_id:'synthetic-project',subject:'Do not replace'});h.render({requestedClientId:intentId});
  let release;h.setResponse(()=>new Promise(resolve=>{release=resolve;}));const pending=h.handlers().submit(submitEvent);
  h.render({requestedClientId:intentId});h.handlers().applyClientIntent();assert.equal(h.state('source'),'project');assert.equal(h.state('form').subject,'Do not replace');assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,1);
  release(failure('Unknown outcome',500));await pending;h.render({requestedClientId:intentId});h.handlers().applyClientIntent();assert.equal(h.state('unknownCreate'),true);assert.equal(h.state('form').subject,'Do not replace');assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,1);
});
withCase('list','Old tenant intent cannot apply after new tenant layout even when requested ID is unchanged',async h=>{
  h.setTenant({organization:{id:'old'},permissions:['*']});await readyClientIntent(h);h.layouts.splice(0).forEach(fn=>fn());const old=h.handlers().applyClientIntent;
  h.setTenant({organization:{id:'new'},permissions:['*']});h.render({requestedClientId:intentId});h.layouts.splice(0).forEach(fn=>fn());old();assert.equal(h.state('showForm'),false);assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,0);
});

function invoicePageFixture(h,items,next_cursor=null){h.setResponse(url=>success(url.includes('invoice-page')?{items,next_cursor}:url==='/api/finance/meta'?{clients:[],orders:[],projects:[]}:[]));}
withCase('list','Cursor history reaches records beyond100, keeps order and deduplicates overlap by stable ID',async h=>{
  h.render();const rows=Array.from({length:130},(_,i)=>({...fixtureInvoice,id:`row-${i}`,invoice_number:`INV-${i}`}));invoicePageFixture(h,rows.slice(0,100),'opaque+cursor/=one');await h.handlers().load();h.render();invoicePageFixture(h,rows.slice(99),null);await h.handlers().loadMore();assert.equal(h.state('invoices').length,130);assert.deepEqual(h.state('invoices').map(i=>i.id),rows.map(i=>i.id));assert.equal(h.state('nextCursor'),null);assert.equal(new URL(h.requests.filter(r=>r.url.includes('invoice-page')).at(-1).url,'https://test.invalid').searchParams.get('cursor'),'opaque+cursor/=one');
});
withCase('list','Repeated Load more is synchronously admitted once and stale pages cannot append after filter reset',async h=>{
  h.render();invoicePageFixture(h,[fixtureInvoice],'next-one');await h.handlers().load();h.render();let release;h.setResponse(()=>new Promise(resolve=>{release=resolve;}));const old=h.handlers();const pending=old.loadMore();await old.loadMore();assert.equal(h.requests.filter(r=>r.url.includes('cursor=')).length,1);
  h.setState('query','new search');h.render();invoicePageFixture(h,[{...fixtureInvoice,id:'new-filter'}],null);h.handlers().applyFilters(submitEvent);await settle();release(success({items:[{...fixtureInvoice,id:'stale'}],next_cursor:'stale-cursor'}));await pending;assert.deepEqual(h.state('invoices').map(i=>i.id),['new-filter']);assert.equal(h.state('nextCursor'),null);assert.equal(h.state('loadingMore'),false);await old.loadMore();assert.equal(h.requests.filter(r=>r.url.includes('cursor=')).length,1);
});
withCase('list','Overdue raw-status intersection can be empty on a page without hiding further matching history',async h=>{
  h.render();h.setState('statusFilter','partially_paid');h.setState('dueFilter','overdue');h.render();invoicePageFixture(h,[{...fixtureInvoice,status:'sent',display_status:'overdue'}],'older');h.handlers().applyFilters(submitEvent);await settle();let tree=h.render();assert.equal(h.handlers().filteredInvoices.length,0);assert.ok(button(h,tree,'Load more invoices'));const register=h.all(tree,'InvoiceRegister')[0];assert.equal(register.props.moreAvailable,true);assert.match(text(register.type(register.props)),/No matching invoices in loaded records/);
  invoicePageFixture(h,[{...fixtureInvoice,id:'partial',status:'partially_paid',display_status:'overdue'}],null);await h.handlers().loadMore();h.render();assert.deepEqual(h.handlers().filteredInvoices.map(i=>i.id),['partial']);assert.equal(h.state('nextCursor'),null);const params=new URL(h.requests.filter(r=>r.url.includes('cursor=')).at(-1).url,'https://test.invalid').searchParams;assert.equal(params.get('status'),'overdue');
});
withCase('list','Late401 page and malformed cursor cannot replace verified rows or redirect another filter',async h=>{
  h.render();invoicePageFixture(h,[fixtureInvoice],'older');await h.handlers().load();h.render();let release;h.setResponse(()=>new Promise(resolve=>{release=resolve;}));const pending=h.handlers().loadMore();h.setState('statusFilter','paid');h.render();invoicePageFixture(h,[{...fixtureInvoice,id:'paid',status:'paid'}],null);h.handlers().applyFilters(submitEvent);await settle();release(failure('Authentication required',401));await pending;assert.deepEqual(h.state('invoices').map(i=>i.id),['paid']);assert.equal(h.state('error'),null);
  invoicePageFixture(h,[fixtureInvoice],'older');await h.handlers().load();h.render();h.setResponse(()=>success({items:[],next_cursor:{invalid:true}}));await h.handlers().loadMore();assert.equal(h.state('invoices')[0].id,fixtureInvoice.id);assert.equal(h.state('nextCursor'),'older');assert.match(h.state('error'),/could not be verified/);
});
withCase('list','Old tenant and unmounted cursor handlers neither dispatch nor apply a late page',async h=>{
  h.setTenant({organization:{id:'old'},permissions:['*']});h.render();invoicePageFixture(h,[fixtureInvoice],'older');await h.handlers().load();h.render();const cleanup=h.layouts.at(-1)();const old=h.handlers();cleanup();await old.loadMore();assert.equal(h.requests.filter(r=>r.url.includes('cursor=')).length,0);
  h.setTenant({organization:{id:'new'},permissions:['*']});h.render();h.layouts.at(-1)();await old.loadMore();assert.equal(h.requests.filter(r=>r.url.includes('cursor=')).length,0);
});
withCase('list','Apply and Enter preserve pending or uncertain creation state and never issue financial writes',async h=>{
  await prepareCreate(h);h.setState('source','project');h.setState('form',{...h.state('form'),source_id:'synthetic-project',terms_conditions:'Keep terms'});h.render();let release;h.setResponse(()=>new Promise(resolve=>{release=resolve;}));const pending=h.handlers().submit(submitEvent);invoicePageFixture(h,[],null);h.setState('query','search while posting');h.render();h.handlers().applyFilters(submitEvent);await settle();assert.equal(h.state('saving'),true);assert.equal(h.state('form').terms_conditions,'Keep terms');assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,1);release(failure('Unknown',500));await pending;h.render();h.handlers().clearFilters();await settle();assert.equal(h.state('unknownCreate'),true);assert.equal(h.state('form').terms_conditions,'Keep terms');assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,1);
});
withCase('list','Counts describe loaded rows and failed reads do not display fabricated zero counts',async h=>{
  h.render();h.setResponse(()=>failure('Unavailable',503));await h.handlers().load();let tree=h.render();assert.equal(h.all(tree,'InvoiceCounts').length,0);assert.equal(h.all(tree,'InvoiceRegister').length,0);assert.match(text(tree),/counts unavailable/);
  invoicePageFixture(h,[{...fixtureInvoice,display_status:'overdue'}],'more');await h.handlers().load();tree=h.render();const counts=h.all(tree,'InvoiceCounts')[0];assert.equal(counts.props.total,1);assert.equal(counts.props.overdue,1);assert.match(text(counts.type(counts.props)),/Loaded invoices/);assert.match(text(tree),/not company-wide totals/);assert.ok(h.all(tree,'form').some(form=>form.props.onSubmit===h.handlers().applyFilters));
});
withCase('list','Finance cursor return restores server filters and provides truthful first-page restart',async h=>{
  const location={filters:{search:'older client',status:'overdue',currency:'GBP',balance:'all'},cursor:'saved+/cursor'};const events=[];
  h.render({registerLocation:location,onRegisterLocationChange:next=>events.push(next),initialSource:'order'});invoicePageFixture(h,[fixtureInvoice],null);await h.handlers().load();let tree=h.render({registerLocation:location,onRegisterLocationChange:next=>events.push(next)});const url=new URL(h.requests.find(r=>r.url.includes('invoice-page')).url,'https://test.invalid');assert.equal(url.searchParams.get('cursor'),'saved+/cursor');assert.equal(url.searchParams.get('search'),'older client');assert.equal(h.state('source'),'order');assert.match(text(tree),/Returned to this cursor page/);assert.doesNotMatch(text(tree),/All matching records have been loaded/);h.handlers().restartFirstPage();await settle();assert.equal(new URL(h.requests.filter(r=>r.url.includes('invoice-page')).at(-1).url,'https://test.invalid').searchParams.has('cursor'),false);assert.equal(events.at(-1).cursor,null);assert.equal(events.at(-1).filters.search,'older client');
});
withCase('list','Self-emitted pagination URL does not reload; external Back filters read without replacing open draft',async h=>{
  const location={filters:{search:'',status:'all',currency:'all',balance:'all'},cursor:null},events=[];const props={registerLocation:location,onRegisterLocationChange:next=>events.push(next)};
  h.render(props);invoicePageFixture(h,[fixtureInvoice],'next');await h.handlers().load();h.render(props);h.handlers().openCreate();h.render(props);h.handlers().changeDraft(v=>({...v,terms_conditions:'Retained terms'}));h.render(props);invoicePageFixture(h,[{...fixtureInvoice,id:'second'}],null);await h.handlers().loadMore();const before=h.requests.length;h.render({...props,registerLocation:events.at(-1)});h.effects.find(fn=>fn.toString().includes('syncedLocation.current ==='))();assert.equal(h.requests.length,before);assert.equal(h.state('invoices').length,2);
  const back={filters:{...location.filters,search:'previous'},cursor:'previous-cursor'};h.render({...props,registerLocation:back});h.effects.find(fn=>fn.toString().includes('syncedLocation.current ==='))();await settle();assert.equal(h.state('form').terms_conditions,'Retained terms');assert.equal(h.state('showForm'),true);assert.equal(h.state('query'),'previous');assert.equal(new URL(h.requests.filter(r=>r.url.includes('invoice-page')).at(-1).url,'https://test.invalid').searchParams.get('cursor'),'previous-cursor');
});
withCase('list','Finance explicit create trigger waits for setup then opens once without submitting or replacing a draft',async h=>{
  const props={createRequest:1,initialSource:'order'};h.render(props);h.effects.find(fn=>fn.toString().includes('consumedCreateRequest.current'))();assert.equal(h.state('showForm'),false);await h.handlers().load();h.render(props);h.effects.find(fn=>fn.toString().includes('consumedCreateRequest.current'))();h.render(props);assert.equal(h.state('showForm'),true);assert.equal(h.state('source'),'order');h.handlers().closeCreate();h.render(props);h.effects.find(fn=>fn.toString().includes('consumedCreateRequest.current'))();assert.equal(h.state('showForm'),false);assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,0);
});
withCase('list','Finance live protection getter blocks same-event navigation before state notification and retains unknown outcome',async h=>{
  let guard;const props={registerProtectionGuard:value=>{guard=value;}};h.render(props);h.layouts.find(fn=>fn.toString().includes('registerProtectionGuard'))();await h.handlers().load();h.render(props);h.handlers().openCreate();h.render(props);h.setState('form',{...h.state('form'),source_id:'synthetic-project'});h.render(props);let release;h.setResponse(()=>new Promise(resolve=>{release=resolve;}));const pending=h.handlers().submit(submitEvent);assert.equal(guard().pending,true);release(failure('Unknown',500));await pending;assert.equal(guard().pending,false);assert.equal(guard().unknown,true);assert.equal(guard().open,true);
});

withCase('list','standalone Load more then ordinary reload restarts first page without Finance location props',async h=>{h.render();invoicePageFixture(h,[fixtureInvoice],'older-page');await h.handlers().load();h.render();invoicePageFixture(h,[{...fixtureInvoice,id:'older-record'}],null);await h.handlers().loadMore();h.render();await h.handlers().load();const url=new URL(h.requests.filter(r=>r.url.includes('invoice-page')).at(-1).url,'https://test.invalid');assert.equal(url.searchParams.has('cursor'),false);assert.equal(h.state('historyStartsAtCursor'),false);});
