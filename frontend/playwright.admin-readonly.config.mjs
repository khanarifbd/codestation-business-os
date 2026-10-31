import base from './playwright.config.mjs';

// Separate disposable QA process. Existing60-journey config is unchanged.
const config = {
  ...base,
  use: { ...base.use, trace: 'off', video: 'off', screenshot: 'off' },
  reporter: [['line']],
  testDir: './e2e-admin-readonly',
  timeout: 120_000, // Four readonly routes/case, bounded30s navigation each.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  projects: [{ name: 'admin-readonly', testMatch: '**/route-sweep.spec.mjs' }],
  outputDir: process.env.ADMIN_SWEEP_OUTPUT || './test-results-admin-readonly',
};

export default config;
