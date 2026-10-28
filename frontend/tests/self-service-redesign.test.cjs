/** Source contracts for HR self-service and Employee home; no live accounts or transactions. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const baseline=process.env.BASELINE_FRONTEND?path.resolve(process.env.BASELINE_FRONTEND):path.resolve(root,'../business-os-my-work-recovery-20261026/baseline-source/frontend');
const original=path.join(baseline,'src/app/dashboard/hr/me/page.tsx');
const model=path.join(root,'src/components/self-service/self-service-model.ts');
function parse(file){return ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
function declaration(file,name){const ast=parse(file);let found;const visit=n=>{if((ts.isTypeAliasDeclaration(n)||ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.getText(ast)===name)found=n;ts.forEachChild(n,visit);};visit(ast);assert.ok(found,name);return{ast,node:found};}
function normalized(file,name){const {ast,node}=declaration(file,name),source=ts.createPrinter({removeComments:true}).printNode(ts.EmitHint.Unspecified,node,ast).replace(/^export /,''),scanner=ts.createScanner(ts.ScriptTarget.Latest,true);scanner.setText(source);const tokens=[];while(scanner.scan()!==ts.SyntaxKind.EndOfFileToken)tokens.push(scanner.getTokenText());return tokens.filter((t,i)=>t!==','||!['}',']'].includes(tokens[i+1])).join(' ');}
for(const name of ['SelfData','Meta','PolicyAck','AttendanceRequest','AttendancePlan','LeaveBalance','MonthlyAttendance'])test(`Self service ${name}: all original response fields retained`,()=>assert.equal(normalized(model,name),normalized(original,name)));
test('Employee home retains existing summary and payslip response contract',()=>assert.equal(normalized(model,'HomeData'),normalized(path.join(baseline,'src/app/dashboard/employee/page.tsx'),'HomeData')));
for(const file of ['src/app/api/hr/[...path]/route.ts','src/app/api/workspace/[endpoint]/route.ts'])test(`${file}: authenticated tenant proxy contracts remain unchanged`,()=>assert.equal(fs.readFileSync(path.join(root,file),'utf8'),fs.readFileSync(path.join(baseline,file),'utf8')));
test('personal payslip preserves original authenticated GET and read-only Print/HR-return behavior after approved payroll redesign',async()=>{
 const file='src/components/payroll/employee-payslip.tsx';
 assert.equal(normalized(path.join(root,file),'api'),normalized(path.join(baseline,'src/app/dashboard/hr/me/payslips/[entryId]/page.tsx'),'api'),'existing authenticated-self GET error/response contract');
 const {harness,fixtures,ok,nodes,text,expand}=require('./payroll-test-helper.cjs');
 const h=harness('EmployeePayslipContent',file),entry={...fixtures.entry,id:'own/entry'};
 try {
  h.params({entryId:entry.id});h.response(()=>ok({organization:{name:'Synthetic Company'},run:{...fixtures.run,status:'approved',period_start:fixtures.period.period_start,period_end:fixtures.period.period_end,pay_date:fixtures.period.pay_date},entry}));
  const tree=expand(await h.mount());
  assert.deepEqual(h.requests.map(row=>row.url),['/api/hr/self/payslips/own%2Fentry']);assert.ok(h.requests.every(row=>!row.options?.method));
  assert.equal(nodes(tree,'NextLink').find(link=>text(link)==='My HR & Pay').props.href,'/dashboard/hr/me');
  nodes(tree,'button').find(button=>text(button)==='Print / Save PDF').props.onClick();assert.deepEqual(h.navigation,[['print']]);
  assert.equal(nodes(tree,'form').length+nodes(tree,'input').length,0);assert.match(text(tree),/Synthetic Employee/);
 } finally {h.cleanup();}
});
test('self-service source does not add account security, payroll payment, geolocation persistence or secret storage',()=>{for(const file of ['src/hooks/use-self-service-workspace.ts','src/hooks/use-self-service-attendance.ts','src/components/self-service/self-service-model.ts']){const source=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(source,/localStorage|sessionStorage|document\.cookie|console\.(log|debug)/);assert.doesNotMatch(source,/\/api\/(?:auth|payroll\/.*\/pay|profile\/password)/);}});
for(const file of ['src/app/dashboard/employee/page.tsx','src/app/dashboard/hr/me/page.tsx','src/app/dashboard/hr/me/leave/new/page.tsx','src/app/dashboard/hr/me/attendance/requests/new/page.tsx','src/app/dashboard/hr/me/reviews/[reviewId]/page.tsx','src/app/dashboard/hr/me/reviews/[reviewId]/edit/page.tsx'])test(`${file}: route delegates to a Suspense-wrapped shared workspace, not a second write controller`,()=>{const source=fs.readFileSync(path.join(root,file),'utf8'),ast=parse(path.join(root,file));const jsxNames=[];const visit=n=>{if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))jsxNames.push(n.tagName.getText(ast));ts.forEachChild(n,visit);};visit(ast);assert.ok(jsxNames.includes('Suspense'));assert.ok(jsxNames.some(n=>n==='SelfServiceWorkspace'||n==='EmployeeHomeWorkspace'));assert.doesNotMatch(source,/fetch\(|useEffect|useState|<form/);});
test('self-service keeps read-only payslips and no new financial aggregate endpoint',()=>{const source=fs.readFileSync(path.join(root,'src/hooks/use-self-service-workspace.ts'),'utf8');assert.doesNotMatch(source,/payroll.*(?:post|approve|pay)|\/api\/.*currency.*convert/i);assert.match(source,/\/api\/hr\/self\/home/);assert.match(source,/\/api\/workspace\/me/);});
