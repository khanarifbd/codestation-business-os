const assert = require('node:assert/strict');
const hunks = require('../fixtures/dashboard-final-reviewed-hunks.json');
// Explicit functional revision, not a blanket exclusion from the old presentation guard.
// Every reviewed replacement must match byte-for-byte; all unmodified code is retained.
function restoreDashboardRangeOwner(source) {
  for (const { before, after } of require('../fixtures/dashboard-range-owner-reviewed-hunks.json')) {
    assert.equal(source.split(after).length - 1, 1, 'exactly one approved shared Dashboard range ownership hunk');
    source = source.replace(after, before);
  }
  return source;
}
function restoreDashboardRange(source) {
  source = restoreDashboardRangeOwner(source);
  for (const { before, after } of require('../fixtures/dashboard-range-reviewed-hunks.json')) {
    assert.equal(source.split(after).length - 1, 1, 'exactly one approved shared Dashboard date-range hunk');
    source = source.replace(after, before);
  }
  return source;
}
function restoreDashboardSeries(source) {
  for (const { before, after } of require('../fixtures/dashboard-series-reviewed-hunks.json')) {
    assert.equal(source.split(after).length - 1, 1, 'exactly one approved Dashboard series integration hunk');
    source = source.replace(after, before);
  }
  return source;
}
function restoreDashboardRevision(source) {
  source = restoreDashboardSeries(restoreDashboardRange(source));
  for (const { before, after } of hunks) {
    assert.equal(source.split(after).length - 1, 1, 'exactly one approved Dashboard revision hunk');
    source = source.replace(after, before);
  }
  return source;
}
module.exports = { restoreDashboardRevision, restoreDashboardRange, restoreDashboardSeries, restoreDashboardRangeOwner };
