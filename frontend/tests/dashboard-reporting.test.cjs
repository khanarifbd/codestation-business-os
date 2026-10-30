const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

// Execute the real pure TypeScript helpers, including the shared exact formatter.
function load(file) {
  const filename = path.join(root, 'src/lib', file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = name => name === './sales-money-preview' ? load('sales-money-preview.ts') : require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return mod.exports;
}
const { reportingRange, formatDashboardMoney } = load('dashboard-reporting.ts');
const range = (preset, zone, instant) => reportingRange(preset, zone, new Date(instant));

test('company date can be tomorrow at UTC+14 or yesterday at UTC-12', () => {
  assert.deepEqual(range('month', 'Pacific/Kiritimati', '2026-12-31T12:30:00Z'), { from: '2027-01-01', to: '2027-01-01', label: 'This month' });
  assert.deepEqual(range('month', 'Etc/GMT+12', '2027-01-01T05:00:00Z'), { from: '2026-12-01', to: '2026-12-31', label: 'This month' });
});
test('last month uses company calendar across year and leap-day boundaries', () => {
  assert.deepEqual(range('last_month', 'Pacific/Kiritimati', '2026-12-31T12:30:00Z'), { from: '2026-12-01', to: '2026-12-31', label: 'Last month' });
  assert.deepEqual(range('last_month', 'America/New_York', '2024-03-01T12:00:00Z'), { from: '2024-02-01', to: '2024-02-29', label: 'Last month' });
  assert.deepEqual(range('last_month', 'Europe/London', '2025-03-01T12:00:00Z'), { from: '2025-02-01', to: '2025-02-28', label: 'Last month' });
});
test('quarter and year use company date without cross-timezone day shifts', () => {
  assert.deepEqual(range('quarter', 'America/Los_Angeles', '2026-04-01T02:00:00Z'), { from: '2026-01-01', to: '2026-03-31', label: 'This quarter' });
  assert.deepEqual(range('quarter', 'Asia/Dhaka', '2026-04-01T02:00:00Z'), { from: '2026-04-01', to: '2026-04-01', label: 'This quarter' });
  assert.deepEqual(range('year', 'America/Los_Angeles', '2027-01-01T02:00:00Z'), { from: '2026-01-01', to: '2026-12-31', label: 'This year' });
});
for (const [instant, expected] of [
  ['2026-03-08T06:59:00Z', '2026-03-08'], ['2026-03-08T07:01:00Z', '2026-03-08'],
  ['2026-11-01T05:59:00Z', '2026-11-01'], ['2026-11-01T06:01:00Z', '2026-11-01'],
]) test(`US daylight-saving transition ${instant} keeps the same company calendar day`, () => {
  assert.equal(range('month', 'America/New_York', instant).to, expected);
});
test('invalid or absent timezone deterministically falls back to UTC', () => {
  for (const zone of ['Not/A-Timezone', '', undefined, null]) {
    assert.deepEqual(range('month', zone, '2026-10-31T23:59:00Z'), { from: '2026-10-01', to: '2026-10-31', label: 'This month' });
  }
});
test('calendar arithmetic does not reinterpret years 0..99 as 1900..1999', () => {
  assert.deepEqual(range('last_month', 'UTC', '0099-01-15T12:00:00Z'), { from: '0098-12-01', to: '0098-12-31', label: 'Last month' });
});
test('invalid injected clock is not silently turned into fabricated dates', () => {
  assert.throws(() => reportingRange('month', 'UTC', new Date('invalid')), RangeError);
});
test('money retains exact stored cents, negatives and the explicit original currency', () => {
  assert.equal(formatDashboardMoney('99999999999999.99', 'USD'), 'USD 99,999,999,999,999.99');
  assert.equal(formatDashboardMoney('-99999999999999.99', 'EUR'), 'EUR -99,999,999,999,999.99');
  assert.equal(formatDashboardMoney('-0.01', 'GBP'), 'GBP -0.01');
  assert.equal(formatDashboardMoney('0.00', 'BDT'), 'BDT 0.00');
  assert.equal(formatDashboardMoney('', 'USD'), 'USD 0.00');
});
test('two-decimal accounting policy remains unchanged including JPY and half-up rounding', () => {
  assert.equal(formatDashboardMoney('1234.50', 'JPY'), 'JPY 1,234.50');
  assert.equal(formatDashboardMoney('1.005', 'USD'), 'USD 1.01');
  assert.equal(formatDashboardMoney('-1.005', 'USD'), 'USD -1.01');
  assert.equal(formatDashboardMoney('invalid', 'USD'), 'USD —');
});
test('exact money grouping follows the viewer locale without full-value floating conversion', () => {
  const source = `const ts=require('typescript'),fs=require('fs'),Module=require('module');
    const file=${JSON.stringify(path.join(root, 'src/lib/sales-money-preview.ts'))};
    const m=new Module(file);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
    process.stdout.write(m.exports.formatMoneyExact('99999999999999.99','EUR'));`;
  assert.equal(execFileSync(process.execPath, ['-e', source], { cwd: root, env: { ...process.env, LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8' }, encoding: 'utf8' }), 'EUR 99.999.999.999.999,99');
});
