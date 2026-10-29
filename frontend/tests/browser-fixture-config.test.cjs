const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function config(baseURL) {
  const env = { ...process.env };
  delete env.E2E_BASE_URL;
  if (baseURL !== undefined) env.E2E_BASE_URL = baseURL;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "import config from './playwright.config.mjs'; console.log(JSON.stringify(config.use));"], { cwd: root, env, encoding: 'utf8' }));
}
test('API fixture requests use exact configured origin including nondefault port', () => {
  const use = config('http://localhost:3199');
  assert.equal(use.baseURL, 'http://localhost:3199');
  assert.deepEqual(use.extraHTTPHeaders, { Origin: 'http://localhost:3199' });
  assert.equal(use.ignoreHTTPSErrors, undefined);
});
test('default origin and HTTPS scheme are preserved without TLS bypass', () => {
  assert.equal(config().extraHTTPHeaders.Origin, 'http://127.0.0.1:3000');
  const use = config('https://localhost:3443');
  assert.equal(use.extraHTTPHeaders.Origin, 'https://localhost:3443');
  assert.equal(use.ignoreHTTPSErrors, undefined);
});
test('separate personal manager context inherits configured URL and Origin, not owner cookies', () => {
  const source = fs.readFileSync(path.join(root, 'e2e/qc-personal-client-portals.spec.mjs'), 'utf8');
  assert.match(source, /newContext\(\{baseURL:info\.project\.use\.baseURL,extraHTTPHeaders:info\.project\.use\.extraHTTPHeaders\}\)/);
  assert.doesNotMatch(source, /localhost:3100|storageState:/);
  assert.match(source, /BROWSER_FIXTURE is required/);
});
test('client project navigation awaits the exact real detail GET before visibility assertions', () => {
  const source = fs.readFileSync(path.join(root, 'e2e/qc-personal-client-portals.spec.mjs'), 'utf8');
  const start = source.indexOf(' const projectDetailURL=');
  const end = source.indexOf(" await page.goto('/dashboard/client/invoices')", start);
  assert.ok(start >= 0 && end > start);
  const detail = source.slice(start, end);
  assert.match(detail, /new URL\(`\/api\/client-portal\/projects\/\$\{f\.project_id\}`,page\.url\(\)\)\.href/);
  assert.match(detail, /Promise\.all\(\[\s*page\.waitForResponse\(r=>r\.url\(\)===projectDetailURL&&r\.request\(\)\.method\(\)==='GET'\),\s*page\.getByRole\('link'\)/);
  assert.match(detail, /expect\(projectResponse\.status\(\)\)\.toBe\(200\)/);
  assert.match(detail, /await json\(projectResponse\);expect\(project\.id\)\.toBe\(f\.project_id\)/);
  for (const [title, present] of [['Public update', true], ['Private update', false]]) {
    assert.ok(detail.includes(`expect(project.milestones.some(row=>row.title==='${title}')).toBe(${present})`));
  }
  assert.ok(detail.includes('toHaveURL(url=>url.pathname===`/dashboard/client/projects/${f.project_id}`)'));
  assert.ok(detail.indexOf('await json(projectResponse)') < detail.indexOf("page.getByText('Public update'"));
  assert.ok(detail.includes("page.getByText('Public update',{exact:true})).toBeVisible()"));
  assert.ok(detail.includes("page.getByText('Private update',{exact:true})).toHaveCount(0)"));
  assert.doesNotMatch(detail, /timeout:|waitForTimeout|route\(|fulfill\(/);
});
