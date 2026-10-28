/** My Work contracts against the exact baseline; no service or real-user fixtures. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const baseline=process.env.BASELINE_FRONTEND?path.resolve(process.env.BASELINE_FRONTEND):path.resolve(root,'../business-os-my-work-recovery-20261026/baseline-source/frontend');
const original=path.join(baseline,'src/app/dashboard/my-work/page.tsx');
const printer=ts.createPrinter({removeComments:true});
const parse=file=>ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(file,name){const ast=parse(file);let node;const visit=n=>{if((ts.isVariableDeclaration(n)||ts.isFunctionDeclaration(n)||ts.isTypeAliasDeclaration(n))&&n.name?.getText(ast)===name)node=n;ts.forEachChild(n,visit);};visit(ast);assert.ok(node,`${name} in ${path.basename(file)}`);return{ast,node};}
function printed(file,name,part){const{ast,node}=declaration(file,name);return printer.printNode(ts.EmitHint.Unspecified,part?node[part]:node,ast).replace(/^export /,'');}
for(const file of ['src/app/api/workspace/[endpoint]/route.ts','src/app/api/workspace/tasks/[taskId]/route.ts','src/app/api/projects/[...segments]/route.ts'])test(`${file}: existing authenticated API contract remains byte-identical`,()=>assert.equal(fs.readFileSync(path.join(root,file),'utf8'),fs.readFileSync(path.join(baseline,file),'utf8')));
const model=path.join(root,'src/components/my-work/my-work-model.ts');
function tokens(text){const scanner=ts.createScanner(ts.ScriptTarget.Latest,true);scanner.setText(text);const out=[];while(scanner.scan()!==ts.SyntaxKind.EndOfFileToken)out.push(scanner.getTokenText());return out.filter((value,index)=>value!==','||!['}',']'].includes(out[index+1])).join(' ');}
const renamed={WorkTask:'Task',WorkProject:'Project',PersonalWorkspace:'WorkspaceData',WorkActivity:'TaskActivity',PersonalTaskDetail:'TaskDetail'};
for(const[after,before]of Object.entries(renamed))test(`My Work ${before}: extracted DTO retains every original field`,()=>{let actual=printed(model,after);for(const[newName,oldName]of Object.entries(renamed))actual=actual.replaceAll(newName,oldName);assert.equal(tokens(actual),tokens(printed(original,before)));});
test('My Work active board status values preserve all four original lanes',()=>assert.equal(tokens(printed(model,'WORK_STATUSES','initializer')),tokens(printed(original,'STATUS_COLUMNS','initializer'))));
test('My Work status display labels preserve every original status including closed records',()=>assert.equal(tokens(printed(model,'STATUS_LABELS','initializer')),tokens(printed(original,'STATUS_LABELS','initializer'))));
test('My Work lock helper retains the original task OR project terminal-state restriction',()=>{const {ast,node}=declaration(model,'workIsLocked'),returned=node.body.statements.find(ts.isReturnStatement);assert.equal(tokens(printer.printNode(ts.EmitHint.Unspecified,returned.expression,ast)),tokens(printed(original,'locked','initializer')));});
test('standalone Update retains original work-note and numeric HTML constraints',()=>{
 function constraints(file,name){const{ast,node}=declaration(file,name),found=[];const visit=n=>{if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){const tag=n.tagName.getText(ast);if(['input','textarea','select'].includes(tag)){const attrs=n.attributes.properties.filter(ts.isJsxAttribute).filter(a=>['type','min','max','required','minLength','maxLength'].includes(a.name.getText(ast))).map(a=>tokens(printer.printNode(ts.EmitHint.Unspecified,a,ast))).sort();found.push(tag+' '+attrs.join('|'));}}ts.forEachChild(n,visit);};visit(node);return found.sort();}assert.deepEqual(constraints(path.join(root,'src/components/my-work/my-work-workspace.tsx'),'WorkUpdateForm'),constraints(original,'TaskDrawer'));
});
