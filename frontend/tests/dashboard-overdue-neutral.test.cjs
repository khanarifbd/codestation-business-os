const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../src/components/dashboard/dashboard-composition.css'), 'utf8');
const globals = fs.readFileSync(path.join(__dirname, '../src/app/globals.css'), 'utf8');
function verify(source) {
  assert.match(source, /\.dashboard-current-overdue \{[^}]*border-bottom:1px solid var\(--workspace-neutral-border, #dce5d4\);/);
  assert.match(source, /\.dashboard-current-overdue>span:first-child \{[^}]*color:var\(--workspace-neutral-muted, #8b8d73\);/);
}
test('overdue section decorative divider and label use the shared neutral palette', () => {
  verify(css);
  assert.match(globals, /--workspace-neutral-border:\s*#e5e5e5;/);
  assert.match(globals, /--workspace-neutral-muted:\s*#626262;/);
});
test('both previous decorative literal regressions are rejected', () => {
  assert.throws(() => verify(css.replace(/\.dashboard-current-overdue \{[^}]+\}/, rule => rule.replace('var(--workspace-neutral-border, #dce5d4)', '#dce5d4'))));
  assert.throws(() => verify(css.replace(/\.dashboard-current-overdue>span:first-child \{[^}]+\}/, rule => rule.replace('var(--workspace-neutral-muted, #8b8d73)', '#8b8d73'))));
});
test('overdue semantic amount badges and geometry remain unchanged', () => {
  assert.match(css, /\.dashboard-current-overdue \{ display:flex; align-items:center; flex-wrap:wrap; gap:5px; padding:0 0 13px 23px;/);
  assert.match(css, /\.dashboard-current-overdue>span:not\(:first-child\) \{ padding:3px 6px; font-size:9px; border:0; border-radius:4px; background:#f3ead7; color:#7e652b; \}/);
});
