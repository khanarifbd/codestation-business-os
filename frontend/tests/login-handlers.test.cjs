const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/app/login/page.tsx'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function harness() {
 const states=[],effects=[],requests=[],navigation=[];let cursor=0;let response=()=>({ok:true,json:async()=>({user:{system_role:'user'}})});let passkeyError=null;
 const router={replace:p=>navigation.push(p),refresh:()=>navigation.push('refresh')};
 const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;
 mod.require=id=>{
  if(id==='react')return {useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=value];},useRef:()=>({current:null}),useEffect:fn=>effects.push(fn)};
  if(id==='next/navigation')return{useRouter:()=>router};
  if(id==='next/link')return{default:'a'};
  if(id.endsWith('.css'))return{};
  if(id==='@/lib/passkeys')return{conditionalPasskeysSupported:async()=>false,getPasskeyCredential:async()=>{if(passkeyError)throw passkeyError;return{test:'synthetic-credential-not-a-real-passkey'};}};
  if(id==='@/components/auth/auth-frame')return{AuthFrame:'AuthFrame'};
  if(id==='@/components/auth/google-sign-in')return{GoogleAuthSection:'GoogleAuthSection'};
  if(id==='@/components/auth/password-field')return{PasswordField:'PasswordField'};
  return require(id);
 };
 mod._compile(code,__filename);
 const render=()=>{cursor=0;effects.length=0;return mod.exports.default();};
 const find=(node,type)=>{if(!node)return null;if(Array.isArray(node)){for(const child of node){const n=find(child,type);if(n)return n;}return null;}if(node.type===type)return node;return find(node.props?.children,type);};
 const originals={fetch:global.fetch,FormData:global.FormData};
 global.fetch=async(url,options)=>{requests.push({url,options});return response(url,options);};
 global.FormData=class{constructor(values){this.values=values;}get(name){return this.values[name];}};
 return{states,effects,requests,navigation,render,find,setResponse:fn=>response=fn,setPasskeyError:e=>passkeyError=e,cleanup:()=>Object.assign(global,originals),submit:tree=>find(tree,'form').props.onSubmit({preventDefault(){},currentTarget:{identifier:'  preview@example.invalid  ',password:'synthetic-test-string-not-an-account-password'}})};
}
test('Password sign-in preserves payload trim and normal-user redirect',async()=>{const h=harness();try{await h.submit(h.render());assert.equal(h.requests[0].url,'/api/auth/login');assert.equal(JSON.parse(h.requests[0].options.body).identifier,'preview@example.invalid');assert.deepEqual(h.navigation,['/dashboard','refresh']);}finally{h.cleanup();}});
test('Super-admin sign-in preserves its dedicated redirect',async()=>{const h=harness();try{h.setResponse(()=>({ok:true,json:async()=>({user:{system_role:'super_admin'}})}));await h.submit(h.render());assert.deepEqual(h.navigation,['/super-admin','refresh']);}finally{h.cleanup();}});
test('Rejected credentials surface the original server error and re-enable submit',async()=>{const h=harness();try{h.setResponse(()=>({ok:false,json:async()=>({detail:'Synthetic rejected sign-in'})}));await h.submit(h.render());const tree=h.render();assert.equal(h.states[0],false);assert.equal(h.states[2],'Synthetic rejected sign-in');assert.ok(JSON.stringify(tree).includes('role":"alert'));assert.deepEqual(h.navigation,[]);}finally{h.cleanup();}});
test('Pending sign-in disables submit until its request finishes',async()=>{const h=harness();try{let complete;h.setResponse(()=>new Promise(resolve=>{complete=resolve;}));const work=h.submit(h.render());assert.equal(h.states[0],true);complete({ok:false,json:async()=>({detail:'Synthetic failure'})});await work;assert.equal(h.states[0],false);}finally{h.cleanup();}});
test('Google linking follows password confirmation and preserves success routing',async()=>{const h=harness();try{h.find(h.render(),'GoogleAuthSection').props.onLinkRequired('synthetic-link-token');await h.submit(h.render());assert.deepEqual(h.requests.map(r=>r.url),['/api/auth/login','/api/profile/google-link']);assert.deepEqual(h.navigation,['/dashboard','refresh']);assert.equal(h.states[4],null);}finally{h.cleanup();}});
test('Google link failure still revokes the temporary login before showing its error',async()=>{const h=harness();try{h.setResponse(url=>url==='/api/profile/google-link'?{ok:false,json:async()=>({detail:'Synthetic link failure'})}:{ok:true,json:async()=>({user:{system_role:'user'}})});h.find(h.render(),'GoogleAuthSection').props.onLinkRequired('synthetic-link-token');await h.submit(h.render());assert.deepEqual(h.requests.map(r=>r.url),['/api/auth/login','/api/profile/google-link','/api/auth/logout']);assert.equal(h.states[4],null);assert.match(h.states[2],/Synthetic link failure/);assert.deepEqual(h.navigation,[]);}finally{h.cleanup();}});
test('Passkey cancellation keeps the existing actionable error without an account',async()=>{const h=harness();try{h.setResponse(()=>({ok:true,json:async()=>({challenge_id:'synthetic',public_key:{}})}));h.setPasskeyError(new DOMException('Synthetic cancellation','NotAllowedError'));const tree=h.render();const buttons=[];const walk=n=>{if(Array.isArray(n))return n.forEach(walk);if(n?.type==='button')buttons.push(n);if(n?.props)walk(n.props.children);};walk(tree);await buttons.find(b=>b.props.className==='login-passkey').props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.states[2],'Passkey sign-in was cancelled or timed out.');assert.equal(h.states[1],false);assert.deepEqual(h.navigation,[]);}finally{h.cleanup();}});
test('Reset and verification query notices remain available after the redesign',()=>{const h=harness();const previous=global.window;try{global.window={location:{search:'?reset=1'}};h.render();h.effects[0]();assert.equal(h.states[3],'Password reset successfully. Sign in with your new password.');global.window.location.search='?verified=1';h.render();h.effects[0]();assert.equal(h.states[3],'Email verified. You can now sign in.');}finally{global.window=previous;h.cleanup();}});
