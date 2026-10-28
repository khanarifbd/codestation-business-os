/**
 * Presentation-slice handler regression tests. Every network call, browser location
 * and FormData payload is synthetic; no account, reset email or token is created.
 * These are targeted handler tests, not browser/provider or backend integration QA.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const syntheticPassword = 'synthetic-test-string-not-an-account-password';
const syntheticToken = 'synthetic-test-token-not-a-valid-link';
const syntheticEmail = 'preview@example.invalid';
const successful = payload => ({ ok: true, json: async () => payload });
const rejected = detail => ({ ok: false, json: async () => ({ detail }) });
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(page, search = '') {
  const states = [], effects = [], requests = [], navigation = [], nativeNavigation = [];
  let cursor = 0;
  let response = () => successful({});
  const router = { replace: value => navigation.push(value), refresh: () => navigation.push('refresh') };
  const source = fs.readFileSync(path.resolve(__dirname, `../src/app/${page}/page.tsx`), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = new Module(__filename, module);
  mod.filename = __filename;
  mod.paths = module.paths;
  mod.require = id => {
    if (id === 'react') return {
      useState: initial => {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useEffect: effect => effects.push(effect),
    };
    if (id === 'next/navigation') return { useRouter: () => router };
    if (id === 'next/link') return { default: 'a' };
    if (id.endsWith('.css')) return {};
    if (id.startsWith('@/components/')) return new Proxy({}, { get: (_target, name) => String(name) });
    return require(id);
  };
  mod._compile(code, __filename);
  function all(node, type, results = []) {
    if (Array.isArray(node)) node.forEach(child => all(child, type, results));
    else if (node?.props) {
      if (node.type === type) results.push(node);
      all(node.props.children, type, results);
    }
    return results;
  }
  const original = { fetch: global.fetch, FormData: global.FormData, window: global.window };
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return response(url, options);
  };
  global.FormData = class {
    constructor(values) { this.values = values; }
    get(name) { return this.values[name] ?? null; }
  };
  global.window = { location: { search, assign: value => nativeNavigation.push(['assign', value]), replace: value => nativeNavigation.push(['replace', value]) } };
  const render = () => { cursor = 0; effects.length = 0; return mod.exports.default(); };
  return {
    states, effects, requests, navigation, nativeNavigation, render, all,
    find: (node, type) => all(node, type)[0],
    setResponse: handler => { response = handler; },
    runEffect: () => effects.forEach(effect => effect()),
    submit: (tree, values) => all(tree, 'form')[0].props.onSubmit({ preventDefault() {}, currentTarget: values }),
    submitButton: tree => all(tree, 'button').find(button => button.props.type === 'submit'),
    cleanup: () => Object.assign(global, original),
  };
}

function assertNotice(h, kind, message) {
  const notice = h.all(h.render(), 'AuthNotice').find(node => node.props.kind === kind);
  assert.ok(notice, `Rendered ${kind} notice`);
  assert.equal(notice.props.children, message);
}

function caseWith(page, name, check, search = '') {
  test(name, async () => {
    const h = harness(page, search);
    try { await check(h); } finally { h.cleanup(); }
  });
}

caseWith('signup', 'Signup keeps normalized email, original payload and verification redirect', async h => {
  await h.submit(h.render(), { full_name: 'Synthetic Preview', email: '  PREVIEW@EXAMPLE.INVALID  ', password: syntheticPassword });
  assert.equal(h.requests[0].url, '/api/auth/signup');
  assert.equal(h.requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { full_name: 'Synthetic Preview', email: syntheticEmail, password: syntheticPassword });
  assert.deepEqual(h.navigation, ['/verify-email?email=preview%40example.invalid', 'refresh']);
});
caseWith('signup', 'Signup server failure keeps its error and re-enables the button', async h => {
  h.setResponse(() => rejected('Synthetic signup rejection'));
  await h.submit(h.render(), { full_name: 'Synthetic Preview', email: syntheticEmail, password: syntheticPassword });
  assert.equal(h.states[1], 'Synthetic signup rejection');
  assertNotice(h, 'error', 'Synthetic signup rejection');
  assert.equal(h.submitButton(h.render()).props.disabled, false);
  assert.deepEqual(h.navigation, []);
});
caseWith('signup', 'Signup pending state disables submit until failure is returned', async h => {
  let finish;
  h.setResponse(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.submit(h.render(), { full_name: 'Synthetic Preview', email: syntheticEmail, password: syntheticPassword });
  assert.equal(h.submitButton(h.render()).props.disabled, true);
  finish(rejected('Synthetic request ended'));
  await pending;
  assert.equal(h.submitButton(h.render()).props.disabled, false);
});
caseWith('signup', 'Google signup admin bypasses organization lookup and retains admin routing', async h => {
  await h.find(h.render(), 'GoogleAuthSection').props.onAuthenticated({ system_role: 'super_admin' });
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.navigation, ['/super-admin', 'refresh']);
});
for (const [name, response, route] of [
  ['existing organization', successful([{ id: 'synthetic-only' }]), '/dashboard'],
  ['no organizations', successful([]), '/onboarding'],
  ['organization lookup unavailable', rejected('Synthetic unavailable'), '/onboarding'],
]) {
  caseWith('signup', `Google signup with ${name} retains its destination`, async h => {
    h.setResponse(() => response);
    await h.find(h.render(), 'GoogleAuthSection').props.onAuthenticated({ system_role: 'user' });
    assert.deepEqual(h.requests, [{ url: '/api/organizations', options: { cache: 'no-store' } }]);
    assert.deepEqual(h.navigation, route === '/onboarding' ? [] : [route, 'refresh']);
    assert.deepEqual(h.nativeNavigation, route === '/onboarding' ? [['replace', route]] : []);
  });
}

caseWith('forgot-password', 'Recovery request retains payload and neutral account-existence response', async h => {
  await h.submit(h.render(), { email: syntheticEmail });
  assert.equal(h.requests[0].url, '/api/auth/forgot-password');
  assert.equal(h.requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { email: syntheticEmail });
  assert.equal(h.states[2], 'If an eligible account exists, reset instructions will be sent.');
  assertNotice(h, 'success', 'If an eligible account exists, reset instructions will be sent.');
  assert.equal(h.states[0], false);
  assert.deepEqual(h.navigation, []);
});
caseWith('forgot-password', 'Recovery displays supplied neutral message and clears previous status on retry', async h => {
  h.setResponse(() => successful({ message: 'Synthetic neutral confirmation' }));
  await h.submit(h.render(), { email: syntheticEmail });
  assert.equal(h.states[2], 'Synthetic neutral confirmation');
  let finish;
  h.setResponse(() => new Promise(resolve => { finish = resolve; }));
  const retry = h.submit(h.render(), { email: syntheticEmail });
  assert.equal(h.states[2], null);
  assert.equal(h.submitButton(h.render()).props.disabled, true);
  finish(rejected('Synthetic retry rejection'));
  await retry;
  assert.equal(h.states[1], 'Synthetic retry rejection');
  assertNotice(h, 'error', 'Synthetic retry rejection');
  assert.equal(h.states[0], false);
});
caseWith('forgot-password', 'Recovery network failure is recoverable and does not navigate', async h => {
  h.setResponse(() => { throw new Error('Synthetic network failure'); });
  await h.submit(h.render(), { email: syntheticEmail });
  assert.equal(h.states[1], 'Synthetic network failure');
  assert.equal(h.states[0], false);
  assert.deepEqual(h.navigation, []);
});

caseWith('reset-password', 'Reset missing token keeps submit disabled and rejects programmatic submission', async h => {
  const tree = h.render();
  assert.equal(h.submitButton(tree).props.disabled, true);
  await h.submit(tree, { password: syntheticPassword, confirm_password: syntheticPassword });
  assert.equal(h.states[2], 'This password reset link is missing its token. Request a new reset email.');
  assert.deepEqual(h.requests, []);
});
caseWith('reset-password', 'Reset mismatch retains local validation without making a request', async h => {
  h.render(); h.runEffect();
  await h.submit(h.render(), { password: syntheticPassword, confirm_password: 'different-synthetic-string' });
  assert.equal(h.states[2], 'New password and confirmation do not match.');
  assertNotice(h, 'error', 'New password and confirmation do not match.');
  assert.deepEqual(h.requests, []);
}, `?token=${syntheticToken}`);
caseWith('reset-password', 'Reset successful mocked response retains token payload and login redirect', async h => {
  h.render(); h.runEffect();
  await h.submit(h.render(), { password: syntheticPassword, confirm_password: syntheticPassword });
  assert.equal(h.requests[0].url, '/api/auth/reset-password');
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { token: syntheticToken, new_password: syntheticPassword });
  assert.deepEqual(h.navigation, []);
  assert.deepEqual(h.nativeNavigation, [['assign', '/login?reset=1']]);
}, `?token=${syntheticToken}`);
caseWith('reset-password', 'Reset expired-link response preserves server error and enables retry', async h => {
  h.setResponse(() => rejected('Synthetic expired link'));
  h.render(); h.runEffect();
  await h.submit(h.render(), { password: syntheticPassword, confirm_password: syntheticPassword });
  assert.equal(h.states[2], 'Synthetic expired link');
  assertNotice(h, 'error', 'Synthetic expired link');
  assert.equal(h.submitButton(h.render()).props.disabled, false);
  assert.deepEqual(h.navigation, []);
}, `?token=${syntheticToken}`);
caseWith('reset-password', 'Reset request pending disables submit without changing route', async h => {
  let finish;
  h.setResponse(() => new Promise(resolve => { finish = resolve; }));
  h.render(); h.runEffect();
  const pending = h.submit(h.render(), { password: syntheticPassword, confirm_password: syntheticPassword });
  assert.equal(h.submitButton(h.render()).props.disabled, true);
  assert.deepEqual(h.navigation, []);
  finish(rejected('Synthetic completion'));
  await pending;
  assert.equal(h.submitButton(h.render()).props.disabled, false);
}, `?token=${syntheticToken}`);

caseWith('verify-email', 'Verification without token prefills email but makes no verification request', async h => {
  h.render(); h.runEffect();
  assert.equal(h.states[1], syntheticEmail);
  assert.equal(h.states[2], false);
  assert.deepEqual(h.requests, []);
}, '?email=preview%40example.invalid');
caseWith('verify-email', 'Verification token loading and success retain their original states', async h => {
  let finish;
  h.setResponse(() => new Promise(resolve => { finish = resolve; }));
  h.render(); h.runEffect();
  assert.equal(h.states[2], true);
  assert.equal(h.requests[0].url, '/api/auth/verify-email');
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { token: syntheticToken });
  finish(successful({}));
  await settle();
  assert.equal(h.states[2], false);
  assert.equal(h.states[4], true);
  assert.equal(h.states[5], 'Email verified. You can now sign in.');
  assertNotice(h, 'success', 'Email verified. You can now sign in.');
  assert.equal(h.find(h.render(), 'form'), undefined);
}, `?token=${syntheticToken}`);
caseWith('verify-email', 'Verification rejected token clears loading and retains actionable error', async h => {
  h.setResponse(() => rejected('Synthetic verification expiration'));
  h.render(); h.runEffect();
  await settle();
  assert.equal(h.states[2], false);
  assert.equal(h.states[4], false);
  assert.equal(h.states[6], 'Synthetic verification expiration');
  assertNotice(h, 'error', 'Synthetic verification expiration');
  assert.ok(h.find(h.render(), 'form'));
}, `?token=${syntheticToken}`);
caseWith('verify-email', 'Verification resend keeps neutral response, endpoint and original payload', async h => {
  await h.submit(h.render(), { email: syntheticEmail });
  assert.equal(h.requests[0].url, '/api/auth/verification/resend');
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { email: syntheticEmail });
  assert.equal(h.states[5], 'If the account needs verification, a verification email will be sent.');
  assertNotice(h, 'success', 'If the account needs verification, a verification email will be sent.');
  assert.equal(h.states[3], false);
  assert.deepEqual(h.navigation, []);
});
caseWith('verify-email', 'Verification resend clears stale status while pending and shows rejection after retry', async h => {
  await h.submit(h.render(), { email: syntheticEmail });
  let finish;
  h.setResponse(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.submit(h.render(), { email: syntheticEmail });
  assert.equal(h.states[5], null);
  assert.equal(h.submitButton(h.render()).props.disabled, true);
  finish(rejected('Synthetic resend rejection'));
  await pending;
  assert.equal(h.states[6], 'Synthetic resend rejection');
  assertNotice(h, 'error', 'Synthetic resend rejection');
  assert.equal(h.submitButton(h.render()).props.disabled, false);
});

// Evaluate the real shared presentation component separately: page-level tests
// above intentionally keep component imports mocked to isolate handler behavior.
function loadNotices() {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/components/auth/auth-notice.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = new Module(__filename, module);
  mod.filename = __filename;
  mod.paths = module.paths;
  mod.require = id => id === 'next/link' ? { default: 'a' } : require(id);
  mod._compile(code, __filename);
  return mod.exports;
}
for (const [kind, role] of [['error', 'alert'], ['success', 'status'], ['info', 'status']]) {
  test(`Shared ${kind} notice renders its message with role=${role}`, () => {
    const tree = loadNotices().AuthNotice({ kind, children: 'Synthetic notice text' });
    assert.equal(tree.props.role, role);
    assert.equal(tree.props.children[1].props.children, 'Synthetic notice text');
    assert.equal(tree.props.children[0].props['aria-hidden'], 'true');
  });
}
test('Shared back link renders the existing sign-in destination', () => {
  const tree = loadNotices().AuthBackLink();
  assert.equal(tree.props.children.props.href, '/login');
});
