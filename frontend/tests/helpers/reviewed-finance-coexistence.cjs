const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const changes = require('./reviewed-finance-coexistence.json');
// Only the independently reviewed responsive Apply/Clear grouping and erased
// TypeScript invoice document label. Runtime guard logic remains byte-pinned.
function beforeReviewedFinanceCompatibility(file, source) {
  for (const {before, after} of changes[file] || []) {
    assert.equal(source.split(after).length - 1, 1, `Exact single Finance allowance: ${file}`);
    source = source.replace(after, before);
  }
  return source;
}
function reviewedFinanceCanvasRoot(page, shell) {
  // The old monolithic full-page root was replaced, not recolored. Account for
  // precisely its reviewed white composed root without lowering the global floor.
  assert.equal(createHash('sha256').update(page).digest('hex'), 'b6107de548e705df1faa68fa8e927f75fdc920344a852bff4d5fabb6cf7ae851');
  const root = 'return <div className="bg-white text-neutral-950">';
  assert.equal(shell.split(root).length - 1, 1, 'Finance composed root remains explicitly white exactly once');
  return 1;
}
module.exports = {beforeReviewedFinanceCompatibility, reviewedFinanceCanvasRoot};
