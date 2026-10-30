import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevelopmentFrontend } from '../e2e-admin-readonly/support/frontend-process.mjs';
const cwd = fileURLToPath(new URL('..', import.meta.url));
export function identities(report, requirePassed = false) {
  const out = [];
  function visit(suite) {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) {
      if (requirePassed && (test.status !== 'expected' || test.results?.length !== 1 || test.results[0].status !== 'passed')) throw new Error('Original test did not pass exactly once');
      out.push(JSON.stringify([spec.file, spec.title, test.projectName]));
    }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report.suites || []) visit(suite);
  if (report.errors?.length || new Set(out).size !== out.length) throw new Error('Report errors or duplicate test identities');
  return out.sort();
}
export function verifyPartition(baseline, first, second) {
  if (baseline.length !== 60 || first.length !== 52 || second.length !== 8 || new Set([...first, ...second]).size !== 60 || JSON.stringify([...first, ...second].sort()) !== JSON.stringify([...baseline].sort())) throw new Error('Exact original60 partition required:52+8, no overlap');
}
export function phaseArgs(phase, list = false) {
  return ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.functional-phases.config.mjs', ...(phase === 2 ? ['--project=browser-journeys', '--no-deps'] : []), ...(list ? ['--list', '--reporter=json'] : ['--reporter=line,json'])];
}
function execute(args, env, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    let output = ''; if (capture) child.stdout.on('data', data => { output += data; });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 && !signal ? resolve(output) : reject(new Error('Functional process failed; no retry or next phase')));
  });
}
export async function runPhases(env = process.env, dependencies = {}) {
  const run = dependencies.execute || execute, start = dependencies.start || startDevelopmentFrontend;
  if (env.CI !== 'true' || env.QC_BROWSER_FIXTURE !== '1' || !env.BROWSER_FIXTURE || env.NODE_ENV === 'production') throw new Error('Explicit isolated development CI fixture required');
  const url = new URL(env.E2E_BASE_URL || 'http://localhost:3000');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '3000') throw new Error('Expected loopback fixture frontend');
  const directory = env.BOS_FUNCTIONAL_EVIDENCE;
  if (!directory) throw new Error('Explicit fresh evidence directory required');
  mkdirSync(directory, { recursive: true });
  if (readdirSync(directory).length) throw new Error('Evidence exists; refusing implicit rerun');
  const summary = { original_cases: 60, completed: 0, phases: [], runtime: 'development', root_cause_proven: false, diagnostic_caps_unchanged: true };
  const save = () => writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  save();
  try {
  const baseline = identities(JSON.parse(await run(['node_modules/@playwright/test/cli.js', 'test', '--list', '--reporter=json'], env, true)));
  const plans = [];
  for (const phase of [1, 2]) plans.push(identities(JSON.parse(await run(phaseArgs(phase, true), { ...env, BOS_FUNCTIONAL_PHASE: String(phase) }, true))));
  verifyPartition(baseline, ...plans);
    summary.preflight_verified = true; save();
    for (const phase of [1, 2]) {
      const phaseDirectory = path.join(directory, `phase-${phase}`); mkdirSync(phaseDirectory);
      const report = path.join(phaseDirectory, 'results.json');
      const phaseEnv = { ...env, BOS_FUNCTIONAL_PHASE: String(phase), ADMIN_SWEEP_RUNTIME: 'development', PLAYWRIGHT_JSON_OUTPUT_NAME: report };
      let frontend;
      try {
        frontend = await start({ env: phaseEnv, directory: phaseDirectory, batch: phase, emit: event => appendFileSync(path.join(phaseDirectory, 'lifecycle.ndjson'), JSON.stringify(event)+'\n') });
        await run([...phaseArgs(phase), `--output=${path.join(phaseDirectory, 'test-results')}`], phaseEnv);
        const actual = identities(JSON.parse(readFileSync(report, 'utf8')), true);
        if (JSON.stringify(actual) !== JSON.stringify(plans[phase - 1])) throw new Error('Actual phase identities differ from original manifest');
        summary.phases.push({ phase, passed: actual.length }); summary.completed += actual.length; save();
      } finally { if (frontend) await frontend.stop(); }
    }
    if (summary.completed !== 60) throw new Error('Incomplete original suite');
    summary.success = true; save(); return summary;
  } catch (error) { summary.success = false; summary.failure = 'phase_or_cleanup_failed_no_retry'; save(); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runPhases().then(result => console.log(`Original functional suite: ${result.completed}/60 passed across52+8 phases`)).catch(error => { console.error(error.message); process.exitCode = 1; });
