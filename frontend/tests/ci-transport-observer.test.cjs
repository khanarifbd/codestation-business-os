const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dc=require('node:diagnostics_channel');
const {spawnSync}=require('node:child_process');
const observer=require('../scripts/ci-transport-observer.cjs');
const script=path.resolve(__dirname,'../scripts/ci-transport-observer.cjs');
function directory(){return fs.mkdtempSync(path.join(os.tmpdir(),'transport-test-'));}
test('paths never retain query, tokens, arbitrary names, encoded segments or userinfo',()=>{
 for(const value of ['/api/clients/PrivateName?token=SECRET#SECRET','http://user:SECRET@localhost/api/clients/name@example.test','/api/%74enant/secret-token-value','/api/clients/123/550e8400-e29b-41d4-a716-446655440000']) {
  const result=observer.safePath(value);assert(!/SECRET|PrivateName|example|secret-token|123|550e|%/.test(result));assert(result.startsWith('/api/'));
 }
 assert.equal(observer.safePath('/api/accounting/tax/codes?password=PRIVATE'),'/api/accounting/tax/codes');
 assert.equal(observer.safePath(null),'/:unknown');
 assert.equal(observer.errorCode({code:'ECONNRESET',message:'SECRET'}),'ECONNRESET');
 assert.equal(observer.errorCode({code:'SECRET',cause:{code:'EPIPE'}}),'OTHER');
 assert.equal(observer.errorCode({cause:{code:'UND_ERR_SOCKET',message:'SECRET'}}),'UND_ERR_SOCKET');
});
test('real HTTP GET/POST responses and counts unchanged; reuse and undici observations redact secrets',async()=>{
 const dir=directory();let count=0;let server;let agent;let obs;
 try {
  server=http.createServer((req,res)=>{count++;req.resume();req.on('end',()=>res.end('unchanged'));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  obs=observer.install({directory:dir,ports:[port]});agent=new http.Agent({keepAlive:true});
  for(const method of ['GET','POST','GET'])await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,agent,method,path:'/api/tenant?token=QUERYSECRET',headers:{Authorization:'Bearer HEADERSECRET',Cookie:'COOKIESECRET'}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{assert.equal(res.statusCode,200);assert.equal(body,'unchanged');resolve();});});req.on('error',reject);req.end(method==='POST'?'BODYSECRET':undefined);});
  const response=await fetch(`http://127.0.0.1:${port}/api/clients/PRIVATEID?token=QUERYSECRET`);assert.equal(await response.text(),'unchanged');assert.equal(count,4);
  obs.flush();const raw=fs.readFileSync(obs.file,'utf8');assert(!/QUERYSECRET|HEADERSECRET|COOKIESECRET|BODYSECRET|PRIVATEID|authorization|headers|cookie/i.test(raw));
  const rows=raw.trim().split('\n').map(JSON.parse);
  assert(rows.some(r=>r.event==='http_server_start'));
  assert(rows.some(r=>r.event==='http_client_start'&&r.reused_socket===true));
  assert(rows.some(r=>r.event==='undici_send'&&r.pathname==='/api/clients/:id'));
  assert(rows.some(r=>r.event==='undici_complete'));
  for(const r of rows)assert(!Object.values(r).some(v=>v!==null&&typeof v==='object'));
 } finally {obs?.stop();agent?.destroy();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('one reset remains one failed request, observer neither retries nor consumes error',async()=>{
 const dir=directory();let count=0;const server=http.createServer((req)=>{count++;req.socket.destroy();});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;const obs=observer.install({directory:dir,ports:[port]});
 try {await assert.rejects(new Promise((resolve,reject)=>http.get(`http://127.0.0.1:${port}/api/tenant`,resolve).on('error',reject)),{code:'ECONNRESET'});assert.equal(count,1);obs.flush();const raw=fs.readFileSync(obs.file,'utf8');assert.match(raw,/ECONNRESET/);}finally{obs.stop();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('external events excluded; bounded ring; nonprimitive metadata never serialized',()=>{
 const dir=directory();const obs=observer.install({directory:dir,ports:[3000]});
 try {const socket={remoteAddress:'203.0.113.7',remotePort:3000};dc.channel('http.client.request.start').publish({request:{socket,method:'GET',path:'/SECRET'}});
 const rawBefore=fs.readFileSync((obs.flush(),obs.file),'utf8');assert(!rawBefore.includes('SECRET'));
 const observedSocket=new (require('node:events').EventEmitter)();Object.assign(observedSocket,{remoteAddress:'127.0.0.1',remotePort:3000,localPort:40000});
 const request={socket:observedSocket,method:'GET',path:'/api/tenant'};
 for(let i=0;i<4000;i++)dc.channel('http.client.request.start').publish({request});
 dc.channel('http.client.request.error').publish({request,error:{code:'ECONNRESET',message:'SECRET'}});
 obs.flush();assert(fs.statSync(obs.file).size<=observer.MAX_BYTES);const final=fs.readFileSync(obs.file,'utf8');assert.match(final,/process_start/);assert.match(final,/ECONNRESET/);assert(!final.includes('SECRET'));
 }finally{obs.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('disabled outside explicit CI gate and no monkeypatch / retry source',()=>{
 const dir=directory();try{const child=spawnSync(process.execPath,['-e',`require(${JSON.stringify(script)});console.log('ok')`],{env:{...process.env,CI:'false',BOS_TRANSPORT_DIAGNOSTICS:'1'},encoding:'utf8'});assert.equal(child.status,0);assert.equal(child.stdout.trim(),'ok');
 const source=fs.readFileSync(script,'utf8');assert(!/\.headers\b|\.getHeader\(|\.message\b|\.stack\b|\.body\b|\.destroy\(|\.setTimeout\(|uncaughtException\b|http\.request\s*=|fetch\s*=/.test(source));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('PID watcher records disposable process start and exit, without altering exit status',()=>{
 const dir=directory();try{
  const probe=`const {spawn}=require('node:child_process');const {watchPid}=require(${JSON.stringify(script)});const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(7),100)']);watchPid(child.pid,${JSON.stringify(dir)});child.on('exit',code=>console.log('child-exit:'+code));`;
  const result=spawnSync(process.execPath,['-e',probe],{encoding:'utf8',timeout:8000});assert.equal(result.status,0);assert.equal(result.stdout.trim(),'child-exit:7');
  const rows=fs.readFileSync(path.join(dir,fs.readdirSync(dir)[0]),'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows[0].event,'watched_process_start');assert.equal(rows.at(-1).event,'watched_process_exit');assert.equal(rows.at(-1).alive,false);assert(rows.every(r=>Object.keys(r).every(k=>['at','pid','event','alive','rss_bytes'].includes(k))));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('unwritable diagnostic destination cannot alter requests or throw observer failure',()=>{
 const dir=directory();try{const file=path.join(dir,'not-a-directory');fs.writeFileSync(file,'x');const obs=observer.install({directory:file});assert.doesNotThrow(()=>{obs.flush();obs.stop();});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('real reset retains only sanitized last-request/socket context after ordinary ring eviction',async()=>{
 const dir=directory();let accepted,serverSocket,count=0;const arrival=new Promise(r=>accepted=r);
 const server=http.createServer(req=>{count++;serverSocket=req.socket;accepted();});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,obs=observer.install({directory:dir,ports:[port]});
 try {
  const pending=new Promise((resolve,reject)=>http.get(`http://127.0.0.1:${port}/api/clients/PRIVATEID?token=QUERYSECRET`,resolve).on('error',reject)).then(value=>({value}),error=>({error}));
  await arrival;
  const filler=new (require('node:events').EventEmitter)();Object.assign(filler,{remoteAddress:'127.0.0.1',remotePort:port,localPort:40000});
  for(let i=0;i<4000;i++)dc.channel('http.client.request.start').publish({request:{socket:filler,method:'GET',path:'/api/tenant'}});
  serverSocket.resetAndDestroy();const outcome=await pending;assert.equal(outcome.error?.code,'ECONNRESET');assert.equal(count,1);obs.flush();
  const raw=fs.readFileSync(obs.file,'utf8'),rows=raw.trim().split('\n').map(JSON.parse),error=rows.find(r=>r.event==='socket_error'&&r.code==='ECONNRESET'&&r.last_request_kind==='node_http');
  assert.ok(error);assert.equal(error.last_method,'GET');assert.equal(error.last_pathname,'/api/clients/:id');assert.equal(error.socket_direction,'outbound');assert.equal(error.remote_port,port);assert(Number.isInteger(error.local_port));assert.equal(error.observed_socket_uses,1);assert.equal(typeof error.last_request_observed_at,'string');
  assert(!rows.some(r=>r.event==='http_client_start'&&r.request_id===error.last_request_id));assert(!/PRIVATEID|QUERYSECRET|token=|headers|cookie|stack|message/i.test(raw));assert(fs.statSync(obs.file).size<=observer.MAX_BYTES);
  for(const value of Object.values(error))assert(value===null||['string','number','boolean'].includes(typeof value));
 } finally {obs.stop();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('reused socket error identifies last observed second request, never prior completed request as cause',async()=>{
 const dir=directory();let count=0;const server=http.createServer((req,res)=>{count++;if(count===1)res.end('first');else req.socket.resetAndDestroy();});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,obs=observer.install({directory:dir,ports:[port]}),agent=new http.Agent({keepAlive:true,maxSockets:1});
 const send=(method,pathname)=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,agent,method,path:pathname},res=>{res.resume();res.on('end',resolve);});req.on('error',reject);req.end();});
 try{await send('GET','/api/clients/OLDSECRET');await assert.rejects(send('POST','/api/orders/NEWSECRET?key=QUERYSECRET'),{code:'ECONNRESET'});assert.equal(count,2);obs.flush();const raw=fs.readFileSync(obs.file,'utf8'),rows=raw.trim().split('\n').map(JSON.parse);const error=rows.find(r=>r.event==='socket_error'&&r.code==='ECONNRESET'&&r.last_request_kind==='node_http');assert.ok(error);assert.equal(error.last_method,'POST');assert.equal(error.last_pathname,'/api/orders/:id');assert.equal(error.observed_socket_uses,2);assert.equal(error.last_request_stage,'request_start');assert.equal(error.request_context,'LAST_OBSERVED_REQUEST');assert.equal(error.causal_request_known,false);assert(!/OLDSECRET|NEWSECRET|QUERYSECRET/.test(raw));
 }finally{obs.stop();agent.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('post-response socket error labels completed context as last observed, not an active or causal request',()=>{
 const dir=directory(),obs=observer.install({directory:dir,ports:[3000]});try{const socket=new(require('node:events').EventEmitter)();Object.assign(socket,{remoteAddress:'127.0.0.1',remotePort:3000,localPort:40001});const request={socket,method:'GET',path:'/api/tenant'};dc.channel('http.client.request.start').publish({request});dc.channel('http.client.response.finish').publish({request,response:{statusCode:200}});socket.emit(require('node:events').errorMonitor,{code:'ECONNRESET',message:'SECRET'});obs.flush();const row=fs.readFileSync(obs.file,'utf8').trim().split('\n').map(JSON.parse).find(r=>r.event==='socket_error');assert.equal(row.last_request_stage,'response_event');assert.equal(row.request_context,'LAST_OBSERVED_REQUEST');assert.equal(row.causal_request_known,false);assert.equal(row.last_pathname,'/api/tenant');assert.equal(row.remote_port,3000);assert.equal(typeof row.last_request_observed_at,'string');}finally{obs.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
