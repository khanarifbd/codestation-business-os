const {checkCrmContract}=require('./helpers/reviewed-crm-correctness.cjs');
/** Source-contract checks for the presentation-only CRM/client redesign. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const baseline=process.env.BASELINE_FRONTEND
  ? path.resolve(process.env.BASELINE_FRONTEND)
  : path.join(root,'../test-fixtures/frontend-original');
const files={crm:'src/app/dashboard/crm/page.tsx',clients:'src/app/dashboard/clients/page.tsx',detail:'src/app/dashboard/clients/[clientId]/page.tsx'};
const {restoreReviewedClients}=require('./helpers/reviewed-clients-revision.cjs');
const read=(dir,file)=>{const source=fs.readFileSync(path.join(dir,file),'utf8');return dir===root?restoreReviewedClients(file,source):source;};
const ast=(dir,file)=>ts.createSourceFile(file,read(dir,file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const printer=ts.createPrinter({removeComments:true});
function find(dir,file,name){const source=ast(dir,file);let node;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;ts.forEachChild(n,visit);}visit(source);assert.ok(node,name);return {source,node};}
function jsx(node){let found=false;function visit(n){if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n))found=true;ts.forEachChild(n,visit);}visit(node);return found;}
function logic(dir,file,name){const {source,node}=find(dir,file,name);const first=node.body.statements.find(jsx);return source.text.slice(node.body.getStart(source)+1,first?first.getStart(source):node.body.end-1);}
for(const [kind,names] of [['crm',['CrmPage','LeadDrawer','PipelineStatuses','PipelineSources']],['clients',['ClientsPage','ClientForm']],['detail',['ClientWorkspacePage']]])for(const name of names)test(`${name}: pre-render state, effects, request guards and derived data match verified baseline`,()=>kind==='crm' && ['CrmPage','LeadDrawer'].includes(name) ? checkCrmContract(name,logic(root,files[kind],name)) : assert.equal(logic(root,files[kind],name),logic(baseline,files[kind],name)));
for(const [kind,names] of [['crm',['text','money','when','applyRefresh','run','loadMore','openLead']],['clients',['text','refreshAfterMutation','refreshDetail','loadMore','openClient','createClient','updateClient','changeStatus','togglePortalAccess','clientPayload']],['detail',['pretty','money','date','dateTime']]])for(const name of names)test(`${kind}/${name}: original action or formatting contract retained`,()=>{const a=find(root,files[kind],name),b=find(baseline,files[kind],name);const current=printer.printNode(ts.EmitHint.Unspecified,a.node,a.source);if(kind==='crm'&&['money','when','run','openLead','applyRefresh'].includes(name))checkCrmContract(name,current);else assert.equal(current,printer.printNode(ts.EmitHint.Unspecified,b.node,b.source));});
for(const [kind,file] of Object.entries(files))test(`${kind}: all API/fetch call expressions and payloads remain unchanged`,()=>{
 function calls(dir){const source=ast(dir,file),out=[];function visit(n){if(ts.isCallExpression(n)&&['api','fetch'].includes(n.expression.getText(source)))out.push(printer.printNode(ts.EmitHint.Unspecified,n,source));ts.forEachChild(n,visit);}visit(source);return out.sort();}
 const expected=calls(baseline).map(call=>kind==='crm'?call.replace('text(form, "estimated_value") ? Number(form.get("estimated_value")) : null','text(form, "estimated_value")').replace('city: text(form, "city"), source_id:', 'city: text(form, "city"), address_line1: text(form, "address_line1"), source_id:'):call);
 if(kind==='crm')expected.push('api(`/leads/${detail.lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(leadEditPayload(form, detail)) })');
 assert.deepEqual(calls(root),expected.sort());
});
test('CRM and client-access API proxy files retain authenticated tenant contracts',()=>{
 for(const folder of ['src/app/api/crm','src/app/api/client-access']){const before=fs.readdirSync(path.join(baseline,folder),{recursive:true}).filter(file=>file.endsWith('.ts')).sort();const after=fs.readdirSync(path.join(root,folder),{recursive:true}).filter(file=>file.endsWith('.ts')).sort();assert.deepEqual(after,before);for(const file of before)assert.equal(read(root,folder+'/'+file),read(baseline,folder+'/'+file),file);}
});
test('Underlying client access, resource, service and lead-requirements behavior is unchanged',()=>{
 for(const file of ['src/components/client-access-section.tsx','src/components/client-external-profiles-section.tsx','src/components/client-resources-sections.tsx','src/components/client-services-section.tsx','src/lib/company-options.ts'])assert.equal(read(root,file),read(baseline,file),file);
});

test('Reviewed Clients allowance rejects tampered exact deltas rather than masking changes',()=>{
 const changes=require('./helpers/reviewed-clients-revision.json');
 for(const [file,hunks] of Object.entries(changes)){
  const {restoreClientSubmodules,restorePriorClients}=require('./helpers/reviewed-clients-revision.cjs');
  const source=restoreClientSubmodules(file,fs.readFileSync(path.join(root,file),'utf8'));
  for(const [,after] of hunks)assert.throws(()=>restorePriorClients(file,source.replace(after,after+'/* unauthorized */').replace(after,after.slice(0,-1))),/exact reviewed Clients hunk/);
 }
});
test("CRM requirements exact reviewed contract and tamper rejection",()=>{const source=read(root,"src/components/lead-requirements-card.tsx");checkCrmContract("requirements",source);assert.throws(()=>checkCrmContract("requirements",source.replace("quantity: row.quantity.trim()","quantity: Number(row.quantity)")),/Unreviewed/);});
test("CRM request ownership contracts reject changed guards",()=>{for(const name of ["CrmPage","LeadDrawer","money","when","run","openLead","applyRefresh","leadEditPayload"]){const {source,node}=find(root,files.crm,name);const value=["CrmPage","LeadDrawer"].includes(name)?logic(root,files.crm,name):printer.printNode(ts.EmitHint.Unspecified,node,source);checkCrmContract(name,value);assert.throws(()=>checkCrmContract(name,value+" /* changed */"),/Unreviewed/);}});
test('CRM permission contract rejects removing wildcard or granting viewers',()=>{const current=logic(root,files.crm,'CrmPage');for(const changed of [current.replace('tenant?.permissions.includes("*") || ',''),current.replace('tenant?.permissions.includes("crm.manage")','tenant?.permissions.includes("crm.view")')])assert.throws(()=>checkCrmContract('CrmPage',changed),/Unreviewed/);});
