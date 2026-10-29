const { harness, ok, fail, settle, nodes, text, expand, root } = require('./accounting-money-out-harness.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const bank = { id:'independent-bank', name:'Synthetic bank', account_type:'bank', currency:'USD', current_balance:'1000000000000.00', is_active:true };
const foreign = { ...bank, id:'independent-eur', name:'Synthetic EUR account', currency:'EUR' };
const meta = { accounts:[bank,foreign], categories:[{id:'category',name:'Synthetic cost',cost_type:'operating',is_active:true}], vendors:[{id:'vendor',name:'Synthetic vendor',is_active:true}], clients:[{id:'client',code:'SYN-C',name:'Synthetic client',currency:'USD'}], projects:[{id:'project',number:'SYN-P',name:'Synthetic project',order_id:'order',client_id:'client',client_name:'Synthetic client',currency:'USD',status:'active'}] };
const receipt = { id:'independent-expense', expense_number:'SYN-EXP-INDEPENDENT', description:'Synthetic cost',expense_date:'2026-10-26',category_id:'category',category_name:'Synthetic cost',cost_type:'operating',vendor_id:null,vendor_name:null,account_id:bank.id,account_name:bank.name,client_id:null,client_name:null,project_id:null,project_name:null,project_number:null,order_id:null,order_number:null,invoice_id:null,invoice_number:null,payment_id:null,payment_number:null,expense_currency:'USD',expense_amount:'110.00',account_currency:'USD',account_amount:'110.00',exchange_rate:'1.00000000',profitability_currency:'USD',profitability_amount:'110.00',profitability_exchange_rate:'1.00000000',tax_amount:'10.00',payment_method:'bank_transfer',reference:'SYN-REF',notes:'Synthetic note',status:'posted',voided_at:null,document_count:0,documents:[],created_at:'2026-10-26T00:00:00Z' };
const posts = h => h.calls.filter(call => call.init?.method === 'POST');
function respond(url, init) {
  if(init?.method) return ok(clone(receipt));
  if(url === '/api/finance/expense-meta') return ok(clone(meta));
  if(url === '/api/finance/accounts') return ok(clone([bank,foreign]));
  if(url.startsWith('/api/finance/expenses/')) return ok({...clone(receipt),id:decodeURIComponent(url.split('/').at(-1))});
  if(url.startsWith('/api/finance/expenses?')) return ok({items:[clone(receipt)],next_cursor:null});
  return fail(404);
}
async function ready(h, purpose='company') {
  h.mode('create'); h.query('purpose='+purpose); h.respond(respond);
  await h.render().loadSetup(); let vm=h.render();
  for(const [key,value] of Object.entries({account_id:bank.id,category_id:'category',expense_amount:'110.00',tax_amount:'10.00',expense_date:'2026-10-26',description:'Synthetic cost',reference:'SYN-REF',notes:'Synthetic note',...(purpose==='project'?{project_id:'project'}:purpose==='client'?{client_id:'client'}:{})})) vm.change(key,value);
  return h.render();
}
function confirmation(h) { h.render().review(); return h.render(); }
module.exports={harness,ok,fail,settle,nodes,text,expand,root,clone,bank,foreign,meta,receipt,posts,respond,ready,confirmation};
