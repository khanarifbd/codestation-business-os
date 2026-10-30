const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {harness,createReady,reviewReady,writes,fail,deferred,tick}=require('./hr-time-harness.cjs');
const root=path.resolve(__dirname,'..'),proxySource=fs.readFileSync(path.join(root,'src/app/api/hr/[...path]/route.ts'),'utf8');
// Execute actual Next proxy source and pass its actual response shape into the hook.
async function proxy(status,body,{unreadable=false,method='POST'}={}){
 class Reply{constructor(body,init={}){this.body=body;this.status=init.status;this.ok=this.status>=200&&this.status<300;}static json(body,init){return new Reply(body,init);}async json(){return this.body;}}
 const routeModule={exports:{}},calls=[];
 const dependencies=name=>{if(name==='next/server')return{NextResponse:Reply};if(name==='@/lib/auth-session')return{setAuthCookies:()=>{throw Error('No rotation expected');}};if(name==='@/lib/authenticated-backend')return{authenticatedBackendFetch:async(_req,url,init)=>{calls.push({url,init});return{upstream:{status,json:async()=>{if(unreadable)throw Error('Synthetic body read failure');return body;}}};}};throw Error(name);};
 vm.runInNewContext(ts.transpileModule(proxySource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:routeModule,exports:routeModule.exports,require:dependencies});
 const suffix=method==='PATCH'?['leave-requests','leave-A']:['attendance'];
 const response=await routeModule.exports[method]({cookies:{get:()=>({value:'company-A'})},nextUrl:{search:''},text:async()=>JSON.stringify(method==='PATCH'?{status:'approved',expected_status:'pending'}:{employee_id:'employee-A'})},{params:Promise.resolve({path:suffix})});
 assert.equal(calls.length,1);assert.equal(calls[0].init.headers['X-Organization-ID'],'company-A');assert.equal(calls[0].init.method,method);assert.equal(calls[0].url,'/hr/'+suffix.join('/'));return response;
}
const badBodies=[null,{},[],{detail:''},{detail:'  '},{detail:[]},{detail:[{}]},{detail:[{loc:['body'],msg:'bad'}]}];
for(const mode of ['attendance','leave'])for(const status of [400,409,422])for(const body of badBodies)test(`actual HR proxy ${mode} malformed${status} ${JSON.stringify(body)} stays frozen`,async()=>{
 const h=harness({path:mode==='attendance'?'/dashboard/hr/time/attendance/new':'/dashboard/hr/time/leave/leave-A/review'});try{
  if(mode==='attendance')await createReady(h);else await reviewReady(h);
  h.respond((_url,init)=>init?.method?proxy(status,body,{method:init.method}):fail(503));
  if(mode==='attendance')await h.vm().submitAttendance();else await h.vm().action.confirm();await h.flush();assert.equal(h.vm().action.phase,'unknown');assert.equal(h.vm().action.canEdit(),false);
  await h.vm().refresh();await h.flush();if(mode==='attendance')await h.vm().submitAttendance();else {h.vm().choose('rejected');h.vm().reviewLeave();await h.vm().action.confirm();}assert.equal(writes(h).length,1);assert.equal(h.vm().action.phase,'unknown');
 }finally{h.cleanup();}
});
for(const status of [400,409,422])test(`actual HR proxy unreadable${status} preserves null and remains unknown`,async()=>{
 const response=await proxy(status,undefined,{unreadable:true});assert.equal(await response.json(),null);const h=harness({path:'/dashboard/hr/time/attendance/new'});try{await createReady(h);h.respond(()=>response);await h.vm().submitAttendance();await h.flush();assert.equal(h.vm().action.phase,'unknown');await h.vm().submitAttendance();assert.equal(writes(h).length,1);}finally{h.cleanup();}
});
for(const [status,body] of [[400,{detail:'Invalid employee'}],[409,{detail:'Attendance already exists for this employee and date'}],[422,{detail:[{loc:['body','work_minutes'],msg:'Input should be greater than or equal to 0',type:'greater_than_equal',ctx:{ge:0}}]}]])test(`actual proxy valid${status} permits deliberate correction without automatic resend`,async()=>{
 const h=harness({path:'/dashboard/hr/time/attendance/new'});try{await createReady(h);h.respond(()=>proxy(status,body));await h.vm().submitAttendance();await h.flush();assert.equal(h.vm().action.phase,'rejected');assert.equal(h.vm().action.canEdit(),true);assert.equal(writes(h).length,1);}finally{h.cleanup();}
});
test('verified leave409 invalidates review receipt while preserving expected_status body',async()=>{
 const h=harness({path:'/dashboard/hr/time/leave/leave-A/review'});try{await reviewReady(h);h.respond(()=>proxy(409,{detail:'Leave request status changed; reload before reviewing'},{method:'PATCH'}));await h.vm().action.confirm();await h.flush();assert.equal(h.vm().action.phase,'rejected');assert.equal(h.vm().canReview,false);assert.deepEqual(JSON.parse(writes(h)[0].init.body),{status:'approved',expected_status:'pending'});assert.equal(writes(h).length,1);}finally{h.cleanup();}
});
for(const transition of ['unmount','company','permission'])test(`late malformed body after ${transition} cannot set outcome or redirect replacement`,async()=>{
 const h=harness({path:'/dashboard/hr/time/attendance/new'});try{await createReady(h);const body=deferred();h.respond(()=>({status:422,ok:false,json:()=>body.promise}));const pending=h.vm().submitAttendance();await tick();if(transition==='unmount')h.layoutUnmount();else if(transition==='company'){h.company('company-B');h.render();}else{h.caps({can_manage:false});h.render();}body.resolve(null);await pending;await h.flush();assert.equal(h.nav.length,0);assert.equal(writes(h).length,1);if(transition!=='unmount')assert.equal(h.vm().action.phase,'idle');}finally{h.cleanup();}
});
for(const status of [408,429,500,502,503])test(`actual proxy readable${status} is still ambiguous, never corrective`,async()=>{
 const h=harness({path:'/dashboard/hr/time/attendance/new'});try{await createReady(h);h.respond(()=>proxy(status,{detail:'Synthetic gateway message'}));await h.vm().submitAttendance();await h.flush();assert.equal(h.vm().action.phase,'unknown');await h.vm().submitAttendance();assert.equal(writes(h).length,1);}finally{h.cleanup();}
});
test('rejection classifier negative mutation cannot downgrade malformed error bodies to known rejection',()=>{
 const text=fs.readFileSync(path.join(root,'src/components/hr-time/hr-time-model.ts'),'utf8'),ast=ts.createSourceFile('model.ts',text,ts.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='knownTimeRejection').getText(ast);
 const evaluate=code=>{const context={record:v=>!!v&&typeof v==='object'&&!Array.isArray(v)};vm.runInNewContext(ts.transpileModule(code.replace('export function','function')+';globalThis.classify=knownTimeRejection',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context.classify;};
 const prove=classify=>{for(const status of [400,401,403,404,409,422]){assert.equal(classify(status,null),false);assert.equal(classify(status,{detail:''}),false);assert.equal(classify(status,{detail:'Actual structured rejection'}),true);}assert.equal(classify(422,{detail:[{}]}),false);assert.equal(classify(422,{detail:[{loc:['body','date'],msg:'Invalid date',type:'date_parsing'}]}),true);assert.equal(classify(408,{detail:'Gateway message'}),false);};
 prove(evaluate(fn));assert.throws(()=>prove(evaluate('function knownTimeRejection(status,body){return [400,401,403,404,409,422].includes(status);}')));
});
