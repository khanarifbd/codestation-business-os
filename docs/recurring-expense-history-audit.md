# Recurring expense historical audit (inspection only)

## Scope and authorization

This is a procedure, not evidence that production was audited or repaired. Development verification used only the separate local synthetic PostgreSQL database on port 55433. Production credentials, production data, and the review database/browser on port 55432 were not accessed. A historical live-data audit remains **not performed** and must run only against an explicitly authorized database or approved snapshot.

No migration, backfill, posting, synchronization, rate-provider request, scheduler run, or automatic correction is included. No business policy is chosen. Do not run posting helpers to make the report pass: that can duplicate cash, misdate journals, or alter closed periods.

## Read-only execution

From `backend`, use the installed virtual environment. Set `AUDIT_DATABASE_URL` securely to an authorized PostgreSQL read-only role/snapshot; do not paste credentials into reports or shell history. The command refuses to fall back to application settings, `.env`, or `DATABASE_URL`.

```
.venv/bin/python -m scripts.audit_recurring_history --organization-id EXACT_ORGANIZATION_UUID
```

It emits JSON and exits 0 for no findings or 1 for findings. Connection/selection/query failures are errors, not passes. An empty attributed set does not establish historical correctness. The command starts a PostgreSQL repeatable-read, read-only transaction before all data reads, uses a 60-second statement timeout, and never invokes application startup or mutation helpers. Read-only database credentials provide additional defense. Each query is scoped to the exact organization; no newest-tenant/name-prefix selection is used. Use an approved offline snapshot for large tenants: this version loads the organization's relevant tables into memory.

Retain the report alongside the database snapshot/version, application commit, run time and operator authorization, without credentials. Do not publish business data or raw database exports.

## What is checked

- Candidate expense IDs from retained successful manual/automatic recurring activity logs, schedules' latest-expense pointers, and legacy recurring cash-description markers. The report preserves the evidence type and labels description matching as heuristic.
- Posted candidates: missing or duplicate source-linked expense journals; balanced positive journal totals; journal date; original-currency expense and mapped cash legs; stored conversion arithmetic and functional-currency unit rates.
- Exactly one matching expense cash outflow with the expected account, currency, amount, direction and date.
- Negative or over-total included tax.
- Missing attributed expenses and nonposted candidates requiring reversal review.

A duplicate journal source is prohibited by the current database unique index. The analyzer still detects duplicates in historical/imported snapshots; the demonstration tests this branch in memory without disabling any database constraint.

## Reconciliation boundaries and next steps

There is no durable recurring schedule foreign key on every expense. Latest pointers are overwritten, logs can be missing, and descriptions are not definitive provenance. The result is a candidate audit, not a completeness certificate. Missing records, audit retention gaps and manual journals without source IDs need independent evidence. Zero findings does not prove every recurring expense was found.

The checks compare the recorded operational cash movement to the recorded journal cash leg in the original account currency. They do not verify bank statements, external settlement, correct historical FX quotes, whole-account opening balances, overdraft timing or which concurrent request consumed available funds. A negative balance alone cannot prove the earlier concurrency bug. Current category classifications can change, so the audit checks expense-account type but does not infer the historical category policy. It does not repair tax classification.

Voided/reversed expenses require a separate full original/reversal/repost-chain audit; findings explicitly request review rather than asserting that no journal should exist. Functional-currency transitions require reconciliation by journal currency and effective period, not summing unlike base currencies. Duplicate or unrelated manual journals cannot be inferred from memo similarity alone.

For each finding, independently match expense, recurring provenance, cash transaction, journal/lines, any reversal, historical rates and closed-period controls. Determine whether cash already moved before proposing any adjustment. Have the responsible accountant approve a specific correction plan (date, accounts, FX, tax and reversal treatment) and separately authorize execution. Re-run this audit and the broader accounting-integrity audit afterward; neither command is a repair tool.

## Synthetic verification

`backend/scripts/verify_qc_recurring_history_audit.py` is restricted to `ENVIRONMENT=test`, localhost port 55433 and database `business_os_qc_expanded20261022`. It preserves a clearly labeled synthetic organization because independent read-only connections must observe committed fixture data. It does not modify existing organizations.

The verifier uses the real migrated schema for one valid expense and four malformed cases: cash without GL, mismatched cash, mismatched GL cash original amount, and included tax exceeding the expense. It also tests copied in-memory snapshots for source duplicates, missing cash, unbalanced journals and void-review behavior. It confirms PostgreSQL rejects even an UPDATE matching zero rows inside a read-only transaction.
