# Local owner review setup — 22 October 2026

## Preserved environment

- Checkout: `/workspace/scratch/443abd2a276c/business-os-fixes`, local `develop` only. No branch push, merge or deployment is authorized.
- Runtime/evidence: `/workspace/shared/business-os-qa/qc-2026-10-22`.
- PostgreSQL 17.11 is extracted from official Debian packages in `runtime/postgres`; data is in `runtime/pg-data`, not `/tmp`.
- `business_os_qc20261022` contains freshly created synthetic browser companies and **Local QA Review 2026**. `business_os_qc20261022_final` retains the earlier checkpoint fixtures. The closure runs use separate `business_os_qc20261022_final2` and final complete-rerun `business_os_qc20261022_final3` (seeded upgrade paths), plus `business_os_qc20261022_empty2` (fresh migration path). Do not reset these databases or the review company.
- The former October 20 temporary database no longer existed. This is a reconstructed October 22 fixture, not a claim that old live processes or old test data survived.

## Start and stop in the same cloud-local execution environment

Run from a terminal in this environment:

```sh
QC_ROOT=/workspace/shared/business-os-qa/qc-2026-10-22
"$QC_ROOT/with-postgres.sh" bash "$QC_ROOT/run-review.sh"
```

The combined runner starts PostgreSQL, FastAPI and the built Next frontend together. It binds only to loopback: PostgreSQL 55432, API 8000 and frontend 3000. It was smoke-tested with successful frontend login-page and API health responses. Stop the foreground command normally when review is finished; its traps stop the local services while retaining data.

These loopback addresses are **not a public preview**. An interactive desktop/browser connection from a different namespace is not verified. Do not claim the user can connect merely because the health checks pass, and do not add public tunnels or change network security settings. The browser tests run in the same combined execution environment.

No startup reseeding occurs. Select **Local QA Review 2026** in the owner workspace selector. Existing synthetic credentials are intentionally omitted from reports. Do not reuse production credentials, copy production environment files, or connect real providers. Backend networking is guarded to loopback; outgoing mail/payment integrations remain disabled.

## Seed and expected values

The first fresh seed was executed on 22 October with `backend/scripts/seed_qa_review.py`; the local `seed-review.sh` imports the existing synthetic test password without printing it. A second call returned “Already seeded” and preserved the company. Never overwrite manual edits to make a test green.

Direct PostgreSQL readback is retained in `joint-review-seeded-values.json`. At 22 October: recognized revenue/collected 1,200, AR 0; cash 5,890; stock 10 × 6 = 60; AP 60; direct expense 310; profit 890; assets 5,950; opening equity 5,000. Draft invoice 47.25 and cancelled invoice 24.68 retain history but do not recognize revenue/AR. Payroll 2,000 remains draft. Approved leave is 23 October, pending leave 26 October, remaining balance 18.

Use `joint-review-checklist.md` for human PASS/FAIL recording. Automated passes do not complete that manual checklist.

## Reproducing automated checks

- Existing backend verifiers plus `verify_qc_owner_reporting.py` and `verify_qc_order_milestones.py` run against isolated local PostgreSQL with `ENVIRONMENT=test`. TestClient fixtures use rollback where documented.
- The combined browser runner seeds six isolated synthetic owner actors for the base, general owner, master-data, HR/project, finance and notification/auth suites. Use the runner rather than sharing a single login across all 44 tests. This prevents the expanded suite from exhausting the normal per-account login limit; production auth limits are unchanged.
- The retained `run-browser.sh` seeds only synthetic E2E accounts, runs Chromium against real local services and retains result JSON. It may invalidate test-account sessions, so do not run it during manual review. Business fixtures use new isolated companies rather than resetting the readable review company.
- `with-postgres.sh` serializes all local DB/service use. Do not start another PostgreSQL process on the same data directory.
- Runtime binaries, databases, credentials and browser traces are not in the portable source archive. Restore dependencies from the lockfiles/official vendors if the environment is replaced, migrate a new local database, then reseed explicitly. The backup contains source, tests and text evidence, not a guaranteed working remote desktop.

## Closure verification

The 44-test integrated browser run passed, consisting of 34 real local-service journeys and 10 mock-backed UI checks. The final complete backend aggregate passes all93 commands on a fresh final3 database. Earlier provenance is retained: the initial aggregate passed92 and rejected the statement verifier on its obsolete database-name guard; the corrected focused verifier then passed on final2 before the full final3 rerun. Components7, build, TypeScript and lint errors0 also pass. The full160 original-case disposition is144 bounded passes,4 partial-scope cases with passing owner portions,11 excluded personal cases and1 unresolved proration-policy case. These are different counting units and must not be summed.

The retained review fixture was read back unchanged after closure testing; the combined stack passed readiness again and stopped normally. See the final report for all seven new defects, including recurring expense posting and the historical-data audit required before any separately authorized live release. Runtime scripts and the loopback network guard are included in the evidence backup; they contain environment-specific paths and must be adapted deliberately after workspace replacement.
