const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { restoreDashboardRevision, restoreDashboardRange, restoreDashboardSeries, restoreDashboardRangeOwner } = require('./helpers/reviewed-dashboard-revision.cjs');
const page = fs.readFileSync(path.join(__dirname, '../src/app/dashboard/page.tsx'), 'utf8');
const hunks = require('./fixtures/dashboard-series-reviewed-hunks.json');
test('Series integration inverse accepts only exact approved import/derived-data/panel replacements', () => {
  assert.equal(hunks.length, 5);
  const restored = restoreDashboardRevision(page);
  const seriesPage = restoreDashboardRange(page);
  for (const { after } of hunks) {
    assert.throws(() => restoreDashboardSeries(seriesPage.replace(after, after + '\n' + after)));
    assert.throws(() => restoreDashboardSeries(seriesPage.replace(after, after.replace(/\w/, 'X'))));
  }
  const changed = page.replace('response.status === 401', 'response.status === 403');
  assert.throws(()=>restoreDashboardRevision(changed), 'authentication edits inside reviewed ownership blocks are rejected before baseline normalization');
  assert.ok(restored.includes('response.status === 401'));
  assert.match(page, /dateFrom=\{data.date_from\} dateTo=\{data.date_to\}/);
  assert.match(page, /enabled=\{!reportLoading\}/);
});

test('Shared range inverse rejects missing, duplicated or changed date/admission contract',()=>{
 const hunks=require('./fixtures/dashboard-range-owner-reviewed-hunks.json');assert.equal(hunks.length,7);for(const {after}of hunks){assert.throws(()=>restoreDashboardRangeOwner(page.replace(after,after+'\n'+after)));assert.throws(()=>restoreDashboardRangeOwner(page.replace(after,after.replace(/\w/,'X'))));}
 const intermediate=restoreDashboardRangeOwner(page);for(const {after}of require('./fixtures/dashboard-range-reviewed-hunks.json'))assert.equal(intermediate.split(after).length-1,1);
});
