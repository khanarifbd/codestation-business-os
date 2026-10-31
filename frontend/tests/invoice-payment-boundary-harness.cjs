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
const mappings={list:['invoices-workspace-v2','InvoicesWorkspaceContent',['load','submit','resetSource','clearFilters','changeManualCurrency','selectLineSource','selectPaymentDestination','updateLine','openCreate','closeCreate','filteredInvoices','overdueCount','outstandingCount','draftTotal','availableCatalog','projectOptions','orderOptions']],detail:['invoice-detail-workspace','InvoiceDetailWorkspace',['load','saveDraft','sendInvoice','shareInvoice','cancelInvoice','reversePayment']],payment:['invoice-payment-workspace','InvoicePaymentWorkspace',['load','selectDestination','changeMethod','savePaymentInstructions','printInvoice','beginEdit','cancelEdit','changeField','changeDefaults']],workspace:['invoice-workspace','InvoiceWorkspace',[]]};
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
 const render=props=>{cursor=0;refCursor=0;effects.length=0;layouts.length=0;return mod.exports[name](props??{invoiceId:fixtureInvoice.id,onUpdated:()=>updated.push('updated')});};
 return{states,effects,layouts,requests,updated,shares,opened,render,all,ui,handlers:()=>mod.exports.getTestHandlers(),state:n=>states[names.indexOf(n)],setState:(n,v)=>{const i=names.indexOf(n);assert.ok(i>=0,n);states[i]=v;},setResponse:fn=>{response=fn;},setTenant:value=>{tenant=value;},cleanup:()=>{global.fetch=original.fetch;global.Date=original.Date;global.window=original.window;if(original.navigator)Object.defineProperty(global,'navigator',original.navigator);else delete global.navigator;}};
}

module.exports={harness,success,failure,settle,fixtureInvoice,fixtureInstructions,fixtureDestination,all,text};
