/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preload must be CommonJS; no bundler/runtime dependency. */
'use strict';
// CI-only, observational: never changes agents, requests, responses, retries or signals.
const fs = require('node:fs');
const path = require('node:path');
const dc = require('node:diagnostics_channel');
const { errorMonitor } = require('node:events');
const { performance } = require('node:perf_hooks');
const MAX_BYTES = 256 * 1024;
const MAX_FILES = 32;
const DIRECTORY = '/tmp/business-os-transport';
const SEGMENTS = new Set(('api v1 auth login logout refresh session activity tenant context switch dashboard-bootstrap dashboard-pulse overview reports dashboard dashboard-details accounting tax codes finance invoices invoice-page payment-instructions company-settings organizations inventory products dashboard-summary clients client-portal quotations orders projects hr me people employees attendance records capital insights payments expenses sources meta settings summary').split(' '));
function safePath(value) {
  if (typeof value !== 'string') return '/:unknown';
  // Never decode or retain query, fragment, userinfo, dynamic IDs or arbitrary segments.
  let pathname;
  try { pathname = new URL(value, 'http://localhost').pathname; } catch { return '/:unknown'; }
  return '/' + pathname.split('/').filter(Boolean).slice(0, 16).map(p => SEGMENTS.has(p) ? p : ':id').join('/');
}
function errorCode(error) {
  const code = error && (error.code || (error.cause && error.cause.code));
  return typeof code === 'string' && /^(?:ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNABORTED|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_ABORTED)$/.test(code) ? code : 'OTHER';
}
function loopback(host) { return ['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1'].includes(host); }
function install({ directory = DIRECTORY, ports = [3000, 8000] } = {}) {
  const subscriptions = [], requests = new WeakMap(), sockets = new WeakMap();
  let sequence = 0, socketSequence = 0, bytes = 0, rows = [], important = [], importantBytes = 0, enabled = true;
  const allowed = new Set(ports);
  const file = path.join(directory, `node-${process.pid}.ndjson`);
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.readdirSync(directory).filter(n => /^(node|pid)-\d+\.ndjson$/.test(n)).length >= MAX_FILES && !fs.existsSync(file)) enabled = false;
  } catch { enabled = false; }
  const started = performance.now();
  function flush() { if (enabled) { try { fs.writeFileSync(file, important.concat(rows).join(''), { mode: 0o600 }); } catch { enabled = false; } } }
  function record(event, fields = {}) {
    if (!enabled) return;
    // fields are constructed below from allowlisted primitives, never arbitrary event objects.
    const row = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, uptime_ms: Math.round(performance.now() - started), event, ...fields }) + '\n';
    const critical = event.includes('error') || event === 'process_start' || event === 'process_exit';
    if (critical) {
      important.push(row); importantBytes += Buffer.byteLength(row);
      while (importantBytes > MAX_BYTES / 4 && important.length) importantBytes -= Buffer.byteLength(important.shift());
    } else {
      rows.push(row); bytes += Buffer.byteLength(row);
      while (bytes > MAX_BYTES * 3 / 4 && rows.length) bytes -= Buffer.byteLength(rows.shift());
    }
    if (critical) flush();
  }
  function observeSocket(socket) {
    if (!socket) return null;
    let state = sockets.get(socket);
    if (state) return state;
    state = { id: ++socketSequence, first: performance.now(), uses: 0, lastComplete: null };
    sockets.set(socket, state);
    const onClose = hadError => record('socket_close', { socket_id: state.id, had_error: !!hadError, socket_observed_age_ms: Math.round(performance.now() - state.first) });
    const onError = error => record('socket_error', { socket_id: state.id, code: errorCode(error) });
    socket.once('close', onClose); socket.on(errorMonitor, onError);
    // WeakMap owns no socket lifetime; listeners are on the observed socket only.
    return state;
  }
  function socketFields(socket, state) {
    return { socket_id: state?.id ?? null, local_port: Number.isInteger(socket?.localPort) ? socket.localPort : null,
      remote_port: Number.isInteger(socket?.remotePort) ? socket.remotePort : null,
      socket_observed_age_ms: state ? Math.round(performance.now() - state.first) : null,
      since_last_response_event_ms: state?.lastComplete == null ? null : Math.round(performance.now() - state.lastComplete) };
  }
  function requestFields(request, kind, socket) {
    let meta = requests.get(request);
    if (!meta) { meta = { request_id: ++sequence, kind, method: ['GET','POST','PATCH','PUT','DELETE','HEAD','OPTIONS'].includes(request.method) ? request.method : 'OTHER', pathname: safePath(request.path ?? request.url) }; requests.set(request, meta); }
    return { request_id: meta.request_id, kind: meta.kind, method: meta.method, pathname: meta.pathname, ...socketFields(socket, observeSocket(socket)) };
  }
  function socketAllowed(socket, side) { return socket && loopback(socket.remoteAddress) && allowed.has(side === 'server' ? socket.localPort : socket.remotePort); }
  function subscribe(name, fn) { const safe = message => { try { fn(message); } catch { /* Observer failures must not affect application behavior. */ } }; dc.subscribe(name, safe); subscriptions.push([name,safe]); }
  subscribe('http.client.request.start', ({request}) => {
    const socket = request.socket;
    const connected = () => {
      try {
        if (!socketAllowed(socket, 'client')) return;
        const state = observeSocket(socket); state.uses++;
        record('http_client_start', { ...requestFields(request,'node_http',socket), reused_socket: !!request.reusedSocket, observed_socket_uses: state.uses });
      } catch { /* observation only */ }
    };
    if (socket?.connecting) socket.once('connect', connected); else connected();
  });
  subscribe('http.client.request.error', ({request,error}) => { if (requests.has(request)) record('http_client_error', { ...requestFields(request,'node_http',request.socket), reused_socket: !!request.reusedSocket, code:errorCode(error) }); });
  subscribe('http.client.response.finish', ({request,response}) => { if (requests.has(request)) { const state=observeSocket(request.socket); if(state)state.lastComplete=performance.now(); record('http_client_response', { ...requestFields(request,'node_http',request.socket), status:response.statusCode }); } });
  subscribe('http.server.request.start', ({request,socket}) => { if(socketAllowed(socket,'server')) { const state=observeSocket(socket);state.uses++;record('http_server_start',requestFields(request,'node_server',socket)); } });
  subscribe('http.server.response.finish', ({request,response,socket}) => { if(requests.has(request)) { const state=observeSocket(socket);if(state)state.lastComplete=performance.now();record('http_server_response',{...requestFields(request,'node_server',socket),status:response.statusCode}); } });
  subscribe('undici:client:sendHeaders', ({request,socket}) => { // Deliberately never reads the event's headers property.
    if(!socketAllowed(socket,'client'))return;
    const state=observeSocket(socket);state.uses++;
    record('undici_send',{...requestFields(request,'undici',socket),observed_socket_uses:state.uses,reused_observed_socket:state.uses>1});
    requests.get(request).socket=socket;
  });
  subscribe('undici:request:error', ({request,error}) => { const meta=requests.get(request);if(meta)record('undici_error',{...requestFields(request,'undici',meta.socket),code:errorCode(error)}); });
  subscribe('undici:request:trailers', ({request}) => { const meta=requests.get(request);if(meta) { const state=observeSocket(meta.socket);if(state)state.lastComplete=performance.now();record('undici_complete',requestFields(request,'undici',meta.socket)); } });
  record('process_start',{node:process.version,ppid:process.ppid});
  let last = performance.now();
  const timer=setInterval(()=> {const now=performance.now();record('process_sample',{rss_bytes:process.memoryUsage().rss,event_loop_delay_ms:Math.max(0,Math.round(now-last-5000))});last=now;flush();},5000);timer.unref();
  const onExit=code=>record('process_exit',{exit_code:code});process.on('exit',onExit);
  return { file, flush, stop(){clearInterval(timer);process.removeListener('exit',onExit);for(const [name,fn] of subscriptions)dc.unsubscribe(name,fn);flush();enabled=false;} };
}
function watchPid(pid, directory=DIRECTORY) {
  if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid PID');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,`pid-${pid}.ndjson`);let rows=[],bytes=0,first=true;
  if(fs.readdirSync(directory).filter(n=>/^(node|pid)-\d+\.ndjson$/.test(n)).length>=MAX_FILES)return;
  const sample=()=>{let rss=null,alive=false;try{const stat=fs.readFileSync(`/proc/${pid}/status`,'utf8');alive=!/^State:\s+Z/m.test(stat);const m=stat.match(/^VmRSS:\s+(\d+) kB/m);rss=m?Number(m[1])*1024:null;}catch{}const row=JSON.stringify({at:new Date().toISOString(),pid,event:first?'watched_process_start':alive?'watched_process_sample':'watched_process_exit',alive,rss_bytes:rss})+'\n';first=false;rows.push(row);bytes+=Buffer.byteLength(row);while(bytes>MAX_BYTES)bytes-=Buffer.byteLength(rows.shift());fs.writeFileSync(file,rows.join(''),{mode:0o600});return alive;};
  if(sample()){const timer=setInterval(()=>{try{if(!sample())clearInterval(timer);}catch{clearInterval(timer);}},5000);}
}
module.exports={safePath,errorCode,loopback,install,watchPid,MAX_BYTES};
if(require.main===module&&process.argv[2]==='--watch-pid')watchPid(Number(process.argv[3]));
else if(process.env.BOS_TRANSPORT_DIAGNOSTICS==='1'&&process.env.CI==='true')install();
