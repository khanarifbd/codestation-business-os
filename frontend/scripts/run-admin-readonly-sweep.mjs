import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { localBaseURL, nextBatchDelay, ROUTES_PER_BATCH, resolveRoutes } from '../e2e-admin-readonly/support/registry.mjs';

export function readEvents(directory) {
  return readdirSync(directory).filter(name => /^batch-\d+\.ndjson$/.test(name)).flatMap(name => readFileSync(path.join(directory, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
}
export function summarize(manifest, events) {
  const rendered = new Map(events.filter(e => e.event === 'route_rendered').map(e => [e.route_id, e]));
  const blocked = new Map(events.filter(e => e.event === 'blocked_route').map(e => [e.route_id, e]));
  const routes = manifest.routes.map(route => ({ id: route.id, pattern: route.pattern, ...(rendered.get(route.id) || blocked.get(route.id) || { event: 'not_executed' }), visual_review: 'pending_actual_pixel_inspection' }));
  return { unexpected_errors: events.filter(e => e.event === 'api_read_failure' || e.event === 'page_error' || e.event === 'console_error' || e.event === 'api_response' && e.status >= 400).length, route_count: routes.length, rendered: routes.filter(r => r.event === 'route_rendered').length, blocked: routes.filter(r => r.event === 'blocked_route').length, not_executed: routes.filter(r => r.event === 'not_executed').length, mutation_attempts: events.filter(e => e.event === 'blocked_mutation').length, rate_limit_responses: events.filter(e => e.event === 'api_response' && e.status === 429).length, routes };
}
async function executeBatch(batch, directory, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.admin-readonly.config.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit', env: { ...env, ADMIN_SWEEP_BATCH: String(batch), ADMIN_SWEEP_EVIDENCE: directory, ADMIN_SWEEP_OUTPUT: path.join(directory, `captures-${batch}`) } });
    child.once('error', reject);
    child.once('exit', (code, signal) => signal ? reject(new Error(`Read-only batch${batch} terminated by ${signal}; no retry`)) : resolve(code));
  });
}
export async function runSweep(env = process.env) {
  if (env.CI !== 'true' || env.QC_BROWSER_FIXTURE !== '1') throw new Error('Explicit disposable read-only CI opt-in required');
  localBaseURL(env.E2E_BASE_URL || 'http://localhost:3000');
  const directory = env.ADMIN_SWEEP_EVIDENCE;
  if (!directory || !env.ADMIN_SWEEP_FIXTURE) throw new Error('Explicit fixture/evidence paths required');
  mkdirSync(directory, { recursive: true });
  if (readdirSync(directory).length) throw new Error('Fresh evidence directory required; do not silently retry prior run');
  const manifest = JSON.parse(readFileSync(new URL('../e2e-admin-readonly/routes.json', import.meta.url), 'utf8'));
  const registry = JSON.parse(readFileSync(env.ADMIN_SWEEP_FIXTURE, 'utf8'));
  resolveRoutes(manifest, registry); // Validate every supplied ID before browser activity.
  let batchFailure = null;
  const privateAuth = mkdtempSync(path.join(tmpdir(), 'admin-sweep-auth-'));
  const batchEnv = { ...env, ADMIN_SWEEP_AUTH_STATE: path.join(privateAuth, 'state.json') };
  try {
  for (let batch = 0; batch < Math.ceil(manifest.routes.length / ROUTES_PER_BATCH); batch++) {
    const prior = readEvents(directory), timestamps = prior.filter(e => e.event === 'heartbeat_request').map(e => e.at);
    const delay = nextBatchDelay(timestamps, Date.now());
    if (delay) {
      console.log(`Read-only batch${batch}: waiting ${delay}ms for the existing session activity budget; no identity rotation or retry`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    let code;
    try { code = await executeBatch(batch, directory, batchEnv); }
    catch { batchFailure = { batch, classification: 'batch_process_failure' }; break; }
    if (code !== 0) { batchFailure = { batch, code }; break; }
    if (readEvents(directory).some(e => e.event === 'api_response' && e.status === 429)) { batchFailure = { batch, classification: 'rate_limit_failure' }; break; }
  }
  } finally { rmSync(privateAuth, { recursive: true, force: true }); }
  const summary = { ...summarize(manifest, readEvents(directory)), batch_failure: batchFailure, head: env.GITHUB_SHA || null, no_live_verification: true };
  writeFileSync(path.join(directory, 'route-evidence.json'), JSON.stringify(summary, null, 2));
  if (batchFailure || summary.blocked || summary.not_executed || summary.mutation_attempts || summary.rate_limit_responses || summary.unexpected_errors) throw new Error('Read-only sweep incomplete; consult exact route-evidence.json, no automatic retry');
  return summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runSweep().then(summary => console.log(`Rendered ${summary.rendered} readonly route patterns; actual pixel review still required`)).catch(error => { console.error(error.message); process.exitCode = 1; });
