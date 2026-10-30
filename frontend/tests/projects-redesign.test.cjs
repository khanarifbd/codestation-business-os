/** Projects contracts against the immutable baseline. No live API, files or vault access. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const baseline=process.env.BASELINE_FRONTEND?path.resolve(process.env.BASELINE_FRONTEND):path.join(root,'../test-fixtures/frontend-original');
const original=path.join(baseline,'src/app/dashboard/projects/[projectId]/page.tsx');
const originalList=path.join(baseline,'src/app/dashboard/projects/page.tsx');
const model=path.join(root,'src/components/projects/project-model.ts');
const listModel=path.join(root,'src/components/projects/project-list-model.ts');
const printer=ts.createPrinter({removeComments:true});
const parse=file=>ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(file,name){const ast=parse(file);let node;const visit=n=>{if((ts.isVariableDeclaration(n)||ts.isFunctionDeclaration(n)||ts.isTypeAliasDeclaration(n))&&n.name?.getText(ast)===name)node=n;ts.forEachChild(n,visit);};visit(ast);assert.ok(node,`${name} in ${path.basename(file)}`);return{ast,node};}
function printed(file,name,part){const{ast,node}=declaration(file,name);return printer.printNode(ts.EmitHint.Unspecified,part?node[part]:node,ast).replace(/^export /,'');}
for(const name of ['Tab','ProjectMember','ProjectAccess','ProjectDetail','Summary','MilestoneRow','TaskRow','WorkLog','DocumentRow','CredentialRow','Workspace','EmployeeOption','Meta','CredentialValues','TaskEditValues'])test(`Projects model ${name}: original DTO contract is unchanged`,()=>assert.equal(printed(model,name),printed(original,name)));
for(const name of ['tabs','allTabIds','defaultMemberTabs','previewTypes','pretty','formatBytes','localDateKey','isOverdueDate','vaultMessage'])test(`Projects ${name}: existing tabs, display math, preview types and safe error copy remain exact`,()=>assert.equal(printed(model,name),printed(original,name)));
for(const[old,next]of [['EmployeeOption','ProjectEmployeeOption'],['Meta','ProjectListMeta'],['Summary','ProjectSummary'],['ProjectRow','ProjectListRow'],['OrderDetail','ProjectOrder'],['ProjectLink','ExistingProjectLink']])test(`Projects list ${old}: extraction preserves every original field`,()=>assert.equal(printed(listModel,next).replaceAll('ProjectEmployeeOption','EmployeeOption').replace(`type ${next}` ,`type ${old}`),printed(originalList,old)));
function reviewedExactMoney(file,name,override) {
 const source=override??fs.readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert.ok(fn);
 assert.equal(printer.printNode(ts.EmitHint.Unspecified,fn,ast).replace(/^export /,''),`function ${name}(value: string | number, currency: string) { return formatMoneyExact(value, currency); }`);
 const imports=ast.statements.filter(ts.isImportDeclaration).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,ast));
 assert.ok(imports.includes('import { formatMoneyExact } from "@/lib/sales-money-preview";'));
}
for(const[file,name]of [[model,'money'],[listModel,'projectMoney']]) {
 test(`Projects ${name}: exact shared two-decimal display is the only reviewed replacement`,()=>reviewedExactMoney(file,name));
 for(const[from,to]of [['formatMoneyExact(value, currency)','formatMoneyExact(Number(value), currency)'],['formatMoneyExact(value, currency)','formatMoneyExact(value, "USD")'],['@/lib/sales-money-preview','@/lib/unreviewed-money']])test(`Projects ${name}: reject display tampering ${to}`,()=>assert.throws(()=>reviewedExactMoney(file,name,fs.readFileSync(file,'utf8').replace(from,to))));
}
for(const file of ['src/app/api/projects/[...segments]/route.ts'])test(`${file}: existing notes, feedback and authenticated proxy remain byte-identical`,()=>assert.equal(fs.readFileSync(path.join(root,file),'utf8'),fs.readFileSync(path.join(baseline,file),'utf8')));
function stringifyBodies(file,fn){const{ast,node}=declaration(file,fn),out=[];const visit=n=>{if(ts.isCallExpression(n)&&['JSON.stringify','json'].includes(n.expression.getText(ast)))out.push(printer.printNode(ts.EmitHint.Unspecified,n.arguments[n.expression.getText(ast)==='json'?1:0],ast).replace(/\s+/g,' ').replace(/,\s*}/g,' }'));ts.forEachChild(n,visit);};visit(node);return out;}
// Controller boundaries may intentionally change for routing, duplicate-write and stale-read safety.
// Keep the actual JSON fields/math exact instead of freezing obsolete modal/read controllers.
const controller=path.join(root,'src/hooks/use-project-workspace.ts');
for(const name of ['changeProjectStatus','createMilestone','updateMilestone','createTask','updateTask','updateProgress','createCredential','updateCredential','saveTeam'])test(`Projects ${name}: existing payload fields, null handling and hours-to-minutes math are unchanged`,()=>assert.deepEqual(stringifyBodies(controller,name),stringifyBodies(original,name)));
test('Projects create-from-order retains original field-only payload with the extracted values object',()=>{
 const actual=stringifyBodies(path.join(root,'src/hooks/use-project-register.ts'),'createProject').map(s=>s.replace(/\bvalues\./g,'').replace('priority: priority','priority'));assert.deepEqual(actual,stringifyBodies(originalList,'createProject'));
});
test('Document upload keeps multipart field names and optional notes, never JSON-serializes a file',()=>{
 function appends(file){const{ast,node}=declaration(file,'uploadDocument'),out=[];const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='form.append')out.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));ts.forEachChild(n,visit);};visit(node);return out;}assert.deepEqual(appends(controller),appends(original));
});
const editors=path.join(root,'src/components/projects/project-editors.tsx');
const editorPairs=[['MilestoneModal','MilestoneEditor'],['EditMilestoneModal','EditMilestoneEditor'],['TaskModal','TaskEditor'],['EditTaskModal','EditTaskEditor'],['ProgressModal','ProgressEditor'],['DocumentModal','DocumentEditor'],['CredentialModal','CredentialEditor'],['TeamModal','TeamEditor']];
for(const[before,after]of editorPairs)test(`${after}: original controlled fields, callbacks, options and constraints are preserved`,()=>{
 function fields(file,name){const{ast,node}=declaration(file,name),out=[];const visit=n=>{if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){const tag=n.tagName.getText(ast);if(['input','select','textarea','option'].includes(tag)){const attrs=n.attributes.properties.filter(ts.isJsxAttribute).filter(a=>['value','checked','disabled','onChange','type','min','max','step','maxLength','autoComplete','required','multiple','accept'].includes(a.name.getText(ast))).map(a=>printer.printNode(ts.EmitHint.Unspecified,a,ast)).sort();out.push(tag+' '+attrs.join('|'));}}ts.forEachChild(n,visit);};visit(node);return out.sort();}assert.deepEqual(fields(editors,after),fields(original,before));
});
for(const[fn,variables]of [['EditMilestoneEditor',['activeTaskDates','latestTaskDue','changed','taskConflict','projectConflict']],['EditTaskEditor',['selectedMilestone','invalidRange','milestoneConflict','dueChanged','wasOverdue']]])for(const variable of variables)test(`${fn}/${variable}: scheduling warnings retain exact original formulas`,()=>assert.equal(printed(editors,variable,'initializer'),printed(original,variable,'initializer')));
for(const fn of ['selectEmployee','togglePermission','save'])test(`TeamEditor/${fn}: manager membership, full access and last-tab guard remain unchanged`,()=>assert.equal(printed(editors,fn),printed(original,fn)));
test('ProgressEditor automatic status intentionally fixes completed-task reopening while preserving the existing work payload',()=>{const {ast,node}=declaration(editors,'ProgressEditor');const state=node.body.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations).find(d=>ts.isArrayBindingPattern(d.name)&&d.name.elements[0].name.getText(ast)==='status');assert.equal(printer.printNode(ts.EmitHint.Unspecified,state.initializer,ast),'useState("")');assert.match(fs.readFileSync(editors,'utf8'),/reopen/i);});

// Shared-navigation hardening intentionally changes only these embedded controllers.
// Replace their former whole-file freeze with exact business contracts and field bindings.
function embeddedContracts(file) {
  const ast=parse(file), requests=[], fields=[], capabilities=[];
  function visit(node) {
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==='fetch') requests.push(node.arguments.map(arg=>printer.printNode(ts.EmitHint.Unspecified,arg,ast)));
    if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&['input','textarea','select','SearchableSelect'].includes(node.tagName.getText(ast))) fields.push(node.attributes.properties.filter(ts.isJsxAttribute).filter(attr=>['name','type','value','checked','onChange','onValueChange','min','max','step','maxLength','required','disabled','options'].includes(attr.name.text)).map(attr=>printer.printNode(ts.EmitHint.Unspecified,attr,ast)));
    if(ts.isConditionalExpression(node)&&/canManage|can_manage_review|can_view_tips|can_record_tip/.test(node.condition.getText(ast))) capabilities.push(printer.printNode(ts.EmitHint.Unspecified,node.condition,ast));
    ts.forEachChild(node,visit);
  }
  visit(ast); return {requests,fields,capabilities};
}
// Exact append-only Projects child-write layer. The old v9 inputs remain byte-pinned.
const childBaselinePins = {
  'src/components/project-notes-section.tsx': 'b3a683278baa0d399e708520db2f87c1840ded426aef887b4e42b7b9cb7516c1',
  'src/components/project-review-tips.tsx': '4ddbac9a16db2f8c5c60ec95fa559df9c680d95e0b00722f46590374f62d18c8',
};
function approvedChildContracts(relative, sourceOverride, hookOverride) {
  const originalText = fs.readFileSync(path.join(baseline, relative), 'utf8');
  assert.equal(require('node:crypto').createHash('sha256').update(originalText).digest('hex'), childBaselinePins[relative], 'Exact original child baseline required');
  const source = sourceOverride ?? fs.readFileSync(path.join(root, relative), 'utf8');
  const tree = ts.createSourceFile('current.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const originalTree = ts.createSourceFile('original.tsx', originalText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const emit = (node, owner = tree) => printer.printNode(ts.EmitHint.Unspecified, node, owner);
  const expression = value => {
    const owner = ts.createSourceFile('expression.tsx', `const value = ${value};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return printer.printNode(ts.EmitHint.Unspecified, owner.statements[0].declarationList.declarations[0].initializer, owner);
  };
  const find = (owner, predicate) => { const result = []; const visit = node => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }; visit(owner); return result; };
  const named = name => { const found = find(tree, node => (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name); assert.equal(found.length, 1, name); return found[0]; };
  const expectedFunction = (name, text) => {
    const expected = ts.createSourceFile('expected.ts', text, ts.ScriptTarget.Latest, true);
    assert.equal(emit(named(name)), printer.printNode(ts.EmitHint.Unspecified, expected.statements[0], expected), `${name} must retain its precise gate`);
  };
  const isReview = relative.endsWith('project-review-tips.tsx');
  if (isReview) {
    expectedFunction('changeTip', 'function changeTip(value: SetStateAction<TipForm>) { if (tipOperation.canEdit()) setTipForm(value); }');
    expectedFunction('changeReview', 'function changeReview(value: SetStateAction<ReviewForm>) { if (isCurrent() && !pendingRef.current && !reviewOutcomeRef.current) setReviewForm(value); }');
  }
  const oldFields = find(originalTree, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ['input','textarea','select','SearchableSelect'].includes(node.tagName.getText(originalTree)));
  const fields = find(tree, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ['input','textarea','select','SearchableSelect'].includes(node.tagName.getText(tree)));
  assert.equal(fields.length, oldFields.length, 'No original field is removed or added silently');
  const kept = new Set(['name','type','value','checked','onChange','onValueChange','min','max','step','maxLength','required','disabled','options']);
  const normalizedFields = fields.map((node, index) => {
    let attributes = node.attributes.properties.filter(ts.isJsxAttribute).filter(attr => kept.has(attr.name.text));
    if (!isReview) {
      const name = index === 0 ? 'title' : 'content';
      assert.ok(index < 2, 'Only the two original note fields can be adapted');
      const disabled = attributes.find(attr => attr.name.text === 'disabled');
      assert.equal(emit(disabled), 'disabled={saving || Boolean(writeOutcome)}');
      const change = attributes.find(attr => attr.name.text === 'onChange');
      const expected = ts.createSourceFile('expected.tsx', `<input onChange={(event) => { if (!pendingRef.current && !outcomeRef.current) setDraft((current) => ({ ...current, ${name}: event.target.value })); }} />`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const expectedAttr = find(expected, n => ts.isJsxAttribute(n) && n.name.text === 'onChange')[0];
      assert.equal(emit(change), printer.printNode(ts.EmitHint.Unspecified, expectedAttr, expected), `Exact pending/outcome guard for ${name}`);
      const oldChange = oldFields[index].attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.text === 'onChange');
      return attributes.filter(attr => attr !== disabled).map(attr => attr === change ? printer.printNode(ts.EmitHint.Unspecified, oldChange, originalTree) : emit(attr));
    }
    return attributes.map(attr => {
      if (!['onChange','onValueChange'].includes(attr.name.text)) return emit(attr);
      let replacements = 0;
      const result = ts.transform(attr, [context => {
        const visit = node => {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['changeReview','changeTip'].includes(node.expression.text)) {
            replacements += 1;
            return ts.factory.updateCallExpression(node, ts.factory.createIdentifier(node.expression.text === 'changeReview' ? 'setReviewForm' : 'setTipForm'), node.typeArguments, node.arguments);
          }
          return ts.visitEachChild(node, visit, context);
        };
        return visit;
      }]);
      try { assert.equal(replacements, 1, 'Each existing field uses precisely one gated setter'); return emit(result.transformed[0]); } finally { result.dispose(); }
    });
  });
  const requests = find(tree, node => ts.isCallExpression(node) && node.expression.getText(tree) === 'fetch').map(call => call.arguments.map(arg => emit(arg)));
  if (isReview) {
    const captured = named('submitted');
    assert.ok(ts.isVariableDeclaration(captured) && ts.isObjectLiteralExpression(captured.initializer));
    const reviewIndex = requests.findIndex(args => args[0] === '`/api/projects/${projectId}/review`');
    assert.ok(reviewIndex >= 0);
    const fetchNode = find(tree, n => ts.isCallExpression(n) && n.expression.getText(tree) === 'fetch')[reviewIndex];
    const body = fetchNode.arguments[1].properties.find(p => p.name?.getText(tree) === 'body');
    assert.equal(emit(body.initializer), 'JSON.stringify(submitted)', 'Only the reviewed capture seam is accepted');
    const originalPrinted = requests[reviewIndex][1];
    assert.equal(originalPrinted.split('JSON.stringify(submitted)').length, 2);
    requests[reviewIndex][1] = expression(originalPrinted.replace('JSON.stringify(submitted)', `JSON.stringify(${emit(captured.initializer)})`));

    const reviews = find(tree, n => ts.isCallExpression(n) && n.expression.getText(tree) === 'tipOperation.review');
    assert.equal(reviews.length, 1); assert.equal(reviews[0].arguments.length, 3);
    assert.equal(emit(reviews[0].arguments[1]), 'projectCurrency');
    assert.equal(emit(reviews[0].arguments[2]), 'confirmationDetails');
    const frozenPayload = reviews[0].arguments[0]; assert.ok(ts.isObjectLiteralExpression(frozenPayload));
    const hookText = hookOverride ?? fs.readFileSync(path.join(root, 'src/hooks/use-project-income-operation.ts'), 'utf8');
    const hook = ts.createSourceFile('operation.ts', hookText, ts.ScriptTarget.Latest, true);
    const hookEmit = node => printer.printNode(ts.EmitHint.Unspecified, node, hook);
    const calls = find(hook, n => ts.isCallExpression(n) && n.expression.getText(hook) === 'fetch');
    assert.equal(calls.length, 1, 'Exactly one explicit transport; no hidden retry request');
    assert.equal(calls[0].arguments.length, 2, 'Transport has only the original URL and options arguments');
    assert.equal(hookEmit(calls[0].arguments[0]), '"/api/accounting/money/income-with-fee"');
    const exactProperties = (node, expectedNames) => {
      assert.ok(ts.isObjectLiteralExpression(node), 'Explicit object literal required');
      assert.ok(node.properties.every(ts.isPropertyAssignment), 'No spread, shorthand or method transport properties');
      assert.deepEqual(node.properties.map(property => hookEmit(property.name)), expectedNames, 'Exact ordered properties; no omissions, duplicates or additions');
      return node.properties.map(property => property.initializer);
    };
    const [method, headers, transportBody] = exactProperties(calls[0].arguments[1], ['method', 'headers', 'body']);
    assert.equal(hookEmit(method), '"POST"', 'Exact original method');
    const [contentType, operationKey] = exactProperties(headers, ['"Content-Type"', '"Idempotency-Key"']);
    assert.equal(hookEmit(contentType), '"application/json"', 'Exact original content type');
    assert.equal(hookEmit(operationKey), 'op.key', 'Only the retained original operation key');
    assert.equal(hookEmit(transportBody), 'op.body', 'Only the frozen original request body');
    const capture = find(hook, n => ts.isVariableDeclaration(n) && n.name.getText(hook) === 'body');
    assert.equal(capture.length, 1); assert.equal(hookEmit(capture[0].initializer), 'JSON.stringify(payload)');
    requests.push(['"/api/accounting/money/income-with-fee"', expression(`{
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(${emit(frozenPayload)}),
    }`)]);
  }
  const capabilities = find(tree, node => ts.isConditionalExpression(node) && /canManage|can_manage_review|can_view_tips|can_record_tip/.test(node.condition.getText(tree))).map(node => emit(node.condition));
  return {requests, fields: normalizedFields, capabilities};
}

for(const relative of ['src/components/project-notes-section.tsx','src/components/project-review-tips.tsx']) {
  const old=path.join(baseline,relative);
  for(const contract of ['requests','fields','capabilities']) test(`${relative}: exact baseline ${contract} preserved through dirty/pending hardening`,()=>assert.deepEqual(approvedChildContracts(relative)[contract],embeddedContracts(old)[contract]));
}
for(const name of ['today','roundMoney','money','errorDetail','blankReview','blankTip','ReviewRow','TipRow','TipTotal','Feedback','FinancialAccount','FinanceMeta','LedgerAccount','ExpenseCategory','Vendor','ExpenseMeta','ReviewForm','TipForm'])test(`Project ReviewTips ${name}: baseline money, defaults and DTO contract remain exact`,()=>assert.equal(printed(path.join(root,'src/components/project-review-tips.tsx'),name),printed(path.join(baseline,'src/components/project-review-tips.tsx'),name)));
for(const name of ['ProjectNote','NoteDraft','emptyDraft','urlPattern','RichText'])test(`Project Notes ${name}: baseline record/default/link contract remains exact`,()=>assert.equal(printed(path.join(root,'src/components/project-notes-section.tsx'),name),printed(path.join(baseline,'src/components/project-notes-section.tsx'),name)));

// Negative changes must still fail the original business comparisons or the exact new gate seam.
const childReviewPath = 'src/components/project-review-tips.tsx';
const currentChildReview = () => fs.readFileSync(path.join(root,childReviewPath),'utf8');
function assertChildReviewPreserved(candidate,hook) {
  const original=embeddedContracts(path.join(baseline,childReviewPath));
  assert.deepEqual(approvedChildContracts(childReviewPath,candidate,hook),original);
}
for(const [name,from,to] of [
 ['changed posted amount','gross_amount: grossAmount','gross_amount: grossAmount + 1'],
 ['renamed financial field','gross_amount: grossAmount','wrong_amount: grossAmount'],
 ['unguarded review setter','if (isCurrent() && !pendingRef.current && !reviewOutcomeRef.current) setReviewForm(value);','setReviewForm(value);'],
 ['unguarded tip setter','if (tipOperation.canEdit()) setTipForm(value);','setTipForm(value);'],
 ['changed amount input step','step="0.01" value={tipForm.amount}','step="1" value={tipForm.amount}'],
]) test('Approved child adapter rejects '+name,()=>{const original=currentChildReview();assert.ok(original.includes(from));assert.throws(()=>assertChildReviewPreserved(original.replace(from,to)));});
for(const [name,from,to] of [
 ['new operation identity instead of retained key','"Idempotency-Key": op.key','"Idempotency-Key": crypto.randomUUID()'],
 ['changed transport path','/api/accounting/money/income-with-fee','/api/accounting/money/other'],
 ['changed content type','"Content-Type": "application/json"','"Content-Type": "text/plain"'],
 ['changed captured transport body','body: op.body','body: JSON.stringify(op.payload)'],
]) test('Approved child adapter rejects '+name,()=>{const hook=fs.readFileSync(path.join(root,'src/hooks/use-project-income-operation.ts'),'utf8');assert.ok(hook.includes(from));assert.throws(()=>assertChildReviewPreserved(currentChildReview(),hook.replace(from,to)));});
test('Approved child adapter rejects an unguarded Note input',()=>{const relative='src/components/project-notes-section.tsx',original=fs.readFileSync(path.join(root,relative),'utf8'),from='if (!pendingRef.current && !outcomeRef.current) setDraft';assert.ok(original.includes(from));assert.throws(()=>approvedChildContracts(relative,original.replace(from,'setDraft')));});
