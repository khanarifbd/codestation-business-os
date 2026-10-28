# QA V2 remediation — 20 October 2026

Branch: `develop`. Source baseline: `73276a615aaaa6e4dce3a145390c1aa482644cf9`.
No production database, email delivery, payment provider, merge to main or deployment is part of this work.

## Issue coverage

| QA | Change | Regression evidence |
|---|---|---|
| 001 | Password input has its own accessible label; visibility button has a separate name. | Node actual-component render and browser semantic login/reveal. |
| 002 | Inventory receipts create linked settlement-capable Payables without another expense/AP journal. Receipt balances synchronize on settlement and reversal. | PostgreSQL partial/final/overpayment/reversal/re-payment; tax deduplication; legacy migration. |
| 003 | Operational reports explicitly say **Operational margin**, explain included/excluded sources and link to accrual P&L. Direct income is visible. | Reporting calculation tests; UI/type/build checks. This is explicit alternate-basis labeling, not a change to accrual GL. |
| 004 | Order-linked invoices inherit project attribution unless an explicit invoice project overrides it. | Both fast and legacy reports; explicit override, collection and tenant/date filters. |
| 005 | CRM query applies after debounce and stale responses cannot replace newer results. | Browser impossible-query, racing-query and clear flows. |
| 006 | Clients query loads independently of bootstrap and handles stale list/pagination responses. | Browser impossible-query, racing-query and clear flows. |
| 007 | Cost-only clients appear with zero revenue and negative margin, including non-direct categories and expense currencies. | PostgreSQL cost 6 / profit -6, filtered and unfiltered. |
| 008 | Inventory gain no longer collides with FX account 4910; custom code collisions receive an unused suffix; existing system-key identity is retained. | PostgreSQL +1/-1 valuation, movements/journals, overdraw; legacy/custom account compatibility. |
| 009 | Pending/approved leave overlap is rejected across types; stable employee locks serialize creation/approval. | Concurrent create/create and approval/create; balance preservation, cancellation and rejection. |
| 010 | Draft payslip footer explicitly says it is not an approved record. | Actual component rendering for draft, approved, paid and cancelled. |
| 011 | Payroll, numbering and asset errors use the shared structured-error formatter. | Field/message arrays, object errors and fallback unit tests. |
| 012 | Invoice mutation success refreshes the independent client preview. | Browser draft edit, issuance and receipt reversal, without navigation/reload. |
| 013 | Draft and cancelled invoices are excluded from recognized report invoice/receivable totals. | PostgreSQL recognized totals and confirmed/reversed collections. |
| 014 | Only recognized tax identifier types populate new seller Tax ID snapshots. | Tax/custom/primary/tenant-isolation regression; applied to direct, quotation and order generation. Historical document snapshots are intentionally unchanged. |
| 015 | Cancelled/draft invoices are excluded from collection worklists; cancelled due display is zero. | Backend/internal/client serialization, unit eligibility and browser Outstanding filter. Journal history is not rewritten. |

## Migration and financial safeguards

`0095_inventory_payables` adds a unique nullable purchase-receipt link and backfills existing received obligations. It does **not** post another journal. New receipts and payments use the existing posting and audit controls. Tax reports exclude linked payable rows because purchase receipts already carry that tax.

The migration's downgrade refuses to discard a linked subledger with payments. Existing account IDs/history are preserved. Apply migrations as part of a separately authorized release after backup and review; this branch is not deployed.

## Reproducing checks

Use an isolated PostgreSQL database and synthetic settings only. Follow the root README to install backend/frontend dependencies. All normal CI checks remain enabled; CI now also includes:

- `python scripts/verify_inventory_qa_regressions.py`
- `python scripts/verify_inventory_payables_migration.py` (creates/removes a uniquely named local test database; requires CREATEDB)
- `python scripts/verify_reporting_qa_regressions.py`
- `python scripts/verify_qa_hr_leave.py`
- `python scripts/verify_qa_invoice_ux.py`
- `ENVIRONMENT=test python scripts/verify_qa_document_downloads.py`
- `node --test tests/*.cjs` in frontend
- Playwright specs `qa-search-accessibility.spec.mjs` and `qa-invoice-preview.spec.mjs`

Full backend CI must run in its documented order because some existing scripts share the `Existing Tenant Fixture`. The new financial/reporting regression scripts use independent rollback fixtures. Browser tests use a local seeded login; the five new UI regression scenarios mock only synthetic business responses. The original critical journey continues to use the real local API.

Run the browser suite with consistent `PUBLIC_APP_URL` and `E2E_BASE_URL` (both `http://localhost:3000`) so WebAuthn relying-party validation and session-cookie checks match. Repeated local test runs can exhaust the real login limiter; start with a fresh test database, rather than weakening application security. The passkey test uses a unique label so reruns do not match old fixture credentials.

## Previously blocked / partial cases

- HR29: local service-level self-approval denial and independent-manager approval verified, including persisted 480-minute attendance correction.
- HR10: synthetic PDF upload and actual streamed file bytes verified for manager/self; unrelated employee denied.
- PRJ15 and SET06: synthetic PDF upload and actual HTTP attachment body/header verification. This is backend download coverage, not certification of the original live browser download environment.
- CLI07: search and status behavior covered by the search fix and local browser regression.
- HR22 remains a **policy question**: half-month payroll still uses the configured monthly amount. No automatic proration requirement was established. Calendar-day leave counting and pending-overdraft policy are likewise unchanged.

## Review environment and limits

The local PostgreSQL instance, app dependencies, test logs and synthetic fixtures were retained in the authorized cloud workspace. `backend/scripts/seed_qa_review.py` prepares a dedicated review company; see its companion instructions. SMTP and Stripe live collection are disabled, and regression Python networking is restricted to loopback.

The cloud shell runner can run PostgreSQL, API, frontend and Playwright together. Its loopback network is isolated from the interactive cloud desktop browser, so an interactive user-facing localhost review link is **not** established. Do not present that URL as accessible or deploy a public substitute without authorization. User review is still required before any live release.

Automated checks are not a claim that the original 160 live scenario groups were all replayed through the UI, nor a production-readiness guarantee. Existing lint warnings are separate from zero-error lint completion. No real payout, real external email or production data migration was performed.

## Local verification result

- Fresh PostgreSQL 17.11 database: all 82 backend CI-equivalent commands passed, including compilation, all existing module/security/accounting/tenant checks and the six new QA checks.
- Separate migration fixture: legacy upgrade passed with unchanged source journal count.
- Frontend: production build and TypeScript passed; lint completed with zero errors and 168 existing-style warnings.
- Node component/validation/eligibility tests: 7 passed.
- The manual review seed validates its financial expectations before commit and preserves edits on subsequent runs.
- Final integrated Chromium suite: **13/13 passed**, including original critical journey, print/PDF, passkey/session tests and new search/preview/collection-filter scenarios. Invoice reversal screenshot confirms paid USD 80 and due USD 120 immediately, without reload.
- Review fixture seeded and idempotent rerun/production-refusal safeguards passed.
