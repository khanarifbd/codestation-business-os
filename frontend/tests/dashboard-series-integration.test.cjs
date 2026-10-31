const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { restoreDashboardRevision } = require('./helpers/reviewed-dashboard-revision.cjs');
const page = fs.readFileSync(path.join(__dirname, '../src/app/dashboard/page.tsx'), 'utf8');
const hunks = require('./fixtures/dashboard-series-reviewed-hunks.json');
test('Series integration inverse accepts only exact approved import/derived-data/panel replacements', () => {
  assert.equal(hunks.length, 5);
  const restored = restoreDashboardRevision(page);
  for (const { after } of hunks) {
    assert.throws(() => restoreDashboardRevision(page.replace(after, after + '\n' + after)));
    assert.throws(() => restoreDashboardRevision(page.replace(after, after.replace(/\w/, 'X'))));
  }
  const changed = page.replace('response.status === 401', 'response.status === 403');
  assert.notEqual(restoreDashboardRevision(changed), restored, 'unrelated authentication edits remain visible to original baseline guard');
  assert.match(page, /dateFrom=\{data.date_from\} dateTo=\{data.date_to\}/);
  assert.match(page, /enabled=\{!reportLoading\}/);
});
