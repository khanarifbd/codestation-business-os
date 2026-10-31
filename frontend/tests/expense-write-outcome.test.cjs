const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {harness,ok,fail,root}=require('./expense-harness.cjs');
const {account,category,meta,expense,receipt}=require('./expense-fixtures.cjs');
const writes=h=>h.calls.filter(c=>c.init?.method);
const cases={timeout:()=>fail(408),conflict:()=>fail(409),unreadable:()=>({ok:false,status:422,json:async()=>{throw Error('synthetic invalid JSON');}}),malformed:()=>({ok:false,status:422,json:async()=>({detail:{unexpected:true}})}),blank:()=>({ok:false,status:422,json:async()=>({detail:[{loc:['body','amount'],msg:' '}]})})};
const read=u=>u.includes('expense-meta')?ok(meta):u==='/api/finance/accounts'?ok([account]):ok({...expense,documents:[receipt]});
async function prepare(kind){
 let options;
 if(kind==='receipt')options={file:'src/hooks/use-expense-receipt.ts',target:'useExpenseReceipt',args:[expense.id,'/dashboard/expenses']};
 else if(['void','delete'].includes(kind))options={file:'src/hooks/use-expense-document.ts',target:'useExpenseDocumentActions',args:[{...expense,documents:[receipt]},true,async()=>({...expense,documents:[receipt]})]};
 else if(kind!=='posting'){const [type,entity]=kind.split(':');options={file:'src/hooks/use-expense-setup.ts',target:type==='create'?'useExpenseSetupCreate':'useExpenseSetupStatus',args:type==='create'?[entity,'/dashboard/expenses']:[entity,'synthetic-record',true,true,async()=>meta]};}
 const h=harness(options);h.respond(read);
 if(kind==='posting'){let v=h.render();await Promise.all([v.metadata.refresh(),v.accounts.refresh()]);v=h.render();for(const [k,value]of Object.entries({description:expense.description,category_id:category.id,account_id:account.id,expense_amount:'25.00',tax_amount:'2'}))v.change(k,value);}
 else if(kind==='receipt'){await h.render().resource.refresh();h.render().changeFile(new File(['synthetic'],'synthetic-audit.txt'));}
 else if(kind.startsWith('create:'))h.render().change('name','Synthetic setup');
 return h;
}
async function act(h,kind){if(kind==='posting'){h.render().review();await h.render().postExpense();}else if(kind==='receipt')await h.render().upload();else if(kind.startsWith('create:'))await h.render().save();else{h.render().review(kind,receipt.id);await h.render().confirm();}}
test('definite rejection requires nonblank structured application error and excludes ambiguous statuses',()=>{const h=harness();try{const {isDefiniteExpenseRejection:valid}=h.load(path.join(root,'src/components/expenses/expense-write-outcome.ts'));for(const status of [200,302,408,409,500])assert.equal(valid(status,{detail:'Denied'}),false);for(const body of [null,[],{},'error',{detail:''},{detail:[{loc:['body'],msg:' '}]},{message:5}])assert.equal(valid(422,body),false);for(const body of [{detail:'Denied'},{detail:[{loc:['body','name'],msg:'Required'}]},{detail:{message:'Invalid'}},{message:'Invalid'}])for(const status of [400,403,422])assert.equal(valid(status,body),true);}finally{h.cleanup();}});
for(const kind of ['posting','receipt','create:vendors','create:categories','status:vendors','status:categories','void','delete'])for(const [label,response]of Object.entries(cases))test(`${kind} ${label}: ambiguous write stays guarded, only original keyed posting can retry`,async()=>{const h=await prepare(kind);try{h.respond((u,i)=>i?.method?response():read(u));await act(h,kind);assert.equal(h.render().phase,'uncertain');const first=writes(h)[0];assert.ok(first);
 if(kind==='posting'){h.render().change('expense_amount','99');assert.equal(h.render().values.expense_amount,'25.00');h.respond((u,i)=>i?.method?fail(422):read(u));await act(h,kind);assert.equal(h.render().phase,'uncertain');assert.equal(writes(h).length,2);assert.equal(writes(h)[1].init.body,first.init.body);assert.equal(writes(h)[1].init.headers['Idempotency-Key'],first.init.headers['Idempotency-Key']);}
 else{if(h.render().recheck)await h.render().recheck();if(kind==='receipt')await h.render().resource.refresh();await act(h,kind);assert.equal(h.render().phase,'uncertain');assert.equal(writes(h).length,1);}
 }finally{h.cleanup();}});
for(const kind of ['posting','receipt','create:vendors','create:categories','status:vendors','status:categories','void','delete'])for(const status of [403,422])test(`${kind} readable ${status}: first definite denial stays correctable after explicit review`,async()=>{const h=await prepare(kind);try{h.respond((u,i)=>i?.method?fail(status):read(u));await act(h,kind);assert.equal(h.render().phase,'idle');assert.equal(writes(h).length,1);await act(h,kind);assert.equal(h.render().phase,'idle');assert.equal(writes(h).length,2);}finally{h.cleanup();}});
