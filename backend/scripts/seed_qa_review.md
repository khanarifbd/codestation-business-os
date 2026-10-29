# Local manual QA review fixtures

Run only against a migrated, disposable local development PostgreSQL database. The seeder refuses remote databases, production environments, URL query overrides, and a missing explicit local opt-in. It does not connect to email, payment providers, or deployed services.

From `backend`, supply `QA_REVIEW_LOCAL_ONLY=1` and a private `QA_REVIEW_PASSWORD` (at least 16 characters) through the environment, then run `PYTHONPATH=. .venv/bin/python scripts/seed_qa_review.py`. Do not put passwords into source, shell history, screenshots, logs, or shared reports. On the review workspace, wrap that command with `/workspace/shared/business-os-qa/local/with-postgres.sh` to serialize the temporary PostgreSQL instance with regression tests. The database URL is read from the local, untracked `.env` or environment.

The script creates `Local QA Review 2026` (USD, UTC), reusing `E2E_EMAIL` (default `e2e-owner@example.com`) without resetting its password. Newly created owner/employee/HR users use the environment password. Existing user passwords are preserved. Employee: `qa-review-employee@example.com`; HR manager: `qa-review-hr@example.com`. All contacts are fictional `@example.com` addresses.

Seeding is atomic and idempotent: an existing reserved company slug causes a no-op, preserving manual-review edits. Failed runs roll back. Use a fresh disposable database to reset fixtures rather than deleting user edits. Never run database resets against shared or deployed systems.

Review the date printed by the script (the execution date):
- USD 1,200 paid invoice, linked to an order whose project uses order-only attribution; project direct cost USD 250, expected project margin USD 950.
- Draft USD 47.25 and cancelled USD 24.68 invoices excluded from operational revenue.
- Cost-only client with GBP preference but USD 60 actual expense; reporting currency remains USD, profit is -60, margin is unavailable.
- 10 stock units at USD 6, a received unpaid purchase and corresponding USD 60 inventory payable. Inventory and finance operations use application posting paths, with journals and account movements.
- Three fictional leads, vendor, warehouse, employee project assignment and task.
- Annual leave allowance 20 days, separate one-day approved and pending requests; a USD 2,000 salary profile and draft payroll run. Nothing is approved or paid externally.

This is review data, not a claim that all QA scenarios are covered by automated tests. The regression scripts remain the authoritative repeatable checks for individual fixes.
