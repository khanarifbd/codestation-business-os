/** Source-contract checks for the presentation-only CRM/client redesign. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const baseline=process.env.BASELINE_FRONTEND
  ? path.resolve(process.env.BASELINE_FRONTEND)
  : path.resolve(root,'../business-os-reconcile-20261025/baseline-source/frontend');
const files={crm:'src/app/dashboard/crm/page.tsx',clients:'src/app/dashboard/clients/page.tsx',detail:'src/app/dashboard/clients/[clientId]/page.tsx'};
const read=(dir,file)=>fs.readFileSync(path.join(dir,file),'utf8');
const ast=(dir,file)=>ts.createSourceFile(file,read(dir,file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const printer=ts.createPrinter({removeComments:true});
function find(dir,file,name){const source=ast(dir,file);let node;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;ts.forEachChild(n,visit);}visit(source);assert.ok(node,name);return {source,node};}
function jsx(node){let found=false;function visit(n){if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n))found=true;ts.forEachChild(n,visit);}visit(node);return found;}
function logic(dir,file,name){const {source,node}=find(dir,file,name);const first=node.body.statements.find(jsx);return source.text.slice(node.body.getStart(source)+1,first?first.getStart(source):node.body.end-1);}
for(const [kind,names] of [['crm',['CrmPage','LeadDrawer','PipelineStatuses','PipelineSources']],['clients',['ClientsPage','ClientForm']],['detail',['ClientWorkspacePage']]])for(const name of names)test(`${name}: pre-render state, effects, request guards and derived data match verified baseline`,()=>assert.equal(logic(root,files[kind],name),logic(baseline,files[kind],name)));
for(const [kind,names] of [['crm',['text','money','when','applyRefresh','run','loadMore','openLead']],['clients',['text','refreshAfterMutation','refreshDetail','loadMore','openClient','createClient','updateClient','changeStatus','togglePortalAccess','clientPayload']],['detail',['pretty','money','date','dateTime']]])for(const name of names)test(`${kind}/${name}: original action or formatting contract retained`,()=>{const a=find(root,files[kind],name),b=find(baseline,files[kind],name);assert.equal(printer.printNode(ts.EmitHint.Unspecified,a.node,a.source),printer.printNode(ts.EmitHint.Unspecified,b.node,b.source));});
for(const [kind,file] of Object.entries(files))test(`${kind}: all API/fetch call expressions and payloads remain unchanged`,()=>{
 function calls(dir){const source=ast(dir,file),out=[];function visit(n){if(ts.isCallExpression(n)&&['api','fetch'].includes(n.expression.getText(source)))out.push(printer.printNode(ts.EmitHint.Unspecified,n,source));ts.forEachChild(n,visit);}visit(source);return out.sort();}
 assert.deepEqual(calls(root),calls(baseline));
});
test('CRM and client-access API proxy files retain authenticated tenant contracts',()=>{
 for(const folder of ['src/app/api/crm','src/app/api/client-access']){const before=fs.readdirSync(path.join(baseline,folder),{recursive:true}).filter(file=>file.endsWith('.ts')).sort();const after=fs.readdirSync(path.join(root,folder),{recursive:true}).filter(file=>file.endsWith('.ts')).sort();assert.deepEqual(after,before);for(const file of before)assert.equal(read(root,folder+'/'+file),read(baseline,folder+'/'+file),file);}
});
test('Underlying client access, resource, service and lead-requirements behavior is unchanged',()=>{
 for(const file of ['src/components/client-access-section.tsx','src/components/client-external-profiles-section.tsx','src/components/client-resources-sections.tsx','src/components/client-services-section.tsx','src/components/lead-requirements-card.tsx','src/lib/company-options.ts'])assert.equal(read(root,file),read(baseline,file),file);
});
