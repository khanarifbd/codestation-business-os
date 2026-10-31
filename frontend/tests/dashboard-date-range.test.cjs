const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
// Execute the production helpers, including their actual transitive imports.
function load(file) {
  const filename = path.join(root, 'src/lib', file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = name => name.startsWith('./') ? load(`${name.slice(2)}.ts`) : require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return mod.exports;
}
const { dashboardDateShortcut, validateDashboardDateRange } = load('dashboard-date-range.ts');
const shortcut = (preset, zone, instant) => dashboardDateShortcut(preset, zone, new Date(instant));
const validate = (from, to, zone = 'UTC', instant = '2026-10-31T12:00:00Z') => validateDashboardDateRange({from, to}, zone, new Date(instant));
const bounds = result => ({from:result.from,to:result.to});

test('month defaults to company month start through today, not future month end', () => {
  assert.deepEqual(shortcut('month','Asia/Dhaka','2026-10-15T12:00:00Z'), {from:'2026-10-01',to:'2026-10-15',label:'This month'});
  assert.deepEqual(shortcut('today','Asia/Dhaka','2026-10-15T12:00:00Z'), {from:'2026-10-15',to:'2026-10-15',label:'Today'});
});
test('company calendar, not viewer timezone, controls month and Today boundaries', () => {
  const now='2026-11-01T02:00:00Z';
  assert.deepEqual(bounds(shortcut('today','America/Los_Angeles',now)), {from:'2026-10-31',to:'2026-10-31'});
  assert.deepEqual(bounds(shortcut('month','America/Los_Angeles',now)), {from:'2026-10-01',to:'2026-10-31'});
  assert.deepEqual(bounds(shortcut('month','Asia/Dhaka',now)), {from:'2026-11-01',to:'2026-11-01'});
});
test('every weekday uses Monday through today without a future Sunday', () => {
  for(let n=2;n<=8;n++) {
    const today=`2026-11-0${n}`;
    assert.deepEqual(bounds(shortcut('week','UTC',`${today}T12:00:00Z`)),{from:'2026-11-02',to:today});
  }
});
test('week safely spans month/year boundaries in organization timezone', () => {
  assert.deepEqual(bounds(shortcut('week','UTC','2027-01-01T12:00:00Z')),{from:'2026-12-28',to:'2027-01-01'});
  assert.deepEqual(bounds(shortcut('week','UTC','2026-11-01T12:00:00Z')),{from:'2026-10-26',to:'2026-11-01'});
  const now='2026-11-01T19:00:00Z';
  assert.deepEqual(bounds(shortcut('week','Asia/Dhaka',now)),{from:'2026-11-02',to:'2026-11-02'});
  assert.deepEqual(bounds(shortcut('week','America/New_York',now)),{from:'2026-10-26',to:'2026-11-01'});
});
for(const [now,today,monday] of [
  ['2026-03-08T06:59:00Z','2026-03-08','2026-03-02'],['2026-03-08T07:01:00Z','2026-03-08','2026-03-02'],
  ['2026-11-01T05:59:00Z','2026-11-01','2026-10-26'],['2026-11-01T06:01:00Z','2026-11-01','2026-10-26'],
]) test(`DST ${now} retains correct calendar bounds`,()=>{
  assert.deepEqual(bounds(shortcut('today','America/New_York',now)),{from:today,to:today});
  assert.deepEqual(bounds(shortcut('week','America/New_York',now)),{from:monday,to:today});
  assert.equal(validate(monday,today,'America/New_York',now),null);
});
test('existing last month, quarter, year and leap month shortcuts retain semantics',()=>{
  assert.deepEqual(bounds(shortcut('last_month','UTC','2024-03-01T12:00:00Z')),{from:'2024-02-01',to:'2024-02-29'});
  assert.deepEqual(bounds(shortcut('month','UTC','2024-02-29T12:00:00Z')),{from:'2024-02-01',to:'2024-02-29'});
  assert.deepEqual(bounds(shortcut('quarter','America/Los_Angeles','2026-04-01T02:00:00Z')),{from:'2026-01-01',to:'2026-03-31'});
  assert.deepEqual(bounds(shortcut('year','America/Los_Angeles','2027-01-01T02:00:00Z')),{from:'2026-01-01',to:'2026-12-31'});
});
test('same day, leap day and DST-crossing ranges are valid',()=>{
  for(const [from,to] of [['2024-02-29','2024-02-29'],['2026-03-07','2026-03-09'],['2025-11-01','2025-11-03']]) assert.equal(validate(from,to,'America/New_York'),null);
});
test('invalid, empty, noncanonical dates and year zero rejected on either boundary',()=>{
  for(const bad of ['', ' ', '2026-02-29','2024-02-30','2026-04-31','2026-00-01','2026-13-01','2026-01-00','2026-1-01','2026-01-1','2026/01/01','2026-01-01T00:00:00Z','0000-01-01']) {
    assert.match(validate(bad,'2026-10-31'),/valid From and To/);
    assert.match(validate('2026-01-01',bad),/valid From and To/);
  }
});
test('inverted range rejected rather than silently swapped',()=>{
  assert.match(validate('2026-10-31','2026-10-01'),/on or before/);
});
test('future validation uses company today across opposing timezones',()=>{
  const now='2026-11-01T02:00:00Z';
  assert.match(validate('2026-11-01','2026-11-01','America/Los_Angeles',now),/after today/);
  assert.equal(validate('2026-11-01','2026-11-01','Asia/Dhaka',now),null);
  assert.match(validate('2026-10-31','2026-11-02','Asia/Dhaka',now),/after today/);
});
test('366-day limit includes both endpoints for leap and ordinary years',()=>{
  assert.equal(validate('2024-01-01','2024-12-31'),null);
  assert.match(validate('2024-01-01','2025-01-01'),/366 days or fewer/);
  assert.equal(validate('2025-01-01','2026-01-01'),null);
  assert.match(validate('2025-01-01','2026-01-02'),/366 days or fewer/);
});
test('missing/invalid timezone retains deterministic UTC fallback',()=>{
  for(const zone of [undefined,'','Invalid/Timezone']) {
    assert.deepEqual(bounds(shortcut('today',zone,'2026-10-31T23:59:00Z')),{from:'2026-10-31',to:'2026-10-31'});
    assert.equal(validate('2026-10-31','2026-10-31',zone,'2026-10-31T23:59:00Z'),null);
    assert.match(validate('2026-11-01','2026-11-01',zone,'2026-10-31T23:59:00Z'),/after today/);
  }
});
test('invalid injected clock does not fabricate dates',()=>{
  assert.throws(()=>dashboardDateShortcut('today','UTC',new Date('invalid')),RangeError);
  assert.throws(()=>validateDashboardDateRange({from:'2026-01-01',to:'2026-01-01'},'UTC',new Date('invalid')),RangeError);
});
