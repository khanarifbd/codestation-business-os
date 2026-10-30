const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const css = read('components/invoices/invoice-design.css');
test('Invoice filter actions preserve intrinsic label plus padding width instead of shrinking text', () => {
  const controls = '.invoice-filter-grid :is(input,select,button)';
  const action = '.invoice-filter-actions>button';
  assert.ok(css.indexOf(action) > css.indexOf(controls));
  assert.match(css, /\.invoice-filter-actions>button \{ flex:1; width:auto; min-width:max-content; white-space:nowrap; \}/);
  assert.match(css, /\.invoice-filter-actions \{ display:flex; flex-wrap:wrap; gap:9px; \}/);
  // Same specificity as broad control rule; later declaration wins. No smaller font or clipping.
  assert.equal((css.match(/\.invoice-filter-actions>button/g) || []).length, 1);
});
test('Existing responsive placement, touch height and both action handlers stay intact', () => {
  assert.match(css, /@media\(max-width:1279px\)[^\n]*\.invoice-filter-grid>\.invoice-filter-actions \{ grid-column:4; \}/);
  assert.match(css, /@media\(max-width:1023px\)[^\n]*\.invoice-filter-grid>\.invoice-filter-actions \{ grid-column:auto; width:auto; justify-self:start; \}/);
  assert.match(css, /\.invoice-filter-grid>\.invoice-filter-actions \{ grid-column:1\/-1; justify-self:stretch; \}/);
  const jsx = read('components/invoices-workspace-v2.tsx');
  assert.match(jsx, /type="submit" disabled=\{!canView\} className="h-11[^"\n]*px-4[^"\n]*">Apply filters<\/button>/);
  assert.match(jsx, />Clear<\/button>/);
});
