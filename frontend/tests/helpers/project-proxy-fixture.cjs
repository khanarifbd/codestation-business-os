// Execute the actual byte-forwarding tenant BFF with synthetic upstream responses.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const file=path.resolve(__dirname,'../../src/lib/tenant-proxy.ts');
async function projectProxyFixture(status,raw){
 class NextResponse extends Response {static json(body,init){return new NextResponse(JSON.stringify(body),{...init,headers:{'content-type':'application/json'}});}}
 const m=new Module(file,module);m.filename=file;m.paths=module.paths;
 m.require=id=>id==='next/server'?{NextResponse}:id==='@/lib/mutation-origin'?{guardMutationOrigin:()=>null}:id==='@/lib/auth-session'?{setAuthCookies:()=>{}}:id==='@/lib/request-context'?{requestContextHeaders:()=>({})}:id==='@/lib/server-api'?{backendFetch:async()=>new Response(raw,{status,headers:{'content-type':'application/json'}})}:require(id);
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
 return m.exports.proxyTenantRequest({method:'PATCH',cookies:{get:key=>({value:{organization_id:'synthetic-company',access_token:'synthetic-runtime-token'}[key]})},headers:new Headers({'content-type':'application/json'}),arrayBuffer:async()=>new TextEncoder().encode('{}').buffer},'/projects/synthetic');
}
module.exports={projectProxyFixture};
