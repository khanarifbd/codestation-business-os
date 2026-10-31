const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.join(__dirname, '../src/lib/inventory-localization.ts');
const mod = new Module(file, module);
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { inventoryToday: today } = mod.exports;
for (const [timezone,instant,expected] of [
  ['America/New_York','2026-10-30T00:30:00Z','2026-10-29'],
  ['Asia/Dhaka','2026-10-29T20:30:00Z','2026-10-30'],
  ['Pacific/Kiritimati','2026-10-29T12:00:00Z','2026-10-30'],
  ['America/New_York','2026-03-08T06:59:59Z','2026-03-08'],
  ['America/New_York','2026-03-08T07:00:00Z','2026-03-08'],
  ['America/New_York','2026-11-01T05:59:59Z','2026-11-01'],
  ['America/New_York','2026-11-01T06:00:00Z','2026-11-01'],
  ['not-a-timezone','2026-10-30T00:30:00Z','2026-10-30'],
  [null,'2026-10-30T00:30:00Z','2026-10-30'],
]) test(`Inventory date-only default ${timezone} at ${instant}`, () => assert.equal(today(timezone,new Date(instant)),expected));
