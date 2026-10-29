const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./reconciliation-harness.cjs');
const { account, values, session, transaction, detail, clone } = require('./reconciliation-fixtures.cjs');
const m = sourceLoader().load('src/components/accounting-reconciliation/reconciliation-model.ts');
const meta = { accounts: [account] };
for (const [raw, expected] of [['1','1'],['+1.20','1.2'],['-1.20','-1.2'],['.5','0.5'],['-.5','-0.5'],['-0.00','-0'],['  -12.3400 ','-12.34'],['1e2','100'],['-1e-2','-0.01'],['+0.001e2','0.1']]) {
  test(`signed lexical amount preserves exact ${JSON.stringify(raw)}`, () => assert.equal(m.signedStatementAmount(raw), expected));
}
for (const raw of ['', ' ', '-+1', '--1', '+-1', '1,000', 'NaN', 'Infinity', '-Infinity', '0x10', '1e101']) {
  test(`signed lexical amount rejects ${JSON.stringify(raw)}`, () => assert.equal(m.signedStatementAmount(raw), null));
}
for (const raw of ['2024-02-29','2026-10-31','0001-01-01','9999-12-31']) test(`ISO date accepts ${raw}`, () => assert.equal(m.reconciliationDate(raw),true));
for (const raw of ['0000-01-01','2025-02-29','2026-02-30','2026-13-01','2026-00-01','2026-01-00','2026-1-01','2026-10-31T00:00:00Z','not-a-date']) test(`ISO date rejects ${raw}`, () => assert.equal(m.reconciliationDate(raw),false));
for (const [raw, expected] of [['0','0.00'],['0.004','0.00'],['0.005','0.01'],['-0.005','-0.01'],['1.005','1.01'],['-1.005','-1.01'],['9999999999999999.994','9999999999999999.99'],['-9999999999999999.994','-9999999999999999.99']]) {
  test(`statement HALF_UP preview ${raw} → ${expected}`, () => { const p=m.reconciliationPreview({...values,statement_ending_balance:raw},meta); assert.equal(p.error,null);assert.equal(p.roundedBalance,expected); });
}
for (const raw of ['9999999999999999.995','-9999999999999999.995','10000000000000000','-10000000000000000','1e99','-+1','NaN']) {
  test(`statement rejects invalid or Numeric(18,2)-overflow balance ${raw}`, () => assert.ok(m.reconciliationPreview({...values,statement_ending_balance:raw},meta).error));
}
test('creation requires verified meta and an account in that returned population',()=>{
  assert.ok(m.reconciliationPreview(values,null).error);
  assert.ok(m.reconciliationPreview(values,{accounts:[]}).error);
  assert.ok(m.reconciliationPreview({...values,account_id:'other'},meta).error);
});
test('statement end must follow the last finalized end; no browser-current-day assumption',()=>{
  assert.ok(m.reconciliationPreview({...values,statement_end_date:'2026-09-30'},meta).error);
  assert.ok(m.reconciliationPreview({...values,statement_end_date:'2026-09-29'},meta).error);
  assert.equal(m.reconciliationPreview({...values,statement_end_date:'2026-10-01'},meta).error,null);
});
test('original wire body preserves lexical signed input and notes; start date is not invented',()=>{
  const v={...values,statement_ending_balance:'-1.005',notes:'  keep these spaces  '};
  assert.deepEqual(JSON.parse(m.reconciliationCreateBody(v)),{account_id:account.id,statement_end_date:'2026-10-31',statement_ending_balance:'-1.005',notes:'  keep these spaces  '});
  assert.equal(JSON.parse(m.reconciliationCreateBody(values)).notes,null);
  assert.deepEqual(Object.keys(JSON.parse(m.reconciliationCreateBody(v))).sort(),['account_id','notes','statement_end_date','statement_ending_balance']);
});
test('known statement response validates exact balance identity without binary float arithmetic',()=>{
  assert.equal(m.isReconciliationSession(session),true);
  assert.equal(m.isReconciliationSession({...session,statement_ending_balance:'9999999999999999.99',cleared_book_balance:'9999999999999999.98',difference:'0.01'}),true);
  assert.equal(m.isReconciliationSession({...session,difference:'0.00'}),false);
});
for(const [field,value]of [['id','../other'],['id',''],['account_id',null],['currency','US'],['statement_ending_balance','1.001'],['cleared_book_balance','NaN'],['difference',null],['status','posted'],['matched_transactions',-1],['matched_transactions',1.2],['notes',{}],['finalized_at',4]]) {
 test(`statement read fails closed for malformed ${field}=${JSON.stringify(value)}`,()=>assert.equal(m.isReconciliationSession({...session,[field]:value}),false));
}
test('meta permits empty accounts but rejects malformed or duplicate identities',()=>{
  assert.equal(m.isReconciliationMeta({accounts:[]}),true);
  assert.equal(m.isReconciliationMeta(meta),true);
  assert.equal(m.isReconciliationMeta({accounts:[account,{...account}]}),false);
  assert.equal(m.isReconciliationMeta({accounts:[{...account,last_reconciled_date:'0000-01-01'}]}),false);
  assert.equal(m.isReconciliationMeta({accounts:[{...account,last_statement_balance:'1.001'}]}),false);
});
test('register accepts at most the real latest-200 bare-array contract',()=>{
  const rows=Array.from({length:200},(_,i)=>({...session,id:`synthetic-${i}`}));
  assert.equal(m.isReconciliationList(rows),true);
  assert.equal(m.isReconciliationList([...rows,{...session,id:'overflow'}]),false);
  assert.equal(m.isReconciliationList({items:rows,next_cursor:null}),false);
  assert.equal(m.isReconciliationList([session,session]),false);
});
test('transaction shape rejects negative/extra-precision/cross-contract amounts and nonboolean selection',()=>{
  assert.equal(m.isReconciliationTransaction(transaction),true);
  for(const patch of [{amount:'-1.00'},{amount:'0.001'},{direction:'incoming'},{selected:'false'},{transaction_date:'2026-02-30'},{id:'bad/id'},{reference:{}}])assert.equal(m.isReconciliationTransaction({...transaction,...patch}),false);
});
test('detail validates duplicate/currency/eligible-through-end and loaded unmatched count',()=>{
  assert.equal(m.isReconciliationDetail(detail),true);
  for(const patch of [{transactions:[transaction,transaction],unmatched_count:2},{transactions:[{...transaction,currency:'EUR'}]},{transactions:[{...transaction,transaction_date:'2026-11-01'}]},{unmatched_count:0}])assert.equal(m.isReconciliationDetail({...detail,...patch}),false);
});
test('detail does not equate all matched count with selected rows in the capped slice',()=>{
  assert.equal(m.isReconciliationDetail({...detail,matched_transactions:5000}),true);
  const rows=Array.from({length:2000},(_,i)=>({...transaction,id:`transaction-${i}`}));
  assert.equal(m.isReconciliationDetail({...detail,transactions:rows,unmatched_count:2000}),true);
  assert.equal(m.isReconciliationDetail({...detail,transactions:[...rows,{...transaction,id:'overflow'}],unmatched_count:2001}),false);
});
test('older unmatched transactions remain eligible; statement start is not a lower filter',()=>{
  assert.equal(m.isReconciliationDetail({...detail,transactions:[{...transaction,transaction_date:'2025-01-01'}]}),true);
});
test('created document matching checks account, currency, date, exact rounded amount and unchanged notes',()=>{
  const row={...session,statement_ending_balance:'125.00'};
  assert.equal(m.matchesCreatedReconciliation(row,values,account),true);
  for(const patch of [{account_id:'other'},{currency:'EUR'},{statement_end_date:'2026-10-30'},{statement_ending_balance:'125.01'},{notes:'other'}])assert.equal(m.matchesCreatedReconciliation({...row,...patch},values,account),false);
  assert.equal(m.matchesCreatedReconciliation({...row,status:'finalized'},values,account),true);
});
test('formatting keeps huge signed values exact and currencies explicit',()=>{
  assert.match(m.reconciliationMoney('-9999999999999999.99','USD'),/^USD -9[,\s]?999[,\s]?999[,\s]?999[,\s]?999[,\s]?999\.99$/);
  assert.equal(m.reconciliationMoney('25.00','USD').startsWith('USD '),true);
  assert.equal(m.reconciliationMoney('25.00','EUR').startsWith('EUR '),true);
});
test('local register filters never combine currencies or mutate original input',()=>{
  const rows=[session,{...session,id:'eur-row',account_id:'euro',account_name:'Euro account',currency:'EUR',status:'finalized'}],before=clone(rows);
  assert.deepEqual(m.reconciliationFiltered(rows,{search:'eur',status:'',account:'',page:1,focus:''}).map(x=>x.id),['eur-row']);
  assert.equal(m.reconciliationFiltered(rows,{search:'',status:'draft',account:'euro',page:1,focus:''}).length,0);
  assert.deepEqual(rows,before);
});
test('local transaction search/filter applies only to the supplied loaded rows',()=>{
  const rows=[transaction,{...transaction,id:'matched',selected:true,reference:'ABC'}];
  assert.deepEqual(m.reconciliationTransactions(rows,{search:'abc',filter:'matched',page:1}).map(x=>x.id),['matched']);
  assert.equal(m.reconciliationTransactions(rows,{search:'abc',filter:'unmatched',page:1}).length,0);
});
test('local pages are bounded by actual filtered rows, not invented cursors or totals',()=>{
  const rows=Array.from({length:200},(_,i)=>i),p=m.reconciliationPage(rows,999);
  assert.deepEqual(p,{rows:rows.slice(180),page:10,pages:10,filteredCount:200});
  assert.deepEqual(m.reconciliationPage([],10),{rows:[],page:1,pages:1,filteredCount:0});
  assert.equal(m.reconciliationPage([1,2],1).rows.length,2);
});
