const test=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./reconciliation-harness.cjs');
const n=sourceLoader().load('src/lib/reconciliation-navigation.ts');
const root='/dashboard/accounting/reconciliation';
test('browse defaults have no eager detail or matching selection',()=>assert.deepEqual(n.reconciliationBrowse(''),{search:'',status:'',account:'',page:1,focus:''}));
for(const value of ['0','-1','1.5','NaN','Infinity','9007199254740992'])test(`invalid page ${value} returns to local page one`,()=>assert.equal(n.reconciliationBrowse('page='+value).page,1));
test('browse limits input lengths and accepts only known status filters',()=>{
 const b=n.reconciliationBrowse(new URLSearchParams({search:'x'.repeat(400),status:'cancelled',account:'a'.repeat(250),page:'2',focus:'f'.repeat(250)}));
 assert.equal(b.search.length,300);assert.equal(b.account.length,200);assert.equal(b.focus.length,200);assert.equal(b.status,'');assert.equal(b.page,2);
});
test('browse URL roundtrip preserves local filters/page/focus',()=>{
 const b={search:'bank / EUR & tax',status:'finalized',account:'synthetic-bank',page:3,focus:'synthetic-row'};
 const href=n.reconciliationListHref(b);assert.ok(href.startsWith(root+'?'));assert.deepEqual(n.reconciliationBrowse(href.split('?')[1]),b);
});
for(const value of ['https://evil.invalid/','//evil.invalid/','javascript:alert(1)','/dashboard/accounting/reconciliation/new','/dashboard/accounting/reconciliation-evil','/dashboard/accounting/reconciliation/../accounts','/dashboard/accounting/reconciliation%3fsearch=x','/dashboard/accounting/reconciliation#frag'])test(`return route rejects ${value}`,()=>assert.equal(n.safeReconciliationReturn(value),root));
test('safe return preserves browse context but drops nested routes and unknown fields',()=>{
 const safe=n.safeReconciliationReturn(root+'?search=receipt&status=draft&page=2&returnTo=https%3A%2F%2Fevil.invalid&task=other');
 const url=new URL(safe,'https://synthetic.invalid');assert.equal(url.pathname,root);assert.equal(url.searchParams.get('search'),'receipt');assert.equal(url.searchParams.get('page'),'2');assert.equal(url.searchParams.has('returnTo'),false);assert.equal(url.searchParams.has('task'),false);
});
test('create opens only dedicated native workspace with sanitized browse return',()=>{
 const href=n.reconciliationCreateHref(root+'?status=draft');assert.equal(new URL(href,'https://synthetic.invalid').pathname,root+'/new');assert.equal(new URL(href,'https://synthetic.invalid').searchParams.get('returnTo'),root+'?status=draft');
});
test('view and matching routes remain distinct and preserve transaction browse context',()=>{
 const selection={search:'older credit',filter:'unmatched',page:4};
 for(const matching of [false,true]){const href=n.reconciliationDocumentHref('synthetic-row',root+'?page=2',matching,selection),url=new URL(href,'https://synthetic.invalid');assert.equal(url.pathname,root+'/synthetic-row'+(matching?'/match':''));assert.equal(url.searchParams.get('returnTo'),root+'?page=2');assert.deepEqual(n.reconciliationSelection(url.searchParams),selection);}
});
test('transaction filters are local, bounded and explicit',()=>{
 assert.deepEqual(n.reconciliationSelection('txSearch=credit&filter=matched&txPage=3'),{search:'credit',filter:'matched',page:3});assert.deepEqual(n.reconciliationSelection('txSearch=&filter=sent&txPage=-1'),{search:'',filter:'all',page:1});assert.equal(n.reconciliationSelection('txSearch='+('x'.repeat(400))).search.length,300);
});
