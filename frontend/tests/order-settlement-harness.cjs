/** Actual settlement hooks/model/component loader with synthetic requests only. No registered tests here. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const order={id:'synthetic-order',order_number:'SYN-O-001',status:'completed',currency:'BDT',total:'12500.00',external_order_id:null};
const state={order_id:order.id,eligible:true,reason:null,invoice_id:null,invoice_number:null,invoice_status:null,invoice_total:null,invoice_amount_paid:null,invoice_balance_due:null,invoice_sent_to_client:false,payment_id:null,payment_number:null,account_id:null,account_name:null,gross_amount:null,currency:null,expenses:[]};
const meta={order_id:order.id,order_number:order.order_number,currency:'BDT',total:'12500.00',accounts:[{id:'synthetic-bank',name:'Synthetic Bank',currency:'BDT',account_type:'bank',current_balance:'5000.00'}],expense_categories:[{id:'synthetic-category',name:'Synthetic fee',cost_type:'direct'}]};
const result={order_id:order.id,order_number:order.order_number,project_id:null,invoice_id:'synthetic-invoice',invoice_number:'SYN-I-001',payment_id:'synthetic-payment',payment_number:'SYN-P-001',expense_id:null,expense_number:null,account_id:'synthetic-bank',account_name:'Synthetic Bank',currency:'BDT',gross_amount:'12500.00',expense_amount:'0.00',net_amount:'12500.00',settlement_date:'2026-10-27',invoice_sent_to_client:false};
const ok=(body,status=200)=>({ok:true,status,json:async()=>body}),fail=(status=422,detail='Synthetic rejection')=>({ok:false,status,json:async()=>({detail})});
const settle=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};
function harness({file='src/hooks/use-order-settlement.ts',target='useOrderSettlement',args=[order.id,'/dashboard/orders/synthetic-order?returnTo=%2Fdashboard%2Forders']}={}){
 let tenantId='synthetic-company',membership='synthetic-member',role='synthetic-role',permissions=['finance.view','finance.manage'],pathname='/dashboard/orders/synthetic-order/settlement',query=new URLSearchParams(),params={orderId:order.id},confirmLeave=true,navFail=false,vm,cursor=0,refCursor=0;
 const states=[],refs=[],effects=[],layouts=[],calls=[],navigation=[],guards=[],cleanups=[],modules=new Map();
 let respond=url=>ok(url.endsWith('/settlement-meta')?meta:url.endsWith('/settlement')?state:url.endsWith('/settle')?result:order);
 const hooks={useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:initial=>refs[refCursor++]??={current:initial},useCallback:fn=>fn,useMemo:fn=>fn(),useEffect:fn=>effects.push(fn),useLayoutEffect:fn=>layouts.push(fn)};
 function load(filename){if(modules.has(filename))return modules.get(filename).exports;const code=fs.readFileSync(filename,'utf8'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;modules.set(filename,mod);mod.require=id=>{
  if(id==='react')return hooks;
  if(id==='next/navigation')return{useRouter:()=>({replace:href=>navigation.push(['replace',href]),push:href=>navigation.push(['push',href])}),useParams:()=>params,usePathname:()=>pathname,useSearchParams:()=>query};
  if(id==='@/components/dashboard-session-context')return{useDashboardSession:()=>({loading:false,tenant:{organization:{id:tenantId},membership_id:membership,role_id:role,permissions}})};
  if(id.includes('use-document-navigation-guard'))return{useDocumentNavigationGuard:(dirty,options)=>{let clean=false;guards.push({dirty,options});return{markClean:()=>{clean=true;guards.push({clean:true});},navigate:(href,opts={})=>{if(navFail||options.pendingRef?.current||!clean&&options.isBusy||!clean&&!opts.discard&&dirty&&!confirmLeave)return false;navigation.push(['navigate',href,opts]);return true;}};}};
  if(id.endsWith('.css'))return{};if(id==='next/link')return{default:'NextLink'};
  if(id.startsWith('@/components/')&&!id.startsWith('@/components/commercial/order-settlement')&&!id.startsWith('@/components/accounting-transfers/'))return new Proxy({},{get:(_t,key)=>String(key)});
  if(id.startsWith('@/')||id.startsWith('.')){const base=id.startsWith('@/')?path.join(root,'src',id.slice(2)):path.resolve(path.dirname(filename),id);const resolved=['.ts','.tsx','/index.ts','/index.tsx'].map(ext=>base+ext).find(fs.existsSync);if(resolved)return load(resolved);}
  return require(id);
 };mod._compile(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);return mod.exports;}
 const old={fetch:global.fetch,window:global.window};global.fetch=async(url,init)=>{calls.push({url,init});return respond(url,init);};global.window={confirm:()=>confirmLeave,location:{href:'https://example.invalid'+pathname,assign:href=>navigation.push(['assign',href]),replace:href=>navigation.push(['native-replace',href])}};
 function flushLayout(){for(const fn of layouts){const cleanup=fn();if(cleanup)cleanups.push(cleanup);}}
 function render(nextArgs=args){cursor=0;refCursor=0;effects.length=0;layouts.length=0;vm=load(path.join(root,file))[target](...nextArgs);flushLayout();return vm;}
 return{calls,navigation,guards,effects,layouts,load,render,api:()=>vm,respond:fn=>respond=fn,args:value=>args=value,permissions:value=>permissions=value,tenant:value=>tenantId=value,membership:value=>membership=value,role:value=>role=value,query:value=>query=new URLSearchParams(value),params:value=>params=value,pathname:value=>pathname=value,confirmLeave:value=>confirmLeave=value,navFail:value=>navFail=value,
 effect:pattern=>{const fn=effects.find(fn=>pattern.test(fn.toString()));if(!fn)throw new Error('Missing effect '+pattern);const cleanup=fn();if(cleanup)cleanups.push(cleanup);return cleanup;},
 component:(file,name,props)=>{cursor=0;refCursor=0;effects.length=0;layouts.length=0;return load(path.join(root,file))[name](props);},
 unmount:()=>{cleanups.splice(0).forEach(fn=>fn());},cleanup:()=>{cleanups.splice(0).forEach(fn=>fn());Object.assign(global,old);}};
}
function nodes(tree,type){const out=[];function visit(n){if(Array.isArray(n))return n.forEach(visit);if(!n||typeof n!=='object')return;if((typeof n.type==='function'?n.type.name:n.type)===type)out.push(n);visit(n.props?.children);}visit(tree);return out;}
function text(n){if(n==null||typeof n==='boolean')return'';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join(' ');return text(n.props?.children);}
async function ready(h){h.render();await h.api().load();h.render();h.api().change('accountId','synthetic-bank');return h.render();}
module.exports={root,order,state,meta,result,ok,fail,settle,harness,nodes,text,ready};
