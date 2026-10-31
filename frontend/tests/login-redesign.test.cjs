const { restoreLoginReadiness } = require('./helpers/reviewed-login-readiness.cjs');
const { withReviewedCanvas } = require('./helpers/reviewed-canvas.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const baseline = process.env.BASELINE_FRONTEND
  ? path.resolve(process.env.BASELINE_FRONTEND)
  : path.join(__dirname, '../../test-fixtures/frontend-original');
const candidate = path.resolve(__dirname, '..');
const read = (root, file) => { const source=fs.readFileSync(path.join(root,file),'utf8'); return root===candidate&&file==='src/app/login/page.tsx'?restoreLoginReadiness(source):source; };
const login = 'src/app/login/page.tsx';
// The release security change adds only these exact boundary guards. Comparing
// against a transformed baseline preserves every original import, handler,
// payload, refresh/cookie action and API file; this is not a path exemption.
const approvedOriginGuards = {
  'src/lib/authenticated-backend.ts': {
    entry: '): Promise<{ upstream: Response; rotatedTokens: TokenPair | null }> {',
    guard: '\n  const rejected = guardMutationOrigin(request);\n  if (rejected) return { upstream: rejected, rotatedTokens: null };\n',
  },
  'src/lib/public-auth-proxy.ts': {
    entry: 'export async function proxyPublicAuthAction(request: Request, backendPath: string) {',
    guard: '\n  const rejected = guardMutationOrigin(request, { requireJson: true });\n  if (rejected) return rejected;\n',
  },
  'src/app/api/auth/login/route.ts': { json: true, requestType: 'NextRequest' },
  'src/app/api/auth/google/route.ts': { json: true, requestType: 'NextRequest' },
  'src/app/api/auth/signup/route.ts': { json: true, requestType: 'Request' },
  'src/app/api/auth/passkeys/options/route.ts': { json: false, requestType: 'NextRequest' },
  'src/app/api/auth/passkeys/verify/route.ts': { json: true, requestType: 'NextRequest' },
  'src/app/api/auth/logout/route.ts': { json: false, requestType: 'NextRequest' },
  'src/app/api/auth/session/activity/route.ts': { json: false, requestType: 'NextRequest' },
  'src/app/api/organizations/route.ts': {
    entry: 'async function proxyOrganizations(request: NextRequest, method: "GET" | "POST") {',
    guard: '\n  const rejected = guardMutationOrigin(request, { requireJson: method === "POST" });\n  if (rejected) return rejected;\n',
  },
  'src/app/api/employee-invitations/accept/route.ts': { json: true, requestType: 'NextRequest' },
  'src/app/api/client-invitations/accept/route.ts': { json: true, requestType: 'NextRequest' },
};
function expectedPreservedSource(file) {
  const original = read(baseline, file);
  // Existing recurring-post backend already supports explicit retry keys. Keep
  // every other proxy byte/auth/body/cookie behavior equal to baseline.
  if (file === 'src/app/api/finance-controls/[...path]/route.ts') {
    const anchor = '  const headers: Record<string, string> = { "X-Organization-ID": organizationId };';
    const forwarding = '\n  const idempotencyKey = request.headers.get("idempotency-key") || request.headers.get("x-idempotency-key");\n  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;';
    assert.equal(original.split(anchor).length, 2, 'Exactly one tenant-header boundary');
    assert.ok(!original.includes('idempotencyKey'), 'Baseline has no retry-header insertion');
    return original.replace(anchor, anchor + forwarding);
  }
  const approved = approvedOriginGuards[file];
  if (!approved) return original;
  assert.ok(!original.includes('guardMutationOrigin'), `${file}: baseline has no new guard`);
  const entry = approved.entry ?? `export async function POST(request: ${approved.requestType}) {`;
  const guard = approved.guard ?? `\n  const rejected = guardMutationOrigin(request${approved.json ? ', { requireJson: true }' : ''});\n  if (rejected) return rejected;\n`;
  assert.equal(original.split(entry).length, 2, `${file}: exactly one approved boundary`);
  return 'import { guardMutationOrigin } from "@/lib/mutation-origin";\n' + original.replace(entry, entry + guard);
}
function syntax(root, file) { return ts.createSourceFile(file, read(root,file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function findFunction(root, file, name) {
  const source = syntax(root,file); let result;
  const visit = n => { if (ts.isFunctionDeclaration(n) && n.name?.text === name) result = n.getText(source); ts.forEachChild(n,visit); };
  visit(source); assert.ok(result,`Function ${name} exists`); return result;
}
for (const name of ['finishAuthentication','prepareGoogleLink','handlePasskeySignIn','handleSubmit']) {
  test(`${name}: authentication behavior is byte-identical`,()=>assert.equal(findFunction(candidate,login,name),findFunction(baseline,login,name)));
}
test('All login effects, state and credential callbacks unchanged before render',()=>{
 const section=(root)=>{const s=read(root,login);return s.slice(s.indexOf('export default function LoginPage() {'),s.indexOf('  return (\n    <AuthFrame'));};
 assert.equal(section(candidate),section(baseline));
});
for (const file of ['src/components/auth/password-field.tsx','src/lib/auth-session.ts','src/lib/passkeys.ts','src/lib/authenticated-backend.ts','src/lib/public-auth-proxy.ts','src/components/session-activity-tracker.tsx','src/proxy.ts']) {
 test(`${file}: existing behavior retained except exact approved origin boundary`,()=>assert.equal(read(candidate,file),expectedPreservedSource(file)));
}
test('Every API route retains its exact baseline except exact approved origin/key forwarding insertions; no route added or removed',()=>{
 function paths(root){return fs.readdirSync(path.join(root,'src/app/api'),{recursive:true}).filter(p=>p.endsWith('route.ts')).sort();}
 assert.deepEqual(paths(candidate),paths(baseline));
 for(const file of paths(baseline)) assert.equal(read(candidate,'src/app/api/'+file),expectedPreservedSource('src/app/api/'+file));
});
test('Origin boundary does not change any internal authentication refresh implementation',()=>{
 for(const name of ['refreshKey','performRefresh','refreshSession']) assert.equal(findFunction(candidate,'src/lib/authenticated-backend.ts',name),findFunction(baseline,'src/lib/authenticated-backend.ts',name));
 assert.equal(findFunction(candidate,'src/app/api/organizations/route.ts','refreshSession'),findFunction(baseline,'src/app/api/organizations/route.ts','refreshSession'));
});
test('Login form preserves identifier/password names, autocomplete, native validation and auth actions',()=>{
 const s=read(candidate,login);
 for(const token of ['name="identifier"','autoComplete="username webauthn"','required autoFocus','name="password"','autoComplete="current-password"','onSubmit={handleSubmit}','handlePasskeySignIn()','disabled={passkeyLoading || loading}','disabled={!hydrated || loading}','role="alert"','role="status"','href="/forgot-password"','href="/signup"','href="/verify-email"','onAuthenticated={finishAuthentication}','onLinkRequired={prepareGoogleLink}']) assert.ok(s.includes(token),token);
});
test('Shared auth frame retains original presentation except reviewed outer canvas',()=>{
 const source=read(candidate,'src/components/auth/auth-frame.tsx');assert.ok(source.includes('variant = "default"'));assert.ok(source.includes('if (variant !== "default")'));
 const old=withReviewedCanvas('src/components/auth/auth-frame.tsx',read(baseline,'src/components/auth/auth-frame.tsx'));assert.equal(source.slice(source.indexOf('  return (')),old.slice(old.indexOf('  return (')));
});
test('Google auth callback and sign-in setup unchanged; optional divider defaults on',()=>{
 const s=read(candidate,'src/components/auth/google-sign-in.tsx'), b=read(baseline,'src/components/auth/google-sign-in.tsx');
 assert.equal(s.slice(s.indexOf('  const clientId'),s.indexOf('  return (')),b.slice(b.indexOf('  const clientId'),b.indexOf('  return (')));
 assert.ok(s.includes('showEmailDivider = true'));
});
test('Informative workflow is illustrative and adds no fake account metrics',()=>{
 const s=read(candidate,'src/components/auth/login-frame.tsx');
 assert.ok(s.includes('Not live account data.'));assert.ok(s.includes('Product overview'));
 for(const label of ['Client','Quotation','Order','Project','Invoice','Payment']) assert.ok(s.includes(`<strong>${label}</strong>`));
 assert.ok(!s.includes('trusted by')); assert.ok(!s.includes('99.9'));
});

test('Login readiness keeps POST fallback and credential controls disabled until mounted',()=>{
 const s=fs.readFileSync(path.join(candidate,login),'utf8');
 for(const token of ['method="post"','<fieldset disabled={!hydrated}','aria-label="Sign-in credentials"','disabled={!hydrated || loading}'])assert.ok(s.includes(token),token);
 for(const {after} of require('./fixtures/login-readiness-reviewed-hunks.json')){
  assert.throws(()=>restoreLoginReadiness(s.replace(after,after+after)));
  assert.throws(()=>restoreLoginReadiness(s.replace(after,after.slice(0,-1)+'X')));
 }
 const changed=restoreLoginReadiness(s.replace('password: form.get("password")','password: null'));
 assert.notEqual(changed,restoreLoginReadiness(s));
});
