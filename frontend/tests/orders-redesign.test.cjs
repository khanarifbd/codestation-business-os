/** Orders presentation contracts against the verified source, never a live service. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const baseline=process.env.BASELINE_FRONTEND?path.resolve(process.env.BASELINE_FRONTEND):path.resolve(root,'../business-os-reconcile-20261025/baseline-source/frontend');
const files={list:'src/app/dashboard/orders/page.tsx',new:'src/app/dashboard/orders/new/page.tsx',edit:'src/app/dashboard/orders/[orderId]/edit/page.tsx',detail:'src/app/dashboard/orders/[orderId]/page.tsx',commercial:'src/app/dashboard/orders/[orderId]/commercial/page.tsx',layout:'src/app/dashboard/orders/layout.tsx',workspace:'src/app/dashboard/orders/[orderId]/layout.tsx',fulfillment:'src/components/order-fulfillment-panel.tsx'};
const mains={list:['OrdersPage'],new:['NewManualOrderPage','Field'],edit:['EditOrderPage','Field'],detail:['OrderDetailPage','BusinessFlow','SettlementCard'],commercial:['OrderCommercialPage','LineEditor'],layout:['OrdersLayout'],workspace:['OrderWorkspaceLayout'],fulfillment:['OrderFulfillmentPanel']};
const printer=ts.createPrinter({removeComments:true});
const read=(dir,file)=>fs.readFileSync(path.join(dir,file),'utf8');
const parse=(dir,kind)=>ts.createSourceFile(files[kind],read(dir,files[kind]),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find(dir,kind,name){const ast=parse(dir,kind);let node;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(node,`${kind}/${name}`);return{ast,node};}
function isJsx(n){return ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n);}
function skeleton(dir,kind,name){const {ast,node}=find(dir,kind,name);const result=ts.transform(node.body,[context=>{const visit=n=>isJsx(n)?ts.factory.createNull():ts.visitEachChild(n,visit,context);return n=>ts.visitNode(n,visit);}]);const text=printer.printNode(ts.EmitHint.Unspecified,result.transformed[0],ast);result.dispose();return text;}
const protectedProps=new Set(['value','defaultValue','checked','defaultChecked','disabled','required','name','type','min','max','step','href','target','rel','method','action','options','items','orderId','orderNumber','status','currency','order','lead','project','settlement','leadAccessRestricted','projectAccessRestricted','financeAccess','expenseTotal','net','lines','values']);
// Approved fulfillment changes are partitioned, never a whole-component exemption.
// Original arithmetic/validation/payloads are compared below; new retry safety has
// explicit static contracts plus the execution tests in financial-correctness.
const fulfillmentAddedState={
 '[confirmedBeforeStock, setConfirmedBeforeStock]':'const [confirmedBeforeStock, setConfirmedBeforeStock] = useState<string | null>(null);',
 '[readbackComplete, setReadbackComplete]':'const [readbackComplete, setReadbackComplete] = useState(false);',
 '[uncertain, setUncertain]':'const [uncertain, setUncertain] = useState(false);',
 inFlight:'const inFlight = useRef(false);',
 operation:'const operation = useRef<PendingOperation | null>(null);',
 stockSnapshot:'const stockSnapshot = JSON.stringify(stockItems.map(item => [item.id, Number(item.fulfilled_quantity), Number(item.remaining_quantity)]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));',
 refreshRequired:'const refreshRequired = confirmedBeforeStock !== null && (!readbackComplete || stockSnapshot === confirmedBeforeStock);',
};
const fulfillmentAddedHelpers=new Set(['prepareOperation','refreshSavedStatus','writeFailed','performOperation','retryUnchanged']);
function tokens(text){const scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,text),out=[];for(let k=scanner.scan();k!==ts.SyntaxKind.EndOfFileToken;k=scanner.scan())out.push(scanner.getTokenText());return out.filter((token,index)=>!(token===','&&['}',']',')'].includes(out[index+1])));}
const printed=(node,ast)=>printer.printNode(ts.EmitHint.Unspecified,node,ast);
function fulfillmentUnchangedSkeleton(dir){
 const {ast,node}=find(dir,'fulfillment','OrderFulfillmentPanel');
 const result=ts.transform(node.body,[context=>{
  const visit=n=>{
   if(isJsx(n))return ts.factory.createNull();
   if(ts.isFunctionDeclaration(n)&&(['submit','reverse','beginReverse'].includes(n.name?.text)||fulfillmentAddedHelpers.has(n.name?.text)))return undefined;
   if(dir===root&&ts.isVariableStatement(n)){
    const name=n.declarationList.declarations[0].name.getText(ast);
    if(Object.hasOwn(fulfillmentAddedState,name)){assert.deepEqual(tokens(printed(n,ast)),tokens(fulfillmentAddedState[name]),name+' exact added safety state');return undefined;}
    if(name==='load'){
     let yes=0,no=0;
     const strip=x=>{if(ts.isReturnStatement(x)&&x.expression?.kind===ts.SyntaxKind.TrueKeyword){yes++;return undefined;}if(ts.isReturnStatement(x)&&x.expression?.kind===ts.SyntaxKind.FalseKeyword){no++;return undefined;}return ts.visitEachChild(x,strip,context);};
     const changed=ts.visitEachChild(n,strip,context);assert.equal(yes,1,'one successful-read signal');assert.equal(no,1,'one failed-read signal');return changed;
    }
   }
   if(dir===root&&ts.isNewExpression(n)&&n.expression.getText(ast)==='FulfillmentRequestError'){
    assert.deepEqual(n.arguments.map(a=>tokens(printed(a,ast))),[tokens('getApiErrorMessage(payload, "Fulfillment request failed")'),tokens('response.status')]);
    return ts.factory.updateNewExpression(n,ts.factory.createIdentifier('Error'),n.typeArguments,[n.arguments[0]]);
   }
   return ts.visitEachChild(n,visit,context);
  };return n=>ts.visitNode(n,visit);
 }]);
 const value=printed(result.transformed[0],ast);result.dispose();return value;
}
function fulfillmentActionContract(name){
 const actual=find(root,'fulfillment',name),original=find(baseline,'fulfillment',name);
 let a=[...actual.node.body.statements],b=[...original.node.body.statements];
 const index=name==='submit'?1:0;
 assert.deepEqual(tokens(printed(a[index],actual.ast)),tokens('if (disabled || inFlight.current || refreshRequired) return;'),'synchronous permission/busy/confirmed guard');
 a.splice(index,1);
 if(name==='beginReverse'){assert.deepEqual(a.map(n=>tokens(printed(n,actual.ast))),b.map(n=>tokens(printed(n,original.ast))));return;}
 const boundary=b.findIndex(n=>ts.isExpressionStatement(n)&&n.expression.expression?.getText(original.ast)===(name==='submit'?'setSaving':'setReversing'));
 assert.ok(boundary>0,'original validation boundary');
 const urlIndex=a.findIndex(n=>ts.isVariableStatement(n)&&n.declarationList.declarations[0].name.getText(actual.ast)==='url');assert.ok(urlIndex>0);
 assert.deepEqual(a.slice(0,urlIndex).map(n=>tokens(printed(n,actual.ast))),b.slice(0,boundary).map(n=>tokens(printed(n,original.ast))),'all original validation and quantity arithmetic');
 let oldRequest,oldPayload;function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(original.ast)==='request')oldRequest=n;if(ts.isCallExpression(n)&&n.expression.getText(original.ast)==='JSON.stringify')oldPayload=n;ts.forEachChild(n,visit);}visit(original.node);
 const url=a[urlIndex].declarationList.declarations[0].initializer,body=a[urlIndex+1].declarationList.declarations[0].initializer;
 assert.deepEqual(tokens(printed(url,actual.ast)),tokens(printed(oldRequest.arguments[0],original.ast)),'unchanged endpoint');
 assert.deepEqual(tokens(printed(body,actual.ast)),tokens(printed(oldPayload,original.ast)),'unchanged JSON payload');
 const prefix=name==='submit'?'fulfill':'fulfill-reverse';
 assert.deepEqual(a.slice(urlIndex+2).map(n=>tokens(printed(n,actual.ast))),[`const pending = prepareOperation(url, body, "${prefix}");`,'if (!pending) return;','await performOperation(pending);'].map(tokens),'only approved shared-operation delegation');
 const init=oldRequest.arguments[1];const props=Object.fromEntries(init.properties.map(p=>[p.name.getText(original.ast).replaceAll('"',''),p.initializer]));
 assert.equal(props.method.text,'POST');
 assert.deepEqual(tokens(printed(props.headers,original.ast)),tokens(`{ "Content-Type": "application/json", "Idempotency-Key": operationKey("${prefix}") }`),'original key namespace/header contract');
}

// v33 settlement extraction adapter: only enumerated state/read/write ownership moves.
// The original body and all input validations are executed in order-settlement-safety;
// its seven-field JSON is compared structurally below. Other order actions remain exact.
function settlementUnchangedSkeleton(dir,name){
 const {ast,node}=find(dir,'detail',name);
 const moved=new Set(['[settlement, setSettlement]','[financeAccess, setFinanceAccess]','[settlementOpen, setSettlementOpen]','[settlementMeta, setSettlementMeta]','[settlementLoading, setSettlementLoading]','[settlementSaving, setSettlementSaving]','[settlementError, setSettlementError]','[settlementAccountId, setSettlementAccountId]','[settlementDate, setSettlementDate]','[expenseAmount, setExpenseAmount]','[expenseCategoryId, setExpenseCategoryId]','[expenseDescription, setExpenseDescription]','[settlementReference, setSettlementReference]','[markInvoiceSent, setMarkInvoiceSent]','loadSettlement','previewExpense','previewNet','canSettle','accountOptions','categoryOptions']);
 const scoped=new Set(['{ tenant }','query','canManageFinance','settlementRead','settlement','financeAccess','settlementHref','alive']);
 const result=ts.transform(node.body,[context=>{const visit=n=>{
  if(isJsx(n))return ts.factory.createNull();
  if(name==='OrderDetailPage'){
   if(ts.isVariableStatement(n)){const key=n.declarationList.declarations[0].name.getText(ast);
    if(dir===root&&['settlementTotals','settlementExpenseTotal','settlementNet'].includes(key)){
     const exact={settlementTotals:'const settlementTotals = settlementDisplayTotals(settlement, order.currency);',settlementExpenseTotal:'const settlementExpenseTotal = settlementTotals.expenseTotal;',settlementNet:'const settlementNet = settlementTotals.net;'};
     assert.deepEqual(tokens(printed(n,ast)),tokens(exact[key]),'R4 exact display-only derivation '+key);
     if(key==='settlementTotals')return undefined;
     return n;
    }
    if(moved.has(key)||dir===root&&scoped.has(key))return undefined;}
   if(ts.isFunctionDeclaration(n)&&['openSettlement','submitSettlement'].includes(n.name?.text))return undefined;
   if(dir===root&&ts.isExpressionStatement(n)&&['useEffect','useLayoutEffect'].includes(n.expression.expression?.getText(ast))){
    const code=printed(n,ast);
    if(code.includes('alive.current = true')){assert.deepEqual(tokens(code),tokens('useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);'));return undefined;}
    if(code.includes('queueMicrotask')){assert.deepEqual(tokens(code),tokens('useEffect(() => { let active = true; queueMicrotask(() => { if (active) void loadOrder(); }); return () => { active = false; }; }, [loadOrder]);'));const original=find(baseline,'detail',name);return original.node.body.statements.find(x=>ts.isExpressionStatement(x)&&x.expression.expression?.getText(original.ast)==='useEffect');}
   }
   if(dir===root&&ts.isIfStatement(n)&&['!alive.current','!payload || payload.id !== orderId'].includes(n.expression.getText(ast)))return undefined;
   if(dir===root&&ts.isIfStatement(n)&&n.expression.getText(ast)==='response.status === 401 && alive.current')return ts.factory.updateIfStatement(n,ts.factory.createBinaryExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('response'),'status'),ts.SyntaxKind.EqualsEqualsEqualsToken,ts.factory.createNumericLiteral(401)),ts.visitEachChild(n.thenStatement,visit,context),n.elseStatement);
  }
  if(name==='BusinessFlow'&&dir===root&&ts.isParenthesizedExpression(n)&&ts.isConditionalExpression(n.expression)&&n.expression.condition.getText(ast)==='settlementUnavailable')return visit(n.expression);
  if(name==='BusinessFlow'&&dir===root&&ts.isConditionalExpression(n)&&n.condition.getText(ast)==='settlementUnavailable'){assert.equal(n.whenTrue.text,'Unavailable');assert.equal(n.whenFalse.text,'Not created');return n.whenFalse;}
  return ts.visitEachChild(n,visit,context);
 };return n=>ts.visitNode(n,visit);}]);let resultText=printed(result.transformed[0],ast);result.dispose();
 if(dir===root&&name==='OrderDetailPage'){
  const original=find(baseline,'detail',name);
  for(const[key,expression]of [['settlementExpenseTotal','settlementTotals.expenseTotal'],['settlementNet','settlementTotals.net']]){
   const statement=original.node.body.statements.find(x=>ts.isVariableStatement(x)&&x.declarationList.declarations[0].name.getText(original.ast)===key);
   resultText=resultText.replace(`const ${key} = ${expression};`,printed(statement,original.ast));
  }
 }
 return resultText.replace('useEffect(() => {\n        void loadOrder();\n    }, [loadOrder]);','useEffect(() => { void loadOrder(); }, [loadOrder]);');
}

for(const [kind,names]of Object.entries(mains))for(const name of names){
 if(!(kind==='list'||(kind==='new'&&name==='NewManualOrderPage')||(kind==='edit'&&name==='EditOrderPage')))test(`${kind}/${name}: hooks, guards and calculations outside markup are preserved`,()=>assert.equal(kind==='fulfillment'?fulfillmentUnchangedSkeleton(root):kind==='detail'?settlementUnchangedSkeleton(root,name):skeleton(root,kind,name),kind==='fulfillment'?fulfillmentUnchangedSkeleton(baseline):kind==='detail'?settlementUnchangedSkeleton(baseline,name):kind==='layout'?skeleton(baseline,kind,name).replace('    const pathname = usePathname();\n','').replace('return (null);','return null;'):kind==='workspace'?skeleton(baseline,kind,name).replace('    const orderId = params.orderId;','    const orderId = params.orderId;\n    const searchParams = useSearchParams();\n    const returnHref = orderReturnHref(searchParams.toString());'):skeleton(baseline,kind,name)));
 if(kind!=='list')test(`${kind}/${name}: protected events, form constraints, data and route props are preserved`,()=>{
  function props(dir){const {ast,node}=find(dir,kind,name),out=[];function visit(n){if(kind==='detail'&&ts.isConditionalExpression(n)){const condition=n.condition.getText(ast);if(['settlementOpen','canSettle','onSettle','settlementHref'].includes(condition))return;if(dir===root&&['readError','readLoading'].includes(condition)){visit(n.whenFalse);return;}}if(ts.isJsxAttribute(n)){const key=n.name.getText(ast);if(kind==='detail'&&['onSettle','onRetry'].includes(key))return;if(protectedProps.has(key)||/^on[A-Z]|^set[A-Z]|^updateLine$/.test(key))out.push(key+'='+(!n.initializer?'true':printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast)));}ts.forEachChild(n,visit);}visit(node);if(dir===root&&kind==='list'&&name==='OrdersPage'){const register=find(dir,kind,'OrdersRegister');visit(register.node);}return out.sort();}
  const isEditor=(kind==='new'&&name==='NewManualOrderPage')||(kind==='edit'&&name==='EditOrderPage');
  // Pending-state hardening adds disabled={saving}; preserve every original lock
  // after removing only the saving operand. Runtime tests exercise all pending controls.
  const normalize=values=>isEditor?values.filter(value=>value!=='disabled={saving}').map(value=>value.startsWith('disabled=')?value.replace('{saving || ','{').replace(' || saving',''):value):values;
  const actual=normalize(props(root)),expected=normalize(props(baseline)).map(value=>isEditor&&value==='href=\"/dashboard/orders\"'?'href={returnHref}':value);
  // Enumerated presentation relocations only, not a blanket subset comparison.
  const remove=value=>{const index=expected.indexOf(value);assert.ok(index>=0,value);expected.splice(index,1);};
  if(kind==='list'&&name==='OrdersPage'){
   for(const value of ['value={item.client_name}','value={item.order_date}','value={item.quotation_number || \"Manual\"}','value={money(item.total, item.currency)}','status={item.status}'])remove(value);
   expected.push('href=\"/dashboard/orders/new\"');
  }
  if(kind==='new'&&name==='NewManualOrderPage')expected.push('href={returnHref}');
  if(kind==='detail'&&name==='OrderDetailPage'){remove('href=\"/dashboard/orders\"');expected.push('onClose={() => setCancelOpen(false)}');}
  if(kind==='workspace'){for(const[old,next]of [['href={detailPath}','href={orderDocumentHref(orderId, \"view\", returnHref)}'],['href={commercialPath}','href={orderDocumentHref(orderId, \"commercial\", returnHref)}'],['href={`${detailPath}/edit`}','href={orderDocumentHref(orderId, \"edit\", returnHref)}']]){remove(old);expected.push(next);}}
  if(kind==='layout')remove('href=\"/dashboard/orders/new\"');
  if((kind==='new'&&name==='NewManualOrderPage')||(kind==='edit'&&name==='EditOrderPage'))expected.push('currency={currency}');
  if(kind==='edit'&&name==='EditOrderPage')expected.push('status={<span className=\"order-editor-status\">{order.status.replaceAll(\"_\", \" \")}</span>}');
  if(kind==='fulfillment'){
   remove('disabled={disabled || saving || reversing}');remove('disabled={reversing || reverseReason.trim().length < 3}');
   expected.push('disabled={disabled || saving || reversing || loading}','onClick={() => void retryUnchanged()}','disabled={saving || reversing || loading}','onClick={() => void refreshSavedStatus()}','disabled={disabled || saving || reversing || refreshRequired}','disabled={disabled || saving || reversing || refreshRequired}','disabled={saving || reversing || refreshRequired || reverseReason.trim().length < 3}','type="button"','type="button"');
  }
  assert.deepEqual(actual,expected.sort());
 });
}
for(const [kind,functions]of Object.entries({list:['money','compactMoney'],new:['lineTotal','updateItem','selectSource','changeCurrency'],edit:['lineTotal','updateItem','selectItemSource','changeCurrency','changeClient'],detail:['money','readableDate','statusLabel','changeStatus','confirmCancellation','refreshAfterFulfillment'],commercial:['post','createChange','createBilling'],fulfillment:['submit','beginReverse','reverse']}))for(const name of functions)test(`${kind}/${name}: original financial contract retained with only approved fulfillment safety delegation`,()=>{if(kind==='fulfillment'){fulfillmentActionContract(name);return;}const a=find(root,kind,name),b=find(baseline,kind,name);const expected=printer.printNode(ts.EmitHint.Unspecified,b.node,b.ast);assert.equal(printer.printNode(ts.EmitHint.Unspecified,a.node,a.ast),kind==='detail'&&name==='money'?expected.replace('return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;','return formatMoneyExact(value || 0, currency);'):expected);});
for(const kind of Object.keys(files).filter(kind=>kind!=='list'))test(`${kind}: request expressions are unchanged except verified shared fulfillment POST delegation`,()=>{
 function calls(dir){const ast=parse(dir,kind),out=[];function visit(n){if(kind==='detail'&&ts.isCallExpression(n)&&n.expression.getText(ast)==='fetch'&&/\/settlement(?:-meta)?`|\/settle`/.test(n.arguments[0]?.getText(ast)||''))return;if(ts.isCallExpression(n)&&['api','fetch','salesApi','request','post'].includes(n.expression.getText(ast))&&!(kind==='fulfillment'&&n.expression.getText(ast)==='request'&&n.arguments.length===2))out.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));ts.forEachChild(n,visit);}visit(ast);return out.sort();}assert.deepEqual(calls(root),calls(baseline));
});
for(const kind of ['new','edit','commercial','fulfillment'])test(`${kind}: source enums, default lines and operation-key generation are unchanged`,()=>{
 function constants(dir){const ast=parse(dir,kind),out={};for(const n of ast.statements)if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)out[d.name.getText(ast)]=printer.printNode(ts.EmitHint.Unspecified,d.initializer,ast);return out;}assert.deepEqual(constants(root),constants(baseline));
});
// Portal overlay changes only these two presentation routes; API proxies stay exact.
test('Orders API proxies remain outside the Portal presentation slice',()=>{
 for(const file of ['src/app/api/sales/[...segments]/route.ts','src/app/api/finance/[[...path]]/route.ts','src/app/api/inventory/[[...path]]/route.ts'])assert.equal(read(root,file),read(baseline,file),file);
});
test('client Orders routes match the exact approved Portal overlay and separate read-only modes',()=>{
 const {createHash}=require('node:crypto'),{sourceLoader}=require('./reconciliation-harness.cjs');
 const marker=()=>null,loader=sourceLoader({'@/components/client-portal/portal-workspace':{ClientPortalWorkspace:marker}});
 for(const[file,sha,mode]of [
  ['src/app/dashboard/client/orders/page.tsx','43ab8c59e5cbf62e1074f7fa8c984746ef183eb79780fe9d2bbb6287e5de1804','register'],
  ['src/app/dashboard/client/orders/[orderId]/page.tsx','648878423b9e6d65de902645f941b0457e6a52c816df5e49f76efc8e261e2897','document'],
 ]){
  assert.equal(createHash('sha256').update(read(root,file)).digest('hex'),sha,file);
  const node=loader.load(file).default();assert.equal(node.type,marker);assert.deepEqual(node.props,{kind:'orders',mode});
 }
 // Endpoint, linked-client identity, and read-only composition are independently
 // executed by client-portal-controller/presentation; no API/schema exemption.
 const doc=read(root,'src/hooks/use-client-portal-document.ts'),register=read(root,'src/hooks/use-client-portal-register.ts');
 assert.ok(doc.includes('`/api/client-portal/${kind}/${encodeURIComponent(id)}`'));
 assert.ok(doc.includes('value.id === id')&&doc.includes('client.id === value.client_id'));
 assert.ok(register.includes('`/api/client-portal/${kind}`')&&register.includes('client.id === row.client_id'));
 for(const source of [doc,register])assert.doesNotMatch(source,/method:\s*["'](?:POST|PATCH|DELETE|PUT)["']/);
});
for(const[kind,name]of [['new','submit'],['edit','save']]){
 test(`${kind}: exact financial payload survives dirty/save/race hardening`,()=>{
  function payload(dir){const{ast,node}=find(dir,kind,name);let result;const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='JSON.stringify')result=printer.printNode(ts.EmitHint.Unspecified,n.arguments[0],ast);ts.forEachChild(n,visit);};visit(node);assert.ok(result);return result;}assert.equal(payload(root),payload(baseline));
 });
 test(`${kind}: original client/date/line validation rules remain intact`,()=>{
  function guards(dir){const{ast,node}=find(dir,kind,name);return node.body.statements.filter(ts.isIfStatement).filter(n=>n.thenStatement.getText(ast).includes('setError(')).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,ast));}assert.deepEqual(guards(root),guards(baseline));
 });
}

// URL/cache controller intentionally replaces the old local-only browse state.
// Protect its API adapter, company summaries and conversion mutation, not obsolete effects.
test('list: original authentication adapter and company-summary payloads are unchanged',()=>{
 function variable(dir,name){const {ast,node}=find(dir,'list','OrdersPage');const declaration=node.body.statements.filter(ts.isVariableStatement).flatMap(n=>n.declarationList.declarations).find(d=>d.name.getText(ast)===name);assert.ok(declaration);return printer.printNode(ts.EmitHint.Unspecified,declaration.initializer,ast);}
 for(const name of ['api','query','refreshSummary'])assert.equal(variable(root,name),variable(baseline,name),name);
});
test('list: accepted quotation conversion keeps the exact original POST contract',()=>{
 function mutation(dir){const{ast,node}=find(dir,'list','convertQuotation');const calls=[];function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='api')calls.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));ts.forEachChild(n,visit);}visit(node);return calls;}assert.deepEqual(mutation(root),mutation(baseline));
});
test('list: all five count and per-currency status bindings retain their original expressions',()=>{
 function stats(dir){const{ast,node}=find(dir,'list',dir===root?'OrderSummary':'OrdersPage');const out=[];function visit(n){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(ast)==='Stat')out.push(n.attributes.properties.filter(ts.isJsxAttribute).filter(a=>['label','value','values'].includes(a.name.text)).map(a=>printer.printNode(ts.EmitHint.Unspecified,a,ast)).join(' '));ts.forEachChild(n,visit);}visit(node);return out;}assert.deepEqual(stats(root),stats(baseline).map(value=>value.replace('?? 0','?? \"—\"')));
});

function currentFulfillmentBody(name){const {ast,node}=find(root,'fulfillment',name);return{ast,node,text:printed(node.body,ast)};}
test('fulfillment: one shared POST forwards only retained URL, body and operation key',()=>{
 const {ast,node}=find(root,'fulfillment','performOperation'),requests=[];const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='request')requests.push(n);ts.forEachChild(n,visit);};visit(node);
 assert.equal(requests.length,1);
 assert.deepEqual(tokens(printed(requests[0],ast)),tokens('request(pending.url, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key }, body: pending.body })'));
 const source=read(root,files.fulfillment),all=parse(root,'fulfillment');let businessPosts=0;const count=n=>{if(ts.isCallExpression(n)&&n.expression.getText(all)==='request'&&n.arguments.length===2)businessPosts++;ts.forEachChild(n,count);};count(all);assert.equal(businessPosts,1,'no separate second write path');
 assert.match(source,/class FulfillmentRequestError extends Error/);assert.match(source,/readonly status: number/);
});
test('fulfillment: synchronous lock and committed latch precede any readback; finally releases busy state',()=>{
 const {ast,node}=find(root,'fulfillment','performOperation'),statements=node.body.statements;
 assert.deepEqual(tokens(printed(statements[0],ast)),tokens('if (disabled || inFlight.current || pending.confirmed || pending.orderId !== orderId) return;'));
 assert.deepEqual(tokens(printed(statements[1],ast)),tokens('inFlight.current = true;'));
 const attempt=statements.find(ts.isTryStatement);assert.ok(attempt);
 assert.deepEqual(tokens(printed(attempt.tryBlock.statements[1],ast)),tokens('pending.confirmed = true;'));
 const refreshIndex=attempt.tryBlock.statements.findIndex(n=>printed(n,ast)==='await refreshSavedStatus();');assert.ok(refreshIndex>1,'commit is latched before refresh');
 assert.deepEqual(tokens(printed(attempt.catchClause.block,ast)),tokens('{ if (pending.confirmed) setError("This stock action was saved. Refresh status; do not post it again."); else writeFailed(reason); }'));
 assert.deepEqual(tokens(printed(attempt.finallyBlock,ast)),tokens('{ inFlight.current = false; setSaving(false); setReversing(false); }'));
});
test('fulfillment: only fresh readback plus changed stock unlocks; uncertain changed payload cannot replace its key',()=>{
 const {text}=currentFulfillmentBody('prepareOperation');
 assert.deepEqual(tokens(text),tokens(`{
  const signature = JSON.stringify([orderId, url, body]);
  let previous = operation.current;
  if (previous?.confirmed && readbackComplete && stockSnapshot !== previous.beforeStock) { operation.current = null; previous = null; }
  if (previous?.confirmed) { setError("This stock action was saved. Refresh its status before another action; do not post it again."); return null; }
  if (previous && previous.signature !== signature) { setError("The previous stock action has an uncertain outcome. Retry the unchanged request with its retained key, or verify fulfillment history before reloading and starting a different action."); return null; }
  const next = previous ?? { signature, key: operationKey(prefix), confirmed: false, beforeStock: stockSnapshot, resultLabel: "Fulfillment", orderId, url, body, reversing: prefix === "fulfill-reverse" };
  operation.current = next; setConfirmedBeforeStock(null); setReadbackComplete(false); return next;
 }`));
});
test('fulfillment: confirmed-status recovery performs reads only and never clears the operation after read failure',()=>{
 const {text}=currentFulfillmentBody('refreshSavedStatus');assert.deepEqual(tokens(text),tokens(`{
  const pending = operation.current; if (!pending?.confirmed) return false;
  try { await onFulfilled(pending.resultLabel); if (!await load()) throw new Error("Fulfillment history could not be refreshed."); setReadbackComplete(true); return true; }
  catch { setError("The stock action was saved, but its latest status could not be refreshed. Retry status refresh; do not submit the stock action again."); return false; }
 }`));
});
test('fulfillment: uncertain retry uses stored operation and explicit rejected writes alone permit corrected new operations',()=>{
 assert.deepEqual(tokens(currentFulfillmentBody('retryUnchanged').text),tokens('{ const pending = operation.current; if (uncertain && pending && !pending.confirmed) await performOperation(pending); }'));
 assert.deepEqual(tokens(currentFulfillmentBody('writeFailed').text),tokens(`{
  if (reason instanceof FulfillmentRequestError && [400, 401, 403, 404, 422].includes(reason.status)) { operation.current = null; setUncertain(false); } else setUncertain(true);
  setError(reason instanceof Error ? reason.message : "The stock action could not be confirmed. Verify history before retrying.");
 }`));
});


test('settlement extraction: original seven-field JSON object and fee.toFixed(2) remain exact',()=>{
 const old=find(baseline,'detail','submitSettlement');let original;
 const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(old.ast)==='JSON.stringify')original=n.arguments[0];ts.forEachChild(n,visit);};visit(old.node);assert.ok(original);
 const file='src/components/commercial/order-settlement-model.ts',ast=ts.createSourceFile(file,read(root,file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let actual;
 const collect=n=>{if(ts.isObjectLiteralExpression(n)&&n.properties.some(p=>p.name?.getText(ast)==='account_id')&&n.properties.length===7)actual=n;ts.forEachChild(n,collect);};collect(ast);assert.ok(actual);
 let expected=printed(original,old.ast);for(const [oldName,next]of Object.entries({settlementAccountId:'values.accountId',settlementDate:'values.date',expenseCategoryId:'values.categoryId',expenseDescription:'values.description',markInvoiceSent:'values.markSent',settlementReference:'values.reference'}))expected=expected.replaceAll(oldName,next);
 assert.deepEqual(tokens(printed(actual,ast)),tokens(expected));
 assert.match(read(root,file),/const expense = Number\(values.expenseAmount \|\| 0\)/);
 for(const message of ['Select the account or wallet that received the order payment.','Enter a valid expense amount.','Settlement expense cannot exceed the order total.','Select an expense category when an expense amount is entered.'])assert.ok(read(root,file).includes(message));
});
