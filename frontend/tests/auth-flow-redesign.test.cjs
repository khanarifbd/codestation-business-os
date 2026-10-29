/** Guardrails for the auth presentation redesign against the verified QA source. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const baseline = process.env.BASELINE_FRONTEND
  ? path.resolve(process.env.BASELINE_FRONTEND)
  : path.join(__dirname, '../../test-fixtures/frontend-original');
const candidate = path.resolve(__dirname, '..');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const parse = (root, file) => ts.createSourceFile(file, read(root, file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const pages = [
  ['signup', 'SignupPage'], ['forgot-password', 'ForgotPasswordPage'],
  ['reset-password', 'ResetPasswordPage'], ['verify-email', 'VerifyEmailPage'],
];

function pageFunction(root, slug, name) {
  const source = parse(root, `src/app/${slug}/page.tsx`);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration?.body, `${name} still exists`);
  const finalReturn = declaration.body.statements.find(node => ts.isReturnStatement(node));
  assert.ok(finalReturn, `${name} still renders`);
  return source.text.slice(declaration.body.getStart(source) + 1, finalReturn.getStart(source));
}
// Finite native-entry correction: reverse only this exact reviewed branch before
// comparing every original pre-render byte. No auth request/role/error waiver.
const nativeOnboardingBranch = `      if (items.length > 0) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
    }
    window.location.replace("/onboarding");`;
const originalOnboardingBranch = `      router.replace(items.length > 0 ? "/dashboard" : "/onboarding");
    } else {
      router.replace("/onboarding");
    }
    router.refresh();`;
function normalizeNativeGoogleEntry(value) {
  assert.equal(value.split(nativeOnboardingBranch).length-1,1,'exactly one reviewed Google native-entry branch');
  return value.replace(nativeOnboardingBranch,originalOnboardingBranch);
}
for (const [slug, name] of pages) {
  test(`${slug}: all hooks, request handlers and routing before JSX remain byte-identical`, () => {
    assert.equal(slug === 'signup' ? normalizeNativeGoogleEntry(pageFunction(candidate, slug, name)) : pageFunction(candidate, slug, name), pageFunction(baseline, slug, name));
  });
}

function namedControls(root, slug, tag) {
  const source = parse(root, `src/app/${slug}/page.tsx`), controls = new Map();
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === tag) {
      const attrs = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => [attr.name.getText(source), attr.initializer?.getText(source) ?? true]));
      const name = attrs.get('name');
      if (name) controls.set(name, attrs);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return controls;
}
for (const [slug] of pages) {
  for (const tag of ['input', 'PasswordField']) {
    test(`${slug}: ${tag} identifiers, autocomplete and validation contract remain intact`, () => {
      const oldControls = namedControls(baseline, slug, tag);
      const newControls = namedControls(candidate, slug, tag);
      assert.deepEqual([...newControls.keys()].sort(), [...oldControls.keys()].sort());
      for (const [name, previous] of oldControls) {
        for (const key of ['name', 'type', 'autoComplete', 'required', 'minLength', 'maxLength', 'pattern', 'autoFocus', 'defaultValue', 'label']) {
          assert.equal(newControls.get(name).get(key), previous.get(key), `${slug} ${name} ${key}`);
        }
      }
    });
  }
}
test('Shared password input retains existing validation, visibility and autocomplete behavior', () => {
  const file = 'src/components/auth/password-field.tsx';
  assert.equal(read(candidate, file), read(baseline, file));
});
test('Each auth page keeps the same submit handler and pending-state protection', () => {
  const expected = {
    signup: ['onSubmit={handleSubmit}', 'disabled={loading}'],
    'forgot-password': ['onSubmit={submit}', 'disabled={loading}'],
    'reset-password': ['onSubmit={submit}', 'disabled={loading || !token}'],
    'verify-email': ['onSubmit={resend}', 'disabled={resending}'],
  };
  for (const [slug, snippets] of Object.entries(expected)) {
    const source = read(candidate, `src/app/${slug}/page.tsx`);
    for (const snippet of snippets) assert.ok(source.includes(snippet), `${slug}: ${snippet}`);
  }
});
test('Signup retains the Google signup mode and existing authentication callback', () => {
  const source = read(candidate, 'src/app/signup/page.tsx');
  assert.ok(source.includes('mode="signup"'));
  assert.ok(source.includes('onAuthenticated={finishGoogleAuthentication}'));
});
test('Recovery and verification retain their existing sign-in and replacement-link destinations', () => {
  assert.ok(read(candidate, 'src/app/reset-password/page.tsx').includes('href="/forgot-password"'));
  assert.ok(read(candidate, 'src/app/signup/page.tsx').includes('href="/login"'));
  for (const slug of ['forgot-password', 'reset-password', 'verify-email']) {
    assert.ok(read(candidate, `src/app/${slug}/page.tsx`).includes('<AuthBackLink />'), `${slug}: shared sign-in link`);
  }
  const shared = read(candidate, 'src/components/auth/auth-notice.tsx');
  assert.ok(shared.includes('export function AuthBackLink()'));
  assert.ok(shared.includes('href="/login"'));
  assert.ok(read(candidate, 'src/app/verify-email/page.tsx').includes('href="/login?verified=1"'));
});

test('Google native-entry compatibility fails closed for changed destination, missing return, SPA reversion or collateral auth edits',()=>{
 const current=pageFunction(candidate,'signup','SignupPage');
 for(const bad of [current.replace('window.location.replace("/onboarding")','router.replace("/onboarding")'),current.replace('window.location.replace("/onboarding")','window.location.replace("/onboarding?new=1")'),current.replace('        return;\n      }','      }'),current.replace('items.length > 0','items.length > 1')])assert.throws(()=>normalizeNativeGoogleEntry(bad));
 assert.notEqual(normalizeNativeGoogleEntry(current.replace('"/api/auth/signup"','"/api/auth/signup-other"')),pageFunction(baseline,'signup','SignupPage'));
 assert.notEqual(normalizeNativeGoogleEntry(current+'\n    router.refresh();'),pageFunction(baseline,'signup','SignupPage'));
});
