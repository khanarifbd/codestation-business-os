const assert = require('node:assert/strict');
const hunks = require('../fixtures/dashboard-final-reviewed-hunks.json');
// Explicit functional revision, not a blanket exclusion from the old presentation guard.
// Every reviewed replacement must match byte-for-byte; all unmodified code is retained.
function restoreDashboardRevision(source) {
  for (const { before, after } of hunks) {
    assert.equal(source.split(after).length - 1, 1, 'exactly one approved Dashboard revision hunk');
    source = source.replace(after, before);
  }
  return source;
}
module.exports = { restoreDashboardRevision };
