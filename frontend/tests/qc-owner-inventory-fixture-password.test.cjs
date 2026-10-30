const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../e2e/qc-owner-inventory.spec.mjs'), 'utf8');
const declaration = 'const password = process.env.E2E_PASSWORD;';
const check = "expect(password, 'E2E_PASSWORD must be configured for the disposable CI fixture').toBeTruthy();";
test('qc-owner-inventory: existing CI credential is mandatory before login; no source fallback', () => {
  assert.equal((source.match(/process\.env\.E2E_PASSWORD/g) || []).length, 1);
  assert.ok(source.includes(declaration));
  assert.ok(source.includes(check));
  assert.ok(source.includes('test.beforeEach(() => {\n  ' + check + '\n});'));
  for (const value of [undefined, '', 'synthetic-in-memory-test-value']) {
    const env = value === undefined ? {} : { E2E_PASSWORD: value };
    const run = () => vm.runInNewContext(declaration + check, { process: { env }, expect: actual => ({ toBeTruthy: () => assert.ok(actual) }) });
    if (value) assert.doesNotThrow(run); else assert.throws(run);
  }
});
