const { beforeReviewedQuotationDecimals } = require('./helpers/reviewed-quotation-decimals.cjs');
const { withReviewedCanvas } = require('./helpers/reviewed-canvas.cjs');
/** Financial/API invariants survive the intentional route/controller correction. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const baseline=process.env.BASELINE_FRONTEND?path.resolve(process.env.BASELINE_FRONTEND):path.join(root,'../test-fixtures/frontend-original');
const file='src/app/dashboard/quotations/quotation-v2-workspace.tsx';
const read=(dir,rel=file)=>{const source=fs.readFileSync(path.join(dir,rel),'utf8');return dir===root?beforeReviewedQuotationDecimals(rel,source):source;};
const parse=dir=>ts.createSourceFile(file,read(dir),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const printer=ts.createPrinter({removeComments:true});
function find(dir,name){const ast=parse(dir);let node;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(node,name);return{ast,node};}
function jsx(node){let found=false;function visit(n){if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n))found=true;ts.forEachChild(n,visit);}visit(node);return found;}
function logic(dir,name){const {ast,node}=find(dir,name);const render=node.body.statements.find(jsx);return ast.text.slice(node.body.getStart(ast)+1,render?render.getStart(ast):node.body.end-1);}
const components=['PricingTab','OverviewTab','SectionsTab','DeliveryTab','PaymentsTab','ReviewTab','Field','NumberField','TextArea','Action'];
for(const name of components)test(`${name}: all pre-render hooks, requests and derived calculations remain unchanged`,()=>assert.equal(logic(root,name).replace('preview.total : core?.total ?? "0.00"','preview.total : Number(core?.total || 0)'),logic(baseline,name)));
const functions=['localDate','addDays','money','errorMessage','previewLine','blankItem','blankSection','blankMilestone','blankPayment','patchItem','patchSection','patchMilestone','patchPayment','selectLineSource','changeCurrency','validateDraft',];
const approvedMoneyFunctions = {
 money: 'function money(value: string | number | null | undefined, currency: string) { return formatMoneyExact(value, currency); }',
 previewLine: 'function previewLine(item: DraftItem, mode: string) { const line = salesLinePreview(item, mode); return line ? { subtotal: line.subtotal, discount: line.discount, tax: line.tax, total: line.total } : { subtotal: "", discount: "", tax: "", total: "" }; }',
};
function normalizedFunction(source){const ast=ts.createSourceFile('approved.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);return printer.printNode(ts.EmitHint.Unspecified,ast.statements[0],ast);}
for(const name of functions)test(`${name}: exact action implementation or approved Decimal-preview delegation retained`,()=>{const a=find(root,name),b=find(baseline,name);assert.equal(approvedMoneyFunctions[name] ? printer.printNode(ts.EmitHint.Unspecified,a.node,a.ast).replace(/\s+/g," ").trim() : printer.printNode(ts.EmitHint.Unspecified,a.node,a.ast),approvedMoneyFunctions[name] ? normalizedFunction(approvedMoneyFunctions[name]).replace(/\s+/g," ").trim() : printer.printNode(ts.EmitHint.Unspecified,b.node,b.ast));});
const protectedNames=new Set(['value','defaultValue','checked','defaultChecked','disabled','required','name','type','min','max','step','href','target','rel','method','action','options','creating','meta','clients','clientOptions','clientId','existingClientName','subject','issueDate','validUntil','currency','taxMode','assignedEmployeeId','employeeOptions','items','baseLineSourceOptions','internalNotes','preview','sourceLeadId','projectTitle','executiveSummary','estimatedStartDate','estimatedEndDate','estimatedDuration','startCondition','sections','milestones','payments','core','proposal','clientName','total','scheduledTotal','difference','expired','status']);
for(const name of components)test(`${name}: protected JSX events, values, validation and data props remain intact`,()=>{
 function props(dir){const {ast,node}=find(dir,name),out=[];function visit(n){if(ts.isJsxAttribute(n)){const key=n.name.getText(ast);if(protectedNames.has(key)||/^on[A-Z]|^set[A-Z]|^patch[A-Z]|^selectLineSource$/.test(key))out.push(key+'='+(!n.initializer?'true':printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast)));}ts.forEachChild(n,visit);}visit(node);return out.sort();}
 const expected=props(baseline);
 // The create-client selector now also receives the shared read-only/pending guard.
 if(name==='PricingTab')expected.push('disabled={disabled}');
 assert.deepEqual(props(root),expected.sort());
});
test('Commercial section types and standard contents are unchanged',()=>{
 function declarations(dir){const ast=parse(dir),out={};function visit(n){if(ts.isVariableDeclaration(n)&&['SECTION_TYPES','STANDARD_SECTIONS'].includes(n.name.getText(ast)))out[n.name.getText(ast)]=printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast);ts.forEachChild(n,visit);}visit(ast);return out;}
 assert.deepEqual(declarations(root),declarations(baseline));
});
// Controller hooks, selection, race guards and routing are intentionally not frozen to
// the old stacked-page implementation. Exact commercial payloads remain protected.
for(const name of ['corePayload','commercialPayload'])test(`${name}: financial/API payload shape is unchanged`,()=>{
 function declaration(dir){const ast=parse(dir);let value;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)value=printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast);ts.forEachChild(n,visit);}visit(ast);assert.ok(value,name);return value;}
 const expected = declaration(baseline);
 const actual = declaration(root);
 if (name === 'corePayload') {
   const legacy = 'notes: null,\n    terms_conditions: null,';
   assert.ok(expected.includes(legacy));
   assert.equal(actual, expected.replace(legacy, '...(!existingCore ? { notes: null, terms_conditions: null } : {}),'));
 } else assert.equal(actual, expected);
});
test('Sales proxy stays unchanged; saved-document print permits only reviewed canvas change',()=>{
 for(const rel of ['src/app/api/sales/[...segments]/route.ts','src/app/print/quotations/[quotationId]/page.tsx','src/app/print/quotations/[quotationId]/layout.tsx'])assert.equal(read(root,rel),withReviewedCanvas(rel,read(baseline,rel)),rel);
});
for(const [name,names]of [['PricingTab',['line','sourceValue','sourceOptions']],['PaymentsTab',['derivedAmount']]])test(`${name}: nested financial and catalog derivations remain unchanged`,()=>{
 function declarations(dir){const {ast,node}=find(dir,name),out={};function visit(n){if(ts.isVariableDeclaration(n)&&names.includes(n.name.getText(ast)))out[n.name.getText(ast)]=printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast);ts.forEachChild(n,visit);}visit(node);return out;}
 assert.deepEqual(declarations(root),declarations(baseline));
});
function navigationHelpers(){
 const Module=require('node:module'),filename=path.join(root,'src/lib/quotation-navigation.ts'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);return mod.exports;
}
for(const [mode,suffix]of [['view',''],['edit','/edit']])test(`Quotation ${mode} builds a dedicated encoded document route`,()=>{
 const url=new URL(navigationHelpers().quotationDocumentHref('synthetic/id',mode,'/dashboard/quotations?search=A%20B&status=draft&pages=2'),'https://example.invalid');
 assert.equal(url.pathname,`/dashboard/quotations/synthetic%2Fid${suffix}`);assert.equal(new URL(url.searchParams.get('returnTo'),'https://example.invalid').pathname,'/dashboard/quotations');
});
test('Quotation create uses its own route and carries the safe list context',()=>{
 const url=new URL(navigationHelpers().quotationCreateHref('/dashboard/quotations?search=Synthetic&status=sent&pages=2'),'https://example.invalid');assert.equal(url.pathname,'/dashboard/quotations/new');const back=new URL(url.searchParams.get('returnTo'),'https://example.invalid');assert.equal(back.searchParams.get('search'),'Synthetic');assert.equal(back.searchParams.get('status'),'sent');assert.equal(back.searchParams.get('pages'),'2');
});
for(const target of ['https://example.invalid/outside','//example.invalid/outside','javascript:alert(1)','/dashboard/orders','/dashboard/quotations/new','/dashboard/quotations/../orders'])test(`Return route rejects non-list target ${target}`,()=>assert.equal(navigationHelpers().safeQuotationReturnHref(target),'/dashboard/quotations'));
test('List return context retains search/status/pages and drops unrelated parameters',()=>{
 const value=navigationHelpers().safeQuotationReturnHref('/dashboard/quotations?search=A%20%26%20B&status=draft&pages=3&token=synthetic&quotation_id=old');const url=new URL(value,'https://example.invalid');assert.equal(url.pathname,'/dashboard/quotations');assert.equal(url.searchParams.get('search'),'A & B');assert.equal(url.searchParams.get('status'),'draft');assert.equal(url.searchParams.get('pages'),'3');assert.equal(url.searchParams.has('token'),false);assert.equal(url.searchParams.has('quotation_id'),false);
});
async function renderRoute(relative,params){
 const Module=require('node:module'),filename=path.join(root,relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
 mod.require=id=>id.includes('quotation-v2-workspace')?{QuotationV2Workspace:'QuotationV2Workspace'}:id.includes('quotations-list')?{__esModule:true,default:'QuotationsList'}:id==='react'?{Suspense:'Suspense'}:require(id);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,filename);return mod.exports.default({params:Promise.resolve(params)});
}
test('Browse entry renders only its list inside Suspense, never the document controller',async()=>{const tree=await renderRoute('src/app/dashboard/quotations/page.tsx');assert.equal(tree.type,'Suspense');assert.equal(tree.props.children.type,'QuotationsList');});
for(const [relative,mode,key]of [['new/page.tsx','create','create:new'],['[quotationId]/page.tsx','view','view:synthetic/id'],['[quotationId]/edit/page.tsx','edit','edit:synthetic/id']])test(`${mode} route keys its explicit document mode and ID`,async()=>{const tree=await renderRoute(`src/app/dashboard/quotations/${relative}`,{quotationId:'synthetic/id'});assert.equal(tree.type,'QuotationV2Workspace');assert.equal(tree.props.mode,mode);assert.equal(tree.key,key);assert.equal(tree.props.quotationId,mode==='create'?undefined:'synthetic/id');});
