const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.join(__dirname, '../src/lib/inventory-decimal.ts');
const mod = new Module(file, module);
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { inventoryDecimalWire: wire, inventoryMoney: money, inventoryPurchasePreview: preview } = mod.exports;
test('Inventory18,4 exact wire retains cents and four-place maximum without binary conversion or quantization', () => {
  for (const value of ['12345678901234.1234','99999999999999.9999','99999999999999.99','-0.00005','1e-4','1.123456']) assert.equal(wire(value), value);
  assert.equal(wire('  1.00 '), '1.00');
});
test('Inventory displays exact18,2 receipt amounts and18,4 unit costs', () => {
  assert.equal(money('9999999999999999.99','USD'), 'USD 9,999,999,999,999,999.99');
  assert.equal(money('99999999999999.9999','USD',4), 'USD 99,999,999,999,999.9999');
  assert.equal(money('0.0001','GBP',4), 'GBP 0.0001');
  assert.equal(money('-0.00005','GBP',4), 'GBP -0.0001');
  assert.equal(money('invalid','USD'), 'USD —');
});
test('Receipt preview follows backend per-line HALF_UP before tax, unlike float sum', () => {
  assert.deepEqual(preview([{quantity:'1',unit_cost:'0.005',tax_code_id:'t'},{quantity:'1',unit_cost:'0.005',tax_code_id:'t'}],[{id:'t',rate:'50'}]), {subtotal:'0.02',tax:'0.02',total:'0.04'});
  assert.deepEqual(preview([{quantity:'1.00005',unit_cost:'100',tax_code_id:''}],[]), {subtotal:'100.01',tax:'0.00',total:'100.01'});
});
test('Inventory preview accepts18,2 range larger than Sales16,2 and explicitly marks overflow unavailable', () => {
  assert.equal(preview([{quantity:'100',unit_cost:'99999999999999.99',tax_code_id:''}],[]).total,'9999999999999999.00');
  for (const value of ['10000000000000000','NaN','Infinity','1e999','-1']) assert.equal(preview([{quantity:'1',unit_cost:value,tax_code_id:''}],[]).total,'');
});

test('Exact stock thresholds distinguish adjacent18,4 values and preserve negative/zero semantics',()=>{
 const compare=mod.exports.inventoryCompare;
 assert.equal(compare('99999999999999.9999','99999999999999.9998'),1);
 assert.equal(compare('12345678901234.1233','12345678901234.1234'),-1);
 assert.equal(compare('0.0000','0'),0);assert.equal(compare('-0.0001','0'),-1);
 assert.equal(compare('1e-4','0.0001'),0);assert.equal(compare('bad','0'),null);
 assert.equal(money('','USD'),'USD —');
});

test('Excess intermediate precision does not pretend to match Python Decimal28 context',()=>{
 // Actual Python: Decimal(1)*Decimal(raw) ->0.005000...; money HALF_UP ->0.01.
 // Unlimited rational cents would incorrectly promise0.00. Wire stays untouched.
 const raw='0.0049999999999999999999999999999999';
 assert.equal(wire(raw),raw);
 assert.deepEqual(preview([{quantity:'1',unit_cost:raw,tax_code_id:''}],[]),{subtotal:'',tax:'',total:''});
 assert.equal(preview([{quantity:'1',unit_cost:'0.01',tax_code_id:'t'}],[{id:'t',rate:'49.99999999999999999999999999999'}]).total,'');
 assert.deepEqual(preview([{quantity:'0',unit_cost:raw,tax_code_id:'t'}],[{id:'t',rate:raw}]),{subtotal:'0.00',tax:'0.00',total:'0.00'});
 assert.equal(preview([{quantity:'-1',unit_cost:raw,tax_code_id:''}],[]).total,'');
 assert.equal(preview([{quantity:'1',unit_cost:'99999999999999.9999',tax_code_id:''}],[]).total,'100000000000000.00');
 assert.equal(preview([{quantity:'1',unit_cost:'1.234567890123456789012345678',tax_code_id:''}],[]).total,'1.23');
});
