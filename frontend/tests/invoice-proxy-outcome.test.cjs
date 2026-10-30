/** Actual finance proxy -> actual invoice component closures; synthetic transport only. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
// Reuse the existing source-transpilation harness without registering its suite twice.
const harnessFile=path.join(__dirname,'invoice-handlers.test.cjs');
const harnessSource=fs.readFileSync(harnessFile,'utf8');
const harnessModule=new Module(harnessFile,module);harnessModule.filename=harnessFile;harnessModule.paths=module.paths;
harnessModule._compile(harnessSource.slice(0,harnessSource.indexOf('\nwithCase('))+'\nmodule.exports={harness,prepareCreate,readyDetail,preparePaymentEdit,submitEvent};',harnessFile);
const {harness,prepareCreate,readyDetail,preparePaymentEdit,submitEvent}=harnessModule.exports;
async function proxy(url,init,status,unreadable){
 const filename=path.join(root,'src/app/api/finance/[[...path]]/route.ts'),compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=module.paths;let forwarded=0;
 compiled.require=id=>({'next/server':{NextResponse:{json:(payload,options)=>({ok:options.status>=200&&options.status<300,status:options.status,json:async()=>payload})}},'@/lib/auth-session':{setAuthCookies:()=>{throw Error('Unexpected synthetic auth rotation');}},'@/lib/authenticated-backend':{authenticatedBackendFetch:async(_request,target,actual)=>{forwarded++;assert.equal(target,url.replace(/^\/api/,''));assert.equal(actual.body,init.body);return{upstream:{status,json:async()=>{if(unreadable)throw Error('Synthetic unreadable upstream');return{detail:'Synthetic definite validation rejection'};}},rotatedTokens:null};}}}[id]??require(id));
 compiled._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filename);
 const response=await compiled.exports[init.method]({cookies:{get:name=>name==='organization_id'?{value:'synthetic-org'}:undefined},headers:new Headers(init.headers),text:async()=>init.body,nextUrl:{search:''}},{params:Promise.resolve({path:url.split('/').slice(3)})});assert.equal(response.status,status);assert.equal(forwarded,1);return response;
}
async function prepare(kind){const h=harness(kind);if(kind==='list')await prepareCreate(h);else if(kind==='detail')readyDetail(h);else preparePaymentEdit(h);return h;}
async function write(h,kind){if(kind==='list')await h.handlers().submit(submitEvent);else if(kind==='detail')await h.handlers().sendInvoice();else await h.handlers().savePaymentInstructions();}
function unknown(h,kind){return kind==='list'?h.state('unknownCreate'):kind==='detail'?h.state('writeOutcome')==='unknown':h.state('blocked');}
for(const kind of ['list','detail','payment'])for(const status of [400,403,422,408,409])test(`${kind}: actual proxy unreadable ${status} retains unknown lock without another mutation`,async()=>{const h=await prepare(kind);try{h.setResponse((url,init)=>proxy(url,init,status,true));await write(h,kind);h.render();assert.equal(unknown(h,kind),true);await write(h,kind);assert.equal(h.requests.filter(r=>r.options?.method).length,1);}finally{h.cleanup();}});
for(const kind of ['list','detail','payment'])for(const status of [400,403,422])test(`${kind}: real readable ${status} through proxy remains correctable`,async()=>{const h=await prepare(kind);try{h.setResponse((url,init)=>proxy(url,init,status,false));await write(h,kind);h.render();assert.equal(unknown(h,kind),false);await write(h,kind);assert.equal(h.requests.filter(r=>r.options?.method).length,2);}finally{h.cleanup();}});
for(const kind of ['list','detail','payment'])test(`${kind}: proxy unreadable 2xx still acknowledges and cannot repeat original write`,async()=>{const h=await prepare(kind);try{h.setResponse((url,init)=>init?.method?proxy(url,init,201,true):Promise.reject(Error('Synthetic readback unavailable')));await write(h,kind);h.render();await write(h,kind);assert.equal(h.requests.filter(r=>r.options?.method).length,1);assert.equal(unknown(h,kind),false);}finally{h.cleanup();}});
test('Invoice proxy baseline adapter is exact and rejects removed or inverted ambiguity predicate',()=>{
 const {beforeReviewedInvoiceBoundaries}=require('./helpers/reviewed-invoice-boundaries.cjs');
 const edits=require('./helpers/reviewed-invoice-proxy.json');
 for(const [file,hunks]of Object.entries(edits)){const source=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotThrow(()=>beforeReviewedInvoiceBoundaries(file,source));for(const hunk of hunks){assert.throws(()=>beforeReviewedInvoiceBoundaries(file,source.replace(hunk.after,hunk.before)),/Exact reviewed invoice proxy seam/);assert.throws(()=>beforeReviewedInvoiceBoundaries(file,source.replace(hunk.after,hunk.after.replace('!== "Unexpected upstream response"','=== "Unexpected upstream response"'))),/Exact reviewed invoice proxy seam/);}}
});
test('Manual invoice create cannot retry after actual proxy hides unreadable422',async()=>{
 const h=await prepare('list');try{
  h.setState('source','client');h.setState('form',{...h.state('form'),client_id:'synthetic-client',currency:'GBP',lines:[{product_id:null,item_name:'Synthetic service',item_type:'service',unit:'unit',description:'Synthetic',quantity:'1',unit_price:'10',discount_percent:'0',tax_rate:'0'}]});h.render();
  h.setResponse((url,init)=>proxy(url,init,422,true));await write(h,'list');h.render();await write(h,'list');assert.equal(unknown(h,'list'),true);assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/finance/invoices');assert.equal(JSON.parse(h.requests[0].options.body).items[0].unit_price,10);
 }finally{h.cleanup();}
});
