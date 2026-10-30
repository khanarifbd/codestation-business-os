const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'e2e/qc-owner-masterdata.spec.mjs'),'utf8');
function unchangedHash(s){s=s.replace("Complete all order items with valid quantities, prices and percentages (up to four decimal places).","Complete all order items.");const start=s.indexOf('    // Native max=100'),end=s.indexOf("    await page.getByLabel('Probability %'",start);assert.ok(start>=0&&end>start);s=s.slice(0,start)+s.slice(end);s=s.replace("getByText('USD 200.00',","getByText('USD 200',");const tree=ts.createSourceFile('spec.js',s,ts.ScriptTarget.Latest,true),out=[];function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(tree).startsWith('expect('))out.push(n.getText(tree));ts.forEachChild(n,visit);}visit(tree);assert.equal(out.length,175);return crypto.createHash('sha256').update(JSON.stringify(out.sort())).digest('hex');}
test('masterdata retains all175 assertions with only reviewed currency and order-message adaptations',()=>{assert.equal(unchangedHash(source),'e4720d95fe9e2d59ddd2274cdce2296cd86e4d57ae42f9dd60db3a76dba6c6b3');assert.notEqual(unchangedHash(source.replace('.toBe(125)','.toBe(0)')),'e4720d95fe9e2d59ddd2274cdce2296cd86e4d57ae42f9dd60db3a76dba6c6b3');});
function validationGuard(s){for(const seam of ['el.validity.rangeOverflow','el.validationMessage.length > 0','await expect(probability).toBeFocused()','expect(invalidUiPosts).toBe(0)',"page.off('request', countInvalidCreate)","context.request.post('/api/crm/leads'",'probability_percent: 101','expect(invalid.status()).toBe(422)',"expect(typeof invalidBody.detail).toBe('string')","expect(invalidBody.detail).toMatch(/Probability Percent:.*less than or equal to 100\\b/i)",'Array.isArray(invalidBody.validation_errors)','invalidBody.validation_errors.some',"issue.loc.includes('probability_percent') && issue.type === 'less_than_equal' && issue.ctx?.le === 100", "'/api/crm/leads', undefined, 'get')).items).toHaveLength(0)","getByText('USD 200.00'"])assert.ok(s.includes(seam),seam);}
test('native and independent backend guards cannot be weakened',()=>{validationGuard(source);for(const seam of ['el.validity.rangeOverflow','expect(invalidUiPosts).toBe(0)','expect(invalid.status()).toBe(422)',"expect(typeof invalidBody.detail).toBe('string')","expect(invalidBody.detail).toMatch(/Probability Percent:.*less than or equal to 100\\b/i)",'Array.isArray(invalidBody.validation_errors)','invalidBody.validation_errors.some',"issue.type === 'less_than_equal'","getByText('USD 200.00'"])assert.throws(()=>validationGuard(source.replace(seam,'REMOVED')));const page=fs.readFileSync(path.join(root,'src/app/dashboard/crm/page.tsx'),'utf8');assert.match(page,/<Field label="Probability %"[^>]*min=\{0\}[^>]*max=\{100\}/);assert.ok(page.includes('formatMoneyExact(value, currency'));const backend=fs.readFileSync(path.join(root,'../backend/app/schemas/crm.py'),'utf8');assert.ok(backend.includes('probability_percent: int = Field(default=0, ge=0, le=100)'));});
test('same masterdata authentication and budgets, no disabled tests or retries',()=>{assert.equal((source.match(/\btest\('/g)||[]).length,5);assert.equal((source.match(/await setup\(page, context,/g)||[]).length,5);assert.deepEqual([...source.matchAll(/test\.setTimeout\((\d+)\)/g)].map(m=>m[1]),['240000','300000','240000','180000','180000']);assert.doesNotMatch(source,/test\.(?:skip|fixme)|retries\s*:/);});
test('masterdata fixture password is supplied only and fails closed',()=>{const block=source.slice(source.indexOf('const password ='),source.indexOf('const today ='));assert.match(block,/const password = process\.env\.E2E_PASSWORD;/);assert.doesNotMatch(block,/\?\?|\|\|/);for(const value of [undefined,'','  '])assert.throws(()=>vm.runInNewContext(block,{process:{env:{E2E_PASSWORD:value}}}),/must be supplied/);assert.doesNotThrow(()=>vm.runInNewContext(block,{process:{env:{E2E_PASSWORD:'synthetic-runtime-only'}}}));});

const routeSource=fs.readFileSync(path.join(root,'src/app/api/crm/[[...path]]/route.ts'),'utf8');
async function invokeActualProxy(routeText,status=422){
  const issue={loc:['body','probability_percent'],msg:'Input should be less than or equal to 100',type:'less_than_equal',input:101,ctx:{le:100}};
  const original={detail:[issue]},calls=[];
  class Response {constructor(body,init={}){this.body=body;this.status=init.status;}static json(body,init){return new Response(body,init);}}
  const routeModule={exports:{}};
  const requireMock=name=>{
    if(name==='next/server')return{NextResponse:Response};
    if(name==='@/lib/auth-session')return{setAuthCookies:()=>{throw Error('Unexpected cookie rotation');}};
    if(name==='@/lib/authenticated-backend')return{authenticatedBackendFetch:async(request,path,init)=>{calls.push({path,init});return{upstream:{status,json:async()=>original}};}};
    throw Error(`Unexpected dependency ${name}`);
  };
  const js=ts.transpileModule(routeText,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{module:routeModule,exports:routeModule.exports,require:requireMock});
  const request={cookies:{get:name=>name==='organization_id'?{value:'synthetic-tenant'}:undefined},headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({probability_percent:101})};
  const response=await routeModule.exports.POST(request,{params:Promise.resolve({path:['leads']})});
  assert.equal(calls.length,1);assert.equal(calls[0].path,'/crm/leads');assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers['X-Organization-ID'],'synthetic-tenant');
  return{response,issue,original};
}
function assertValidationShape({response,issue}){
  assert.equal(response.status,422);
  assert.equal(typeof response.body.detail,'string');
  assert.match(response.body.detail,/Probability Percent:.*less than or equal to 100\b/i);
  assert.ok(Array.isArray(response.body.validation_errors));
  assert.deepEqual(response.body.validation_errors,[issue]);
}
test('actual CRM POST proxy normalizes422 readable detail and preserves complete backend validation metadata',async()=>{
  assertValidationShape(await invokeActualProxy(routeSource));
  const unchanged=await invokeActualProxy(routeSource,400);assert.equal(unchanged.response.body,unchanged.original);assert.equal(unchanged.response.status,400);
});
test('proxy contract guard rejects dropped normalization, missing metadata and wrong validation bound',async()=>{
  for(const [from,to] of [
    ['upstream.status === 422 ? normalizeErrorPayload(upstreamPayload) : upstreamPayload','upstreamPayload'],
    ['validation_errors: source.detail','validation_errors: undefined'],
    ['return `${field}: ${message}`;','return `${field}: Input should be less than or equal to 1000`;'],
  ]){assert.ok(routeSource.includes(from));await assert.rejects(async()=>assertValidationShape(await invokeActualProxy(routeSource.replace(from,to))));}
});

test('order blank-line message matches exact four-place validation without weakening rejection',()=>{const message="Complete all order items with valid quantities, prices and percentages (up to four decimal places).";assert.equal(source.split(message).length,2);const page=fs.readFileSync(path.join(root,'src/app/dashboard/orders/new/page.tsx'),'utf8');assert.ok(page.includes('setError("'+message+'");'));assert.ok(source.includes("expect(Number(order.total)).toBe(54)"));assert.notEqual(unchangedHash(source.replace(message,'Wrong validation')),'e4720d95fe9e2d59ddd2274cdce2296cd86e4d57ae42f9dd60db3a76dba6c6b3');});
