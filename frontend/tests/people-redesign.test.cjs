/** People contracts against the verified baseline. Pure source checks; no secrets or services. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const baseline=process.env.BASELINE_FRONTEND?path.resolve(process.env.BASELINE_FRONTEND):path.resolve(root,'../business-os-my-work-recovery-20261026/baseline-source/frontend');
const original=path.join(baseline,'src/app/dashboard/hr/people/page.tsx');
const printer=ts.createPrinter({removeComments:true});
const parse=file=>ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(file,name){const ast=parse(file);let node;const visit=n=>{if((ts.isVariableDeclaration(n)||ts.isFunctionDeclaration(n)||ts.isTypeAliasDeclaration(n))&&n.name?.getText(ast)===name)node=n;ts.forEachChild(n,visit);};visit(ast);assert.ok(node,`${name} in ${path.basename(file)}`);return{ast,node};}
function printed(file,name,part){const{ast,node}=declaration(file,name);return printer.printNode(ts.EmitHint.Unspecified,part?node[part]:node,ast).replace(/^export /,'');}
function tokens(text){const scanner=ts.createScanner(ts.ScriptTarget.Latest,true);scanner.setText(text);const out=[];while(scanner.scan()!==ts.SyntaxKind.EndOfFileToken)out.push(scanner.getTokenText());return out.filter((value,index)=>value!==','||!['}',']'].includes(out[index+1])).join(' ');}
test('People proxy retains exact tenant header, authenticated transport, methods, cookie rotation and API contracts',()=>{const file='src/app/api/hr/[...path]/route.ts';assert.equal(fs.readFileSync(path.join(root,file),'utf8'),fs.readFileSync(path.join(baseline,file),'utf8'));});
const model=path.join(root,'src/components/people/people-model.ts');
for(const name of ['Person','NamedOption','InviteRole','Invitation','InviteAction'])test(`People ${name}: every original DTO field is preserved`,()=>assert.equal(tokens(printed(model,name)),tokens(printed(original,name))));
test('People extracted bundle retains all collections and three independent server capabilities',()=>assert.equal(tokens(printed(model,'PeopleBundle').replace('PeopleBundle','Bundle')),tokens(printed(original,'Bundle'))));
test('People register views retain Directory, Structure and Invitations without extra features',()=>assert.equal(tokens(printed(model,'PeopleView').replace('PeopleView','View')),tokens(printed(original,'View'))));
test('People invitation secrets remain transient component state, not storage or URL query fields',()=>{for(const file of ['src/hooks/use-people-workspace.ts','src/components/people/people-workspace.tsx','src/lib/people-navigation.ts']){const source=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(source,/localStorage|sessionStorage|document\.cookie|console\.(log|debug|info)/);assert.doesNotMatch(source,/(?:searchParams|params|query)\.set\(["'](?:token|invite_token)/);}});
test('five separate People routes keep suspense boundaries around the shared route-aware workspace',()=>{for(const file of ['page.tsx','new/page.tsx','structure/new/page.tsx','[personId]/page.tsx','[personId]/edit/page.tsx']){const source=fs.readFileSync(path.join(root,'src/app/dashboard/hr/people',file),'utf8');assert.match(source,/Suspense/);assert.match(source,/People(?:Register|Person|Invitation|Structure)?Workspace/);assert.doesNotMatch(source,/fetch\(|method:\s*["'](?:POST|PATCH)/);}});
for(const name of ['primary','more','selfServiceOnly','active','activeMore'])test(`HR navigation ${name}: existing destinations and role visibility remain unchanged`,()=>{const file='src/components/hr-module-nav.tsx';assert.equal(tokens(printed(path.join(root,file),name,'initializer')),tokens(printed(path.join(baseline,file),name,'initializer')));});
