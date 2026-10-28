/** Presentation guardrails for the active invoice list/create/detail workflow. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const baseline = process.env.BASELINE_FRONTEND
  ? path.resolve(process.env.BASELINE_FRONTEND)
  : path.resolve(__dirname, '../../business-os-reconcile-20261025/baseline-source/frontend');
const files = { list: 'src/components/invoices-workspace-v2.tsx', detail: 'src/components/invoice-detail-workspace.tsx', payment: 'src/components/invoice-payment-workspace.tsx', workspace: 'src/components/invoice-workspace.tsx' };
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
const parse = (dir, file) => ts.createSourceFile(file, read(dir, file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(dir, file, name, predicate = ts.isFunctionDeclaration) { const ast = parse(dir, file); let node; const visit = n => { if (predicate(n) && n.name?.getText(ast) === name) node = n; ts.forEachChild(n, visit); }; visit(ast); assert.ok(node, `${name} still exists`); return { ast, node }; }
function hasJsx(node) { let found = false; const visit = n => { if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true; ts.forEachChild(n, visit); }; visit(node); return found; }
function logic(dir, file, name) { const { ast,node } = find(dir,file,name); const render = node.body.statements.find(hasJsx); return ast.text.slice(node.body.getStart(ast)+1, render ? render.getStart(ast) : node.body.end-1); }
// Authorized financial correctness changes are tested behaviorally against Decimal oracles.
// Normalize ONLY their exact seams here; all other baseline action text remains protected.
function financialBaseline(text) {
  const withOriginalSum = text
    .replace('sumMoneyExact(form.lines.map(line => lineTotal(line, form.tax_calculation_mode)))', 'form.lines.reduce((sum, line) => sum + lineTotal(line, form.tax_calculation_mode), 0)');
  if (!text.includes('The saved invoice tax mode could not be verified.') && !text.includes('tax_calculation_mode: invoice.tax_calculation_mode')) return withOriginalSum;
  return withOriginalSum
    .replace('    tax_calculation_mode: invoice.tax_calculation_mode === "inclusive" || invoice.tax_calculation_mode === "exclusive" ? invoice.tax_calculation_mode : "",\n', '')
    .replace('    if (form.tax_calculation_mode !== "exclusive" && form.tax_calculation_mode !== "inclusive") {\n      setError("The saved invoice tax mode could not be verified. Reload the invoice before saving; no tax mode will be guessed.");\n      return;\n    }\n', '')
    .replace('tax_calculation_mode: form.tax_calculation_mode,', 'tax_calculation_mode: "exclusive",');
}
// Approved identity/read-admission seams only. Literal replacements preserve every
// unrelated baseline statement; invoice-identity.test.cjs exercises the new behavior.
const identitySeams = [
  ['  const readSequence = useRef(0);\n  const readPending = useRef(false);\n  const [readFailed, setReadFailed] = useState(false);\n\n  function hasCurrentInvoice() {\n    return Boolean(invoice && invoice.id === invoiceId && !loading && !readPending.current && !readFailed);\n  }\n\n', '', 1],
  ['    const request = ++readSequence.current;\n    readPending.current = true;\n', '', 1],
  ['      if (request !== readSequence.current) return;\n', '', 2],
  ['      if (invoicePayload?.id !== invoiceId) throw new Error("Invoice identity could not be verified. Retry loading.");\n      if (!Array.isArray(paymentPayload)) throw new Error("Payment history could not be verified. Retry loading.");\n      const nextForm = toForm(invoicePayload);\n      setReadFailed(false);\n', '', 1],
  ['      setForm(nextForm);', '      setForm(toForm(invoicePayload));', 1],
  ['      setReadFailed(true);\n', '', 1],
  ['    } finally { if (request === readSequence.current) { readPending.current = false; setLoading(false); } }', '    } finally { setLoading(false); }', 1],
  ['  useEffect(() => { void load(); return () => { readSequence.current++; readPending.current = true; }; }, [load]);', '  useEffect(() => { void load(); }, [load]);', 1],
  ['    if (!hasCurrentInvoice()) return;\n', '', 5],
  ['    const paymentToReverse = payments.find(payment => payment.id === selectedPayment.id && payment.status === "confirmed");\n    if (!paymentToReverse) return;', '    const paymentToReverse = selectedPayment;', 1],
];
function identityBaseline(text) {
  for (const [approved, previous] of identitySeams) text = text.split(approved).join(previous);
  return text;
}
const approvedLifecycle = {
  draft: ['currentRead && invoice.status === "draft"', 'invoice.status === "draft"'],
  canCancelInvoice: ['currentRead && !["paid", "cancelled"].includes(invoice.status) && Number(invoice.amount_paid) === 0', '!["paid", "cancelled"].includes(invoice.status) && Number(invoice.amount_paid) === 0'],
  canCollectPayment: ['currentRead && !["draft", "cancelled", "paid"].includes(invoice.status) && Number(invoice.balance_due) > 0', '!["draft", "cancelled", "paid"].includes(invoice.status) && Number(invoice.balance_due) > 0'],
};
test('Approved invoice identity seams remain exact and bounded', () => {
  const source = read(root, files.detail);
  for (const [approved, , count] of identitySeams) assert.equal(source.split(approved).length - 1, count, approved);
  assert.ok(source.includes('const currentRead = invoice.id === invoiceId && !loading && !readFailed;'));
});
const approvedHelpers = {
  'src/components/invoices-workspace-v2.tsx:money': 'function money(value: string | number, currency: string) { return formatMoneyExact(value, currency); }',
  'src/components/invoices-workspace-v2.tsx:lineTotal': 'function lineTotal(line: Line, taxMode: string) { return salesLinePreview(line, taxMode)?.total ?? ""; }',
};
for (const [file,name] of [[files.list,'InvoicesWorkspaceV2'],[files.detail,'InvoiceDetailWorkspace'],[files.payment,'InvoicePaymentWorkspace'],[files.workspace,'InvoiceWorkspace']]) {
  test(`${name}: pre-render logic is unchanged except explicit verified financial corrections`,()=>assert.equal(financialBaseline(identityBaseline(logic(root,file,name))),logic(baseline,file,name)));
}
for (const [file,names] of [[files.list,['inferPaymentMethod','money','pretty','lineTotal','selectPaymentDestination','resetSource','clearFilters','updateLine','changeManualCurrency','selectLineSource','submit']],[files.detail,['money','apiError','toForm','saveDraft','sendInvoice','shareInvoice','cancelInvoice','reversePayment']],[files.payment,['money','apiError','methodLabel','inferMethod','toForm','selectDestination','changeMethod','savePaymentInstructions','printInvoice']]]) {
  for(const name of names) test(`${path.basename(file)} ${name}: action contract or exact approved money-helper delegation is retained`,()=>{const a=find(root,file,name),b=find(baseline,file,name);assert.equal(approvedHelpers[file+':'+name] ? a.node.getText(a.ast) : financialBaseline(identityBaseline(a.node.getText(a.ast))),approvedHelpers[file+':'+name] ?? b.node.getText(b.ast));});
}
for(const [file,names] of [[files.detail,['draft','canCancelInvoice','canCollectPayment','sourceLabel']],[files.payment,['hasPaymentInstructions','canEdit']]]) {
  test(`${path.basename(file)}: lifecycle, source and edit guards retain exact expressions`,()=>{
    for(const name of names){const a=find(root,file,name,ts.isVariableDeclaration),b=find(baseline,file,name,ts.isVariableDeclaration);const current=a.node.initializer.getText(a.ast), approved=file===files.detail?approvedLifecycle[name]:undefined;if(approved)assert.equal(current,approved[0],name+" exact admitted expression");assert.equal(approved?approved[1]:current,b.node.initializer.getText(b.ast),name);}
  });
}
test('Detail updates continue to remount the payment/client preview using revision key',()=>{
  const code=read(root,files.workspace);for(const token of ['onUpdated={refreshPreview}','key={`${invoiceId}:${revision}`}','invoiceId={invoiceId}'])assert.ok(code.includes(token),token);
});
test('Active list and detail routes retain the same workspace components and parameter handling',()=>{
  for(const file of ['src/app/dashboard/accounting/invoices/page.tsx','src/app/dashboard/accounting/invoices/[invoiceId]/page.tsx'])assert.equal(read(root,file),read(baseline,file),file);
});
test('Balance helpers and shared confirmation preserve baseline invoice content, disabled controls and callbacks',()=>{
  for(const file of ['src/lib/invoice-balance.ts','src/lib/company-options.ts','src/lib/api-error.ts'])assert.equal(read(root,file),read(baseline,file),file);
  // Controls v29 intentionally adds a viewport-capped scroll region and pending-focus
  // effect. Compare financial content and action semantics, not obsolete layout HTML.
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const load=(dir,callbacksOnly=false)=>{const evaluated={exports:{}};const code=ts.transpileModule(read(dir,'src/components/financial-confirmation-dialog.tsx'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const scopedRequire=name=>name==='react'&&callbacksOnly?{...React,useRef:()=>({current:null}),useEffect:()=>{}}:require(name);new Function('require','module','exports',code)(scopedRequire,evaluated,evaluated.exports);return evaluated.exports.FinancialConfirmationDialog;};
  const Current=load(root),Previous=load(baseline);
  const props={open:true,title:'Synthetic reversal',description:'Baseline compatibility only',details:[{label:'Amount',value:'BDT 25.00',emphasis:true},{label:'Reason',value:'Synthetic reason'}],warning:'Review before confirming',confirmLabel:'Reverse payment',onCancel(){},onConfirm(){}};
  const content=html=>html.replace(/<[^>]*>/g,'');
  const buttons=html=>[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([,attributes,body])=>({type:attributes.match(/\btype="([^"]*)"/)?.[1]??null,label:attributes.match(/\baria-label="([^"]*)"/)?.[1]??null,disabled:/\bdisabled(?:=|\s|$)/.test(attributes),content:content(body)}));
  for(const state of [{},{loading:true},{open:false}]){
    const current=renderToStaticMarkup(React.createElement(Current,{...props,...state})),previous=renderToStaticMarkup(React.createElement(Previous,{...props,...state}));
    assert.equal(content(current),content(previous),'every rendered financial label, value and warning remains exact');
    assert.deepEqual(buttons(current),buttons(previous),'button order, labels, type and disabled semantics remain exact');
    if(state.open===false){assert.equal(current,'');assert.equal(previous,'');}
    else{
      for(const markup of [current,previous]){assert.match(markup,/role="dialog"/);assert.match(markup,/aria-modal="true"/);assert.match(markup,/aria-labelledby="financial-confirmation-title"/);assert.match(markup,/id="financial-confirmation-title"/);}
      assert.match(current,/data-financial-confirmation-panel/);assert.match(current,/aria-label="Confirmation review details"/);
      assert.equal(buttons(current).length,3);assert.equal(buttons(current).every(button=>button.disabled),Boolean(state.loading));
    }
  }
  const runCallbacks=Component=>{const calls=[];const tree=Component({...props,onCancel:()=>calls.push('cancel'),onConfirm:()=>calls.push('confirm')});const controls=[];const walk=node=>{if(!node||typeof node!=='object')return;if(node.type==='button')controls.push(node);for(const child of React.Children.toArray(node.props?.children))walk(child);};walk(tree);assert.equal(controls.length,3);for(const button of controls)button.props.onClick();return calls;};
  assert.deepEqual(runCallbacks(load(root,true)),['cancel','cancel','confirm']);assert.deepEqual(runCallbacks(load(baseline,true)),['cancel','cancel','confirm']);
});
test('Invoice Stripe integrations and QR generation are not altered by the presentation slice',()=>{
  for(const file of ['src/components/invoice-stripe-sandbox-panel.tsx','src/components/invoice-stripe-live-panel.tsx','src/lib/qrcode-svg.js'])assert.equal(read(root,file),read(baseline,file),file);
  assert.equal(logic(root,files.payment,'LocalPaymentQr'),logic(baseline,files.payment,'LocalPaymentQr'));
});
test('All finance API and dedicated invoice print route files remain byte-identical',()=>{
  for(const folder of ['src/app/api/finance','src/app/print/invoices']){
    const previous=fs.readdirSync(path.join(baseline,folder),{recursive:true}).filter(p=>p.endsWith('.ts')||p.endsWith('.tsx')).sort();
    const current=fs.readdirSync(path.join(root,folder),{recursive:true}).filter(p=>p.endsWith('.ts')||p.endsWith('.tsx')).sort();assert.deepEqual(current,previous);
    for(const file of previous)assert.equal(read(root,folder+'/'+file),read(baseline,folder+'/'+file),file);
  }
});
test('Reversal confirmation retains its guard, pending state, cancel and confirm callbacks',()=>{
  const code=read(root,files.detail);for(const token of ['open={Boolean(selectedPayment && reversalReason.trim().length >= 3 && confirmingReversal)}','loading={reversing}','onCancel={() => setConfirmingReversal(false)}','onConfirm={() => void reversePayment()}'])assert.ok(code.includes(token),token);
});
test('Dedicated print links and client-preview anchor remain available',()=>{
  const detail=read(root,files.detail),payment=read(root,files.payment);
  assert.ok(detail.includes('href={`/print/invoices/${invoice.id}`}'));
  assert.ok(detail.includes('href="/dashboard/accounting/invoices"'));
  assert.ok(payment.includes('id="invoice-client-preview"'));
  assert.ok(payment.includes('onClick={printInvoice}'));
});
