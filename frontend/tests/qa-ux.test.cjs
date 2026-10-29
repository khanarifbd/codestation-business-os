const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(relative) {
  const filename = path.resolve(__dirname, '../src', relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(source, filename); return mod.exports;
}
const { getApiErrorMessage } = load('lib/api-error.ts');
const { matchesInvoiceBalance } = load('lib/invoice-balance.ts');
test('QA-001 password input has a standalone label and named reveal control', () => {
  const { PasswordField } = load('components/auth/password-field.tsx');
  const html = renderToStaticMarkup(React.createElement(PasswordField, { name: 'password', label: 'Password', hideLabel: true, autoComplete: 'current-password', placeholder: 'Enter your password' }));
  const id = html.match(/<input id="([^"]+)"/)[1];
  assert.ok(html.includes(`<label for="${id}" class="sr-only">Password</label>`));
  assert.ok(html.includes('aria-label="Show password"'));
  assert.ok(html.indexOf('</label>') < html.indexOf('<input'));
});
test('QA-011 validation arrays retain field and message, never object coercion', () => {
  for (const field of ['period_end', 'allowance', 'withholding', 'next_value', 'salvage_value']) {
    assert.equal(getApiErrorMessage({ detail: [{ loc: ['body', field], msg: 'Invalid value', type: 'value_error' }] }, 'Fallback'), `${field}: Invalid value`);
  }
  assert.equal(getApiErrorMessage({ detail: { msg: 'Salvage exceeds cost' } }, 'Fallback'), 'Salvage exceeds cost');
  assert.equal(getApiErrorMessage({ detail: [{ ctx: {} }] }, 'Fallback'), 'Fallback');
});
test('QA-015 collection eligibility excludes cancelled/draft/paid documents even with residual balance', () => {
  for (const status of ['cancelled', 'draft', 'paid']) assert.equal(matchesInvoiceBalance({ status, balance_due: '24.68' }, 'outstanding'), false);
  for (const status of ['sent', 'partially_paid', 'overdue']) assert.equal(matchesInvoiceBalance({ status, balance_due: '24.68' }, 'outstanding'), true);
  assert.equal(matchesInvoiceBalance({ status: 'cancelled', balance_due: '0' }, 'paid'), false);
  assert.equal(matchesInvoiceBalance({ status: 'paid', balance_due: '0' }, 'paid'), true);
});
