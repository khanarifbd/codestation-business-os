# Business OS owner quality control report

## 22 October 2026

Prepared for the Business OS owner. Report date uses Bangladesh time, Asia/Dhaka. Synthetic fixture dates and currencies are stated separately. This supersedes the earlier 11-page 22 October checkpoint report with the expanded from-zero owner-local audit.

Tested product revision: 21e4f2183402c4f7fe056614eec64331501a077e. All final product and regression sources are represented by that commit; later documentation-only commits do not change the tested code. No remote branch was pushed, merged or deployed. Historical temporary PostgreSQL data was lost; new isolated PostgreSQL 17 databases and synthetic fixtures were reconstructed, rather than described as the unchanged historical database.

## Executive summary

The expanded audit now maps every one of the original 160 case IDs to a specific fresh bounded invariant or an explicit exclusion or policy boundary. Its final dispositions are 144 bounded PASS cases, 4 mixed-scope cases with owner-local PASS, 11 Excluded and 1 Policy-blocked case. These are coverage dispositions, not a claim that the original historical records and exact entire 160-case sequence were replayed. The four mixed-scope cases passed their owner-local portions while external or personal portions remain excluded, giving 148 bounded owner-local portions with passing evidence.

Seven unique new product defects were reproduced and narrowly fixed: a missing payable reversal marker, an obsolete order invoice link, missing recurring-expense journals, omitted partially paid Collections balances, concurrent automatic overspending, an incorrect recurring automation status, and inconsistent recurring included-tax guards. Five findings are additional to the earlier two UI defects. Two were High severity and five were Medium. Exact before-and-after evidence is retained. The recurring fixes are prospective; no historical financial records were silently repaired.

Final backend verification: a complete final aggregate passed all 93 of 93 commands with 0 failures and process exit 0 on a new isolated final3 PostgreSQL database. The earlier 92/93 run and successful focused guard-corrected rerun remain in the provenance; they are not added to this total. Final browser verification: 44 of 44 passed in 175.36 seconds, with 0 skipped, 0 unexpected and 0 flaky results: 34 actual application/authentication/owner tests and 10 mocked business/print tests. The 7 component tests, production build and TypeScript checks passed. Lint completed with 0 errors and 168 warnings. Backend commands, browser tests and original case dispositions are different denominators and must not be added together.

This is a local owner/admin QC result, not portal acceptance or a production-readiness certificate. Joint human review, payroll/leave policy decisions and a separately authorized read-only integrity reconciliation of historical recurring expenses remain release prerequisites. No production database, real payment, remittance, provider transaction or actual email delivery was used. No user-accessible shared interactive preview has been verified.

### বাংলা সংক্ষিপ্তসার

শুরু থেকে নতুন লোকাল ডেটা দিয়ে মালিকের কাজগুলো বিস্তৃতভাবে পরীক্ষা করা হয়েছে। আগের ১৬০টি কেসের প্রতিটির জন্য কী যাচাই হয়েছে, কী বাদ আছে এবং কোথায় নীতিগত সিদ্ধান্ত দরকার তা আলাদা করে দেখানো হয়েছে। নতুন সাতটি সমস্যা পাওয়া গেছে এবং সংশোধনের পর নির্দিষ্ট পরীক্ষায় যাচাই করা হয়েছে; এর মধ্যে recurring expense-এর হিসাব ও একই সঙ্গে খরচ করার ঝুঁকিও ছিল।

চূড়ান্ত ব্রাউজার পরীক্ষায় ৪৪টির সবগুলো পাস করেছে। নতুন আলাদা ডেটাবেসে Backend-এর সম্পূর্ণ চূড়ান্ত পরীক্ষায় ৯৩টির সবগুলো পাস করেছে। আগের ৯২/৯৩ ফল এবং test database guard সংশোধনের ইতিহাসও সংরক্ষিত আছে। ১৪৪টি কেসের নির্দিষ্ট সীমিত যাচাই পাস; আরও ৪টির owner-local অংশ পাস, ১১টি scope-এর বাইরে এবং ১টি policy সিদ্ধান্তের অপেক্ষায়। পুরোনো ডেটাবেস অক্ষত ছিল এমন দাবি নেই। কোনো live payment, email, push, merge, deployment বা production পরিবর্তন করা হয়নি। যৌথ মানব-রিভিউ বাকি; আপনার ব্রাউজার থেকে খোলা যায় এমন shared preview এখনো যাচাই করা হয়নি। পুরোনো recurring expense-এর অসম্পূর্ণ journal থাকলে আলাদা অনুমোদিত read-only reconciliation দরকার; এই কাজে backfill করা হয়নি।

## Scope and interpretation

### Included

Owner/admin CRM and Clients; catalog, suppliers, warehouses and stock; quotations, orders, project handoff and execution; invoices, collection, correction and statement screens; expenses and recurring expenses; local capital, loan and asset bookkeeping; payroll and owner HR administration; notifications; company settings, audit filters and owner documents. All business fixtures are synthetic. Cash, capital, loan and payment actions in this report are internal test-ledger entries, not transfers of real funds.

### Excluded

Client and employee portals, personal My Work and My HR/self-service journeys, real invitation or verification email delivery, invitation acceptance, real payroll payout, investor funding/payout, payment providers, tax remittance, production operations and release approval. Baseline supporting backend tests do not expand the owner-local scope. A local email-disabled signup verifies token handling, not real mailbox ownership or delivery.

### Status and evidence definitions

PASS means only the stated bounded assertion was executed successfully. Historical failures, their fixes and their final retests are distinct observations. Owner PASS identifies a mixed-scope case with a passing owner-local portion and an explicitly excluded remainder. Excluded is not a product failure. Policy means a business convention is not agreed; repeatedly observing current behavior does not settle whether it is correct.

| Level | What the evidence proves | Boundary |
|---|---|---|
| B real | Actual Chromium, Next proxy, FastAPI and PostgreSQL | Native UI actions are distinguished from real API fixture setup/readback. |
| B mock | Chromium with synthetic domain responses | Rendering and controlled races only; not real posting or persistence. |
| H app | Registered authenticated application HTTP routes with actual permissions and PostgreSQL | Isolated database dependency/rollback; not a TCP browser journey or application lifespan. |
| D PG | Direct domain/service calls and independent PostgreSQL invariants | Not native UI or authentication issuance. |
| M | Empty-database and upgrade migration invariants | Isolated local migration, not production. |
| R and S | Rendered components, unit checks or source inspection | Cannot alone establish an integrated business journey. |

## Final execution and coverage

The earlier 86-command backend and 22-test browser checkpoints are retained with their setup-correction provenance, but are superseded as final aggregate summaries. They are not extra tests to add to the closure results.

| Verification | Final result | Interpretation |
|---|---|---|
| Backend commands | 93/93 PASS in one final aggregate; 0 failures; process exit 0 | Fresh final3 PostgreSQL database with seeded 0008-to-head upgrade; separate empty-schema/migration checks; mixed H app, D PG, M and source checks. |
| Browser suite | 44/44 PASS in 175.36 seconds; 0 skipped, unexpected or flaky | 34 real application/authentication/owner tests; 10 mocked business/print tests. No mocked-only financial posting claim. |
| Components | 7 of 7 PASS | Actual component/unit assertions, not seven full user journeys. |
| Build and TypeScript | PASS | Production build and separate type check completed. |
| Lint | 0 errors and 168 warnings | Warnings remain visible; this is not a warning-free claim. |
| Original case register | 144 PASS; 4 Owner PASS with exclusions; 11 Excluded; 1 Policy | Every one of 160 IDs appears in Appendix A with bounded expectation, observation and evidence key. |
| Original 15 fixed issues | Bounded behavior rechecked | Current real UI/HTTP/PG evidence in the issue matrix below; policy limits remain distinct. |
| Joint interactive owner review | Not yet completed | Restartable loopback runner is not proof that the user can open localhost. |

The original 20 October report recorded 138 PASS, 16 FAIL, 4 BLOCKED and 2 PARTIAL cases. Those historical results are unchanged. Unique defect counts also differ from case counts: one defect can affect several case IDs, and one case may reveal several defects.

### Expanded owner coverage

- Master data: native CRM fields, sources/stages, follow-up, catalog interests, conversion, client notes/documents, catalog/supplier/warehouse guards and edits, stock filters, service terms, settings and audit pagination. The audit appends 50 to 50 unique rows; it does not claim exhaustion of all history.
- Projects and HR: actual task progress and three persisted work notes/audit records; project completion locks; office and structure setup; attendance duplicates; hiring lifecycle; manager review; owner policy publication; payroll dates, eligibility, duplicate runs, negative-net guards, draft/approved wording and independent correction approval.
- Financial UX: immediate real invoice preview refresh after edit/issue/reversal; cancelled/draft exclusion; paid-invoice action removal; source-selector eligibility; readable structured validation; tax-identifier snapshots; operational versus accrual profit and cost-only clients.
- Financial integrity: protected transfers, dispatch/reversal, asset depreciation, capital/loan bookkeeping, recurring posting and two-session balance locking, retained quotation revisions, tax calculations, closed periods, statement pagination, bank reconciliation, correction/replacement receipts and same-fixture cross-statements.
- Local authentication and notifications: empty-form validation, verification-token matching and onboarding with SMTP disabled; one overdue owner-assigned task, filter controls and clearing after completion through project administration. The personal My Work deep link is excluded.

## Numerical reconciliation

Each fixture is independent. Never add values from different fixtures or compare a mutated review company with its original opening snapshot. Amounts below are in the fixture currency and rounded to two decimal places where applicable.

### Commercial quotation through payment reversal

Source: commercial-03 and the final closure aggregate; B real UI mutations with persisted API readback. This fixture uses BDT, not USD.

| Calculation | Expected | Observed |
|---|---:|---:|
| Subtotal 2 × 125 + 3 × 40 | 370.00 | 370.00 |
| Discount 10% × 250 | 25.00 | 25.00 |
| Exclusive tax 10% × 225 | 22.50 | 22.50 |
| Total 370 − 25 + 22.50 | 367.50 | 367.50 |
| First receipt and remaining due | 137.50 / 230.00 | 137.50 / 230.00 |
| Second receipt and total paid | 230.00 / 367.50 | 230.00 / 367.50 |
| After first receipt reversal paid / due | 230.00 / 137.50 | 230.00 / 137.50 |
| Income excluding tax and profit | 345.00 / 345.00 | 345.00 / 345.00 |
| Cash plus AR equals assets | 230.00 + 137.50 = 367.50 | 367.50 |
| Tax liability plus earnings equals assets | 22.50 + 345.00 = 367.50 | 367.50 |

Quotation totals survive conversion to order, project and project-origin invoice. Issuance locks the commercial snapshot. The reversal preserves both original payment records, reopens only the reversed receivable and does not reduce recognized service revenue. This browser fixture explicitly sets project_id; the order-only attribution fallback is established by the separate HTTP fixture below, not by this test.

### Inventory receipt and supplier settlement

Source: final closure aggregate, with inventory-03 preserving the earlier history-label failure. Synthetic opening cash is USD 1,000. No stock sale or cost of goods sold occurs.

| Stage | Expected due and cash | Observed due and cash | Stock |
|---|---|---|---|
| Receive 10 at USD 6 | Due 60; cash 1,000 | Due 60; cash 1,000 | 10 units; value 60 |
| Pay 20 | Due 40; cash 980 | Due 40; cash 980 | Unchanged |
| Pay final 40 | Due 0; cash 940 | Due 0; cash 940 | Unchanged |
| Reverse final 40 | Due 40; cash 980 | Due 40; cash 980 | Unchanged |
| Re-pay 40 | Due 0; cash 940 | Due 0; cash 940 | Unchanged |
| Adjustment plus 1 then minus 1 | Quantity 10 → 11 → 10 | Quantity 10 → 11 → 10 | Value 60 → 66 → 60 |

Purchase receipt and linked payable remain synchronized. Reversal restores AP and cash without re-receiving stock or duplicating expense. Payment history retains one reversed 40 and two active payments totaling 60. Overdraw is rejected and exact persisted state is unchanged. The earlier history-label check failed despite these correct accounting results. After the display fix, the full journey and history assertion passed together in the final closure aggregate.

Historical FX is D PG evidence, not this USD browser replay: EUR 60 at 1.2 carries USD 72. Paying EUR 20 at 1.4 releases AP 24, uses cash 28 and records FX loss 4. Paying EUR 40 at 1.1 releases AP 48, uses cash 44 and records FX gain 4. Transaction-date rate selection, reversal/re-payment and migration preservation are asserted in the regression suite.

### One USD dataset across reporting surfaces

Source: owner-reporting-http-01 and backend/scripts/verify_qc_owner_reporting.py. All business records are created through actual application HTTP. The only direct ORM setup is the synthetic user; final journal values are independently checked in PostgreSQL.

| Result | Expected formula | Observed |
|---|---|---:|
| Recognized and collected revenue | Order-only invoice issued and collected | 200.00 |
| Project direct cost and margin | 200 − 25 | 25.00 / 175.00 |
| Cost-only client margin | 0 − 6 | −6.00 |
| Cash and operational margin | 200 − 25 − 6 | 169.00 |
| Unpaid supplier AP | Separate ordinary bill, not cash-paid | 10.00 |
| Accrual expenses | 25 + 6 + 10 | 41.00 |
| Accrual profit | 200 − 41 | 159.00 |
| Balance sheet | Assets 169 = AP 10 + earnings 159 | 169.00 = 169.00 |
| Capital estimated share | 20% × project margin 175 | 35.00 |
| Company retained project profit | 175 − 35 | 140.00 |

The invoice has order_id but no explicit project_id. Reports, Dashboard details, Expenses profitability and Capital resolve its linked project correctly. Draft and cancelled states contribute no recognized revenue; the paid invoice contributes exactly 200. A cost-only client remains a USD row with revenue 0, cost 6, profit −6 and no percentage margin even after its preference changes to GBP.

The 10 difference between operational margin 169 and accrual profit 159 is expected: the unpaid supplier expense is recognized in the GL but is outside the operational expense source used by the alternate view. Both bases must stay clearly labeled; they should not be forced equal. Capital entitlement is an estimate only, not an investor payout or a posted liability. Reading it leaves the exact financial/audit rows unchanged.

Five tenant-A journals balance independently. A separate tenant-B invoice of 9,999 remains isolated. Anonymous and cross-tenant probes are denied and exact rows remain unchanged. The HTTP fixture rolls back its companies, users and business records, leaving the review company unaffected.

### Order staged billing without premature recognition

Source: order-milestone-http-01; a bounded H app test included in the expanded closure verification, with independent PostgreSQL conservation checks. Currency is USD.

| Calculation or control | Expected | Observed |
|---|---|---|
| Accepted quote and order | 600 + 400 × 90% × 110% | 996.00 |
| Three planned payment milestones | 30%, 40%, 30% of 996 | 298.80 / 398.40 / 298.80 |
| First milestone draft | Subtotal 300 − discount 12 + tax 10.80 | 298.80 |
| Schedule total after first draft | Source amounts conserved | 996.00 |
| Recognized revenue, AR, cash and journals | Draft only, no recognition | All zero |
| Duplicate milestone invoice | Rejected, one active draft, exact state preserved | 409; unchanged |

The accepted order retains per-line tax/discount and source payment-milestone lineage. The first draft preserves source order item links. Denied duplicate and cross-tenant requests leave all checked tenant, financial, audit and sequence rows unchanged. The synthetic owner, company and business records roll back. This does not claim final/partial settlement, cancellation or concurrency coverage for every milestone variant.

### Owner payroll and expense fixture

Source: hr-finance-01. USD synthetic opening cash 10,000; current-month period. Attendance and leave use a separate owner HR fixture.

| Calculation or control | Expected | Observed |
|---|---|---|
| Attendance hours to minutes | 7.75 × 60 = 465; 1.25 × 60 = 75 overtime | 465 / 75 |
| Approved leave and overlap | Three calendar days; duplicate overlap 409 | 3 days; 409 |
| Gross pay | 1,000 + 250.25 | 1,250.25 |
| Total deduction plus tax | 50.10 + 100.15 | 150.25 |
| Net pay | 1,250.25 − 150.25 | 1,100.00 |
| Draft payroll expense | No recognition | 0.00 |
| Approved payroll liabilities | Net salary 1,100 + other payable 150.25 | 1,250.25 |
| Cash expense and ending cash | 10,000 − 123.45 | 9,876.55 |
| Total expense and loss | 1,250.25 + 123.45 | 1,373.70 / −1,373.70 |
| Balance sheet | 9,876.55 = 1,250.25 + 8,626.30 equity | Balanced |

Owner UI creates and adjusts payroll, approves once, opens the approved payslip and posts the expense. API negative probes reject a post-approval edit and duplicate approval with 409. No payroll cash payment occurs. Full monthly salary in a half-month period remains a separate policy question and is not validated as an intended convention by this full-month test.

### Same fixture cross statement reconciliation

The final reporting fixture independently reconciles gross debit/credit activity 441 on each side and balance-sheet assets 169 = liabilities 10 + earnings 159. Gross debit/credit activity is not the same measure as the net balances of the asset, liability, expense and income categories. A separate payroll fixture uses identical cutoff dates across statements and trial balance: before recognition, expense, liabilities and trial-balance totals are 0; at period end each is 1,000. Payroll payable 874.65 plus withholding 125.35 equals 1,000, while earnings/equity are -1,000 and the accounting equation remains balanced. These final FIN28 assertions passed in closure commands 86 and 90.

The final exact FIN39 browser fixture additionally issues a taxed invoice 22, collects 5 then 17, retains both confirmed receipts and confirms the Collect action is absent before any reversal. This is separate from the BDT 367.50 commercial fixture above.

### Recurrence and tax boundary reconciliation

The authenticated extended-finance fixture verifies manual expense 4 and targeted automatic expense 3 each reduce cash and accrual profit by the same amount and create exactly one original expense_post journal. Same-key retries do not duplicate posting; a conflicting payload, paused schedule and not-due retry reject without financial mutation. Voiding restores the original cash/profit effect while preserving history.

The independent competing-recurrence fixture starts with cash 5 and two due expenses of 4. Two real application sessions wait on the same account row, then proceed. After the fix, responses are 200 and 409, ending cash is 1, and exactly one expense and one journal remain. Before the fix both returned 200 and cash became -3. This is an observed concurrency failure and retest, not source-only reasoning.

An ordinary vendor bill with subtotal 20, tax 2 at 50% recoverability and withholding 1 produces expense 21, input-tax asset 1, AP 21 and withholding liability 1. Settlements 5 plus 16 clear AP and reduce cash by 21 without another expense. Input-tax offset 1 reduces output tax 2 to 1 without cash; offset 2 rejects. Direct expense tax equal to amount 6 passes, while tax 7 against amount 6 rejects. Recurring equality 3 equals 3 passes and tax above the effective expense amount rejects across create, update, override and automatic legacy-schedule posting.

### Complete statements and the same invoice correction chain

Cash A has five movements: 80, 120, -10, -20 and -25, ending 145. Cash B has fourteen movements, incoming 247.55 and outgoing 185, ending 62.55. A separate nonzero-opening control starts 25, receives 30 and pays 10, ending 45. Registered HTTP exhausts cursor pages of size 3 and verifies exact unique row/source/date sets, ordering, full sums and independently calculated running balances. The actual UI has no separate running-balance column; no such display is claimed.

Real browser statement filters, reference search, direction/date controls and Clear are checked on Cash A. Real trial-balance controls show historical totals 0, 120 and 162 at the fixture cutoffs; ledger search leaves global totals unchanged. Journal source filters produce three reversals, three manual originals and one operational entry. A rejected closed-period reference remains absent and all seven journals return on Clear.

| Same invoice checkpoint | Paid and due or AR | Cash and advance liability | Gross trial balance each side |
|---|---|---|---|
| Issue 200 with existing advance 10 | Paid 0; due 200 | Cash 10; advance 10 | 210 |
| Prior receipt 80 | Paid 80; due 120 | Cash 90; advance 10 | 290 |
| Original receipt 120 | Paid 200; due 0 | Cash 210; advance 10 | 410 |
| Reverse that same receipt 120 | Paid 80; due 120 | Cash 90; advance 10 | 530 |
| Apply existing credit 10 | Paid 90; due 110 | Cash 90; advance 0 | 540 |
| Replacement receipt 110 | Paid 200; due 0 | Cash 200; advance 0 | 650 |

The chain retains confirmed receipts 80 and 110 and the reversed 120 record. Applied credit moves no cash; revenue remains 200. Exactly seven balanced journals include one issuance and a reversal linked to its original. Duplicate reversal, excess credit and overpayment reject with all organization-owned rows unchanged. Separate test fixtures must not be combined with these totals.

## Seven new unique product defects

High denotes a material financial integrity or core-workflow failure; Medium denotes a broken or misleading owner workflow or validation boundary. These are QC assessments. Every issue below had a reproduced before-state and a narrowly verified after-state. The final execution section records the aggregate provenance separately.

### QC22-001 Reversed supplier payment lacks a visible status

Severity: Medium. Screen: Payables payment history. Fix: b8305fc. Reproduce a stock receipt 60, payments 20 and 40, reversal of 40 and replacement payment 40. Expected: retain the old payment and visibly mark it Reversed, with active settlements totaling 60. Actual before: three cards could be misread as active payments totaling 100 although cash and AP were correct.

The fix exposes the existing reversal state read-only, shows Posted or Reversed, strikes out reversed amounts and explains exclusion from current paid totals. Inventory-03 retains the original failed marker assertion and correct financial readback. The real inventory journey subsequently passes status/history, cash, AP and stock assertions together. No historical ledger rows were rewritten.

### QC22-002 Order invoice links open an obsolete route

Severity: Medium. Screen: Order detail. Fix: e9a747d. Reproduce by clicking Open invoices in Invoice and settlement after the commercial flow. Expected: /dashboard/accounting/invoices. Actual: /dashboard/invoices, with a 404 page. Financial posting had passed; the correct sidebar remained a workaround.

Both stale links, including Business flow, now target the valid invoice workspace. Commercial-04 retains the expected/actual URL failure and 404 DOM evidence. The real browser retest asserts both entry points. This is navigation repair, not recovery of lost invoices.

### QC22-003 Recurring expenses omit accounting journals

Severity: High. Paths: manual recurring post and targeted automatic retry. Reproduce manual expense 4: cash 1,021 falls to 1,017 but accrual profit stays -33 instead of -37. Automatic expense 3 similarly moved cash to 1,018 while profit stayed -33 instead of -36. Both created expense/cash rows without the original expense_post journal.

Fix commit e9d7a03. Both paths now call the ordinary post_expense workflow. The manual route uses deferred commits and explicit-key idempotency; the shadow raw POST is removed. Post-fix real HTTP/PG verifies cash/profit deltas -4 and -3, exactly one original journal each, replay/conflict guards, pause/not-due guards and void restoration. A late historical-FX failure leaves financial rows and successful schedule advancement unchanged; automatic retry may retain only its expected failure diagnostic/audit. No unrestricted scheduler scan or historical backfill was performed.

### QC22-004 Collections omits partially paid invoices

Severity: Medium. Screen: Dashboard Collections. With a sent invoice due 24.68 and a partially paid invoice due 120, the pre-fix response showed one invoice and 24.68 instead of two and 144.68; it also omitted the overdue 120. A receipt reversal that reopened a partial balance was similarly excluded.

Fix commit 3e21ab36. The read-only query now uses collectable-state exclusions consistently: positive balances only, with draft, cancelled and paid excluded. Real authenticated HTTP/PG verifies direct pulse and overview, settlement removal, actual reversal restoration, stale legacy excluded balances, foreign-tenant isolation and rollback. Real browser Collections shows 144.68 and two invoices. Evidence: collections-before-fix.log, collections-after-fix-03.log and the financial UX suite. No migration or financial mutation was needed.

### QC22-005 Concurrent automatic expenses overspend an account

Severity: High. Reproduce two real authenticated retry requests in separate PostgreSQL sessions, each expense 4 against cash 5. Hold the account row from a third transaction until both sessions wait, then release. Before: both requests returned 200, cash -3, two expenses and two journals. Expected: serialize the balance check and permit only one expense.

Fix commit e9d7a03. The fix locks the tenant-scoped FinancialAccount row FOR UPDATE, refreshes and rechecks active status before the balance check. After: 200/409, cash 1, one expense and one original journal, with both waiting sessions independently observed. The portable concurrency regression preserves only clearly labeled synthetic records and disables its test schedules afterward. No live account was accessed.

### QC22-006 Recurring automation status reads incorrectly

Severity: Medium. Reproduce by enabling automation, then reading the general recurring list. Expected: persisted auto_post state and attempt/error diagnostics. Actual: auto_post false because the mapper omitted those fields and response-schema defaults hid the stored values.

Fix commit e9d7a03. The mapper now reads auto_post, last attempt and last error from persistence. Registered owner HTTP checks the general list after enable and the diagnostic fields; dedicated automation diagnostics remain the reference for failure state. This is serialization repair, not an authorization or posting-policy change.

### QC22-007 Recurring included tax can exceed the expense

Severity: Medium. Before: creating amount 4 with included tax 5 returned 201; reducing a valid amount 4/tax 3 schedule to amount 2 returned 200; overriding its manual posting amount to 2 also returned 200. Expected: reject tax above the effective expense amount before mutation.

Fix commit e9d7a03. Consistent validation now covers create, lower-amount update, higher-tax update, manual override and automatic posting of a deliberately synthetic legacy-invalid schedule. Valid equality 3 equals 3 remains accepted. Rejections preserve financial state; automatic legacy rejection retains only failure diagnostics/audit. Pausing an unsafe legacy schedule remains possible without forcing a financial edit. Evidence for QC22-003, 005, 006 and 007 is indexed in finance-gap-evidence.md and the final successful extended-finance/concurrency logs.

### Test harness failures are not additional product defects

The initial closure backend run passed 92 of 93 commands. Its one failure was an exact old-database-name safety assertion before the application scenario, not a product result. The strict local QC/CI database allowlist was corrected without relaxing production/remote guards, and the focused same-database rerun passed. A subsequent complete 93-command rerun on fresh final3 passed all 93 with 0 failures and process exit 0. Summed command durations were 213.19 seconds, not total migration/startup wall time. Both the failed first attempt and the focused correction remain retained; the final result is now one complete successful aggregate rather than a combination of partial runs.

Earlier browser attempts exposed rate-limit fixture sharing, missing fixture descriptions, locator ambiguity, timing expectations and test-oracle assumptions. They remain retained but are not counted as successful complete runs or extra unique defects. A client text preview also failed in a plain data:text control because the isolated browser lacked a usable font configuration; process-local existing-font configuration restored both controls and the actual preview without product changes. The normal authentication rate limiter was not weakened. The final aggregate result, rather than selectively combining passing portions of failed whole runs, determines the suite outcome.

## Recheck mapping for the original 15 issues

This matrix describes the fixed behavior, not a claim that every possible variant is exhausted. Each financial PASS has real application/PG evidence; mocked UI tests are supplementary only. The original historical issue severities remain in the original register.

| Original issue | Current bounded result | Fresh supporting evidence and boundary |
|---|---|---|
| QA-001 Password field label | PASS | Component label/reveal and real sign-in field, Show/Hide and type transition. Not a full accessibility audit. |
| QA-002 Receipt settlement | PASS | Real stock receipt and Payables partial/final settlement, reversal/re-payment, exact stock/cash/AP/journals/history. QC22-001 separately fixes the reversal marker. |
| QA-003 Profit basis confusion | PASS | Real Reports/Dashboard show operational 169 with basis text versus accrual 159; HTTP/PG explain unpaid AP 10. |
| QA-004 Order-only project attribution | PASS | Actual order-only invoice with null project_id attributes revenue 200/cost 25/profit 175 to the linked project in browser reports and HTTP/PG. |
| QA-005 CRM stale search | PASS | Real query, Enter/blur, filters, Reset/reload and exact results. Controlled delayed-response races separately use mocks. |
| QA-006 Clients stale search | PASS | Real name/code/no-match/status/reset/reload and deactivation/reactivation; controlled race remains supplementary mocked evidence. |
| QA-007 Cost-only client omitted | PASS | Actual Reports/Dashboard retain revenue 0/cost 6/profit -6; HTTP/PG retain currency-preference boundary. |
| QA-008 Stock adjustment failure | PASS | Real +1/-1 and overdraw guard; persisted stock, value and GL; direct historical-FX and account-code collision checks. |
| QA-009 Overlapping leave | PASS bounded guards | Real owner approval, HTTP 409, direct-PG cross-type/concurrent reservation checks. Personal self-service and leave-count/overdraft policy are not approved. |
| QA-010 Draft payslip wording | PASS | Actual owner draft footer says draft/not approved; approved owner view is separate. Four component states supplement it. |
| QA-011 Structured errors | PASS | Real invalid asset, payroll dates/withholding and client/invoice numbering forms show readable fields, not object text; saved state unchanged. |
| QA-012 Stale invoice preview | PASS | Actual embedded preview immediately follows draft edit, issue and receipt reversal without reload; API readback agrees. |
| QA-013 Draft or cancelled recognition | PASS | Real Dashboard/Collections/Reports and HTTP/PG exclude unissued draft/cancelled value; journal sets unchanged. Document-count semantics remain distinct. |
| QA-014 Other shown as Tax ID | PASS | Real preview excludes Other and includes recognized VAT; issued snapshots remain unchanged after live identifier changes. |
| QA-015 Cancelled invoice collectable | PASS | Real Outstanding excludes draft/cancelled, Clear restores them, cancelled due is 0 and Collect absent; HTTP/PG confirm eligibility. |

## Historical blocked and mixed cases

HR10, PRJ15 and SET06 now have actual owner-browser upload/download events, expected filenames and exact saved-byte checks. H app separately verifies attachment/MIME and anonymous, tenant and role denials. This is not certification of employee self-service or production delivery.

HR29 now includes actual independent owner-manager approval, reload removing Approve, a persisted 480-minute correction and independent PostgreSQL reviewer/source verification; payroll is unchanged. The pending subject fixture was safely prepared locally, not created through employee self-service. Retained H app evidence separately rejects requester self-review with 403 and foreign tenant access with 404 without mutation.

The four mixed cases are AUTH01, HR05, HR12 and HR13. Their local signup/onboarding, disabled-mail invitation administration, manager performance review and owner policy publication passed. External verification/invitation delivery, employee self-review and personal policy acknowledgement remain excluded. HR22 is still policy-blocked: a half-month draft using a full monthly salary is an observation, not an agreed proration rule.

## Remaining decisions and release boundaries

1. Payroll proration: choose calendar-day, working-day or no automatic proration, including join/leave dates, rounding and effective-date rules. HR22 remains unresolved.
2. Leave conventions: choose calendar versus scheduled working days, weekends/holidays and pending-request reservation/overdraft rules. Current guards and restoration are tested without declaring those conventions correct.
3. Historical recurring integrity: before any future live release, separately authorize a read-only reconciliation for posted expenses missing expense_post journals. The existing accounting integrity endpoint identifies this class. Review source, cash, tax, currency and closed periods before any separately approved repair. No live audit or backfill occurred here.
4. Coverage limits: fresh bounded equivalents replace historical IDs and amounts where explicitly stated; the exact original whole financial event sequence and original absolute totals are not claimed. No blanket mobile, cross-browser, load, penetration or full accessibility certification.
5. Review access: the isolated runner can restart PostgreSQL/API/frontend and pass loopback readiness. No user-accessible interactive localhost or shared cloud preview is verified. Do not treat a restart command as a working review link; no public tunnel or deployment was created.
6. Data retention: the old temporary runtime/database was lost. Current reconstructed fixtures, retained logs and snapshots do not prove the historical database survived unchanged. The final complete backend aggregate uses a separate fresh final3 database.
7. Release authorization: no push to any branch, merge, deployment, production migration, real mail, money movement or provider operation. Local PASS is not permission to release. Remote main and develop were both rechecked at 05:01:22 UTC (11:01:22 Bangladesh time) and remained at 73276a615aaaa6e4dce3a145390c1aa482644cf9. Later product changes need their relevant regression checks.

## Joint owner review

Use a dedicated synthetic review company, USD and UTC. Review dates and the fixture identity must be explicit before comparing totals. Do not use the rolled-back HTTP fixture as though it were still present. The reconstructed review company Local QA Review 2026 was seeded successfully and independently read back from PostgreSQL. Its reporting date is 22 October 2026, superseding the historical 20 October fixture. The updated joint-review checklist and 2026-10-22-local-review.md describe the current dates and restart procedure. The initial seeder import-path failure was a harness error and was corrected without changing product behavior. A second seed run preserved existing data/manual edits, and the combined local review stack passed loopback readiness. After the expanded closure run, independent readback confirmed the retained review snapshot was unchanged. Combined loopback frontend/API/PostgreSQL readiness passed again and processes stopped normally; data and restartable runtime were retained. This is not a currently running shared review session. Evidence: closure-review-snapshot.log and closure-review-readiness.log. The correct startup invocation uses with-postgres.sh bash run-review.sh; an earlier non-executable shell invocation was corrected without permissions or network changes.

### Reconstructed review opening values

Source: review-seed-final.log, independent joint-review-seeded-values.json and the current joint-review-checklist.md for salary/reservation details. These are the new review company's observed opening values, not the historical database carried forward.

| Review item | Observed opening value |
|---|---|
| INV-00001 paid order-linked service | USD 1,200 total; paid 1,200; due 0 |
| INV-00002 draft | USD 47.25; no recognized revenue or AR |
| INV-00003 cancelled | Historical stored balance 24.68; collectable API/UI due must be 0 |
| Cash and stock | USD 5,890 cash; 10 units × 6 = 60 stock |
| AP and AR | USD 60 open supplier AP; AR 0 |
| Income and expenses | Revenue 1,200; project cost 250; other expense 60 |
| Profit and balance sheet | Profit 890; assets 5,950 = AP 60 + equity 5,890 |
| Project QA-PROJECT-001 | Revenue 1,200; direct cost 250; margin 950; in progress |
| Fictional Cost-only Studio | Revenue 0; cost 60; profit -60; GBP preference does not remove USD cost |
| PAY-00001 | Draft; salary USD 2,000 per seeded checklist; no approved-payroll journal |
| Leave dates | Approved 23 October 1 day; pending 26 October 1 day; allowance 20; current reservation remaining 18 |

Cancelled invoice historical storage is intentionally preserved. Its raw stored 24.68 is not permission to collect it and must not be confused with the zero collectable display. Once reviewers post a settlement or another mutation, recalculate the expected deltas rather than treating these opening values as fixed.

### Proposed review order

1. Record opening cash, AP, AR, stock quantity/value, earnings, invoice states and reporting period. Confirm email delivery and live collection remain disabled.
2. Inspect the newly fixed UI behaviors first: order links reach the valid invoice workspace and reversed Payables history is unmistakable while preserving its original record.
3. Reconcile receipt 60, partial 20, final 40, reversal 40 and re-payment 40 across purchase, payable, cash, GL and history. Record deltas after each step rather than repeatedly comparing to the opening snapshot.
4. Review quote/order/project/invoice lineage, discounts/tax, receipt reversal and immediate invoice/preview state. Keep BDT commercial evidence separate from USD review fixtures.
5. Compare Dashboard, Reports, Expenses and accrual statements for one exact period. Explain any operational/accrual difference by source, not by forcing numbers equal. Inspect cost-only and order-linked project rows and non-posting Capital estimates.
6. Review CRM query/reset/reload, cancelled/draft collection exclusions, tax identifier snapshots, payroll draft/approved wording and invalid-form messages. Human observations remain unfilled until performed.
7. Upload and download a synthetic company, HR and project document. Confirm the saved content/filename and owner permissions, without exposing private employee documents or entering portals.
8. Review recurring cash/profit/journal equality and the concurrent balance guard in isolated fixtures; confirm Collections includes partially paid due amounts. Do not run recurrence against live data.
9. Resolve payroll proration, leave-day counting and leave reservation/overdraft policy and record any remaining acceptance criteria. Release, migration, merge, push and deployment require a separate decision; this document authorizes none of them.

## Evidence index

Evidence identifiers below are relative references in the retained local QC package, not public URLs. The report does not include credentials, verification tokens, JWTs, cookies or raw authenticated traces. The complete original160-gap-map.json preserves case-by-case source references and historical outcomes. Appendix keys identify the strongest named fresh evidence, not every related baseline script.

| Key | Retained evidence and meaning |
|---|---|
| BE | closure-final-regression/results.json and closure-final-regression.log: complete final 93/93 PASS. Earlier closure-regression/results.json, closure-regression.log and closure-statement-portability.log retain the 92/93 and focused-correction provenance. |
| BR | browser-closure-all-01/results.json and closure-browser-01.log; final combined browser run, with actual outcome as stated above. |
| FC | closure-components.log, closure-build.log, closure-typecheck.log and closure-lint.log. |
| MD | masterdata-final-reconciliation.json and masterdata-gap-evidence.md; focused passes masterdata-03 CRM, masterdata-05 inventory and masterdata-07 company/client/service, then BR. |
| CR | qc-owner-crm.spec.mjs; crm-01.log and prior real CRM evidence, then BR. |
| CO | qc-owner-commercial.spec.mjs; commercial-03/04.log and actual taxed quotation/invoice flow, then BR. |
| IN | qc-owner-inventory.spec.mjs; inventory-03.log captures original marker defect, later full real inventory pass in BR. |
| DO | qc-owner-document-downloads.spec.mjs; docs-03.log actual saved-byte downloads, then BR; registered HTTP document guards in BE. |
| HP | hr-project-gap-evidence.md; hr-project-browser-04.log, hr-project-http-03.log and final same-payroll statement/TB assertions in BE, then BR. |
| HF | qc-owner-hr-finance.spec.mjs; hr-finance-01.log and real owner payroll/leave fixture, then BR. |
| NA | notification-auth-gap-evidence.md; notification-auth-browser-03.log and notification-auth-http-01.log, then BE/BR. No mail delivery. |
| FU | financial-ux-gap-evidence.md; financial-ux-04/05/06.log and real financial controls, then BR. |
| FE | finance-gap-evidence.md; final successful extended-finance and concurrency commands, including explicit before/after anchors, then BE. |
| LS | statement-reversal-gap-evidence.md; statement-reversal-gap-http-03.log, browser02 and corresponding BE/BR entries. |
| RP | verify_qc_owner_reporting.py and verify_qc_order_milestones.py; fresh registered HTTP/PG reporting and milestone assertions in BE. |
| CL | collections-before-fix.log and collections-after-fix-03.log; real query/rollback evidence plus FU/BR. |
| LV | verify_qa_hr_leave.py; bounded direct-PG leave/concurrency/proration observations in BE, not policy approval. |
| AX | qa-search-accessibility.spec.mjs and qa-ux.test.cjs; actual login field-name/reveal check, mocked CRM/search/race checks in BR, and rendered component label checks in FC. Broader real CRM/authentication journeys are under CR/NA. |
| SC | Scope restriction; intentionally not exercised as an owner-local journey. Related baseline success does not change Excluded. |
| JR | joint-review-seeded-values.json, review-seed-final.log, joint-review-checklist.md, 2026-10-22-local-review.md, closure-review-snapshot.log and closure-review-readiness.log; unchanged reconstructed review values and restartability only. |

## Appendix A All 160 original cases

Each row states the original expected scenario and the fresh observed bounded invariant. PASS means that invariant, not literal replay of all historical IDs, exact amounts, sequence or every UI path. Owner PASS means the named local portion passed and a specified external/personal portion is excluded. Evidence levels are defined above; detailed source lines, historical results and limits remain in original160-gap-map.json. This appendix covers all 160 unique IDs once.

### CRM

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| CRM01 | Expected: Empty lead creation requires contact. Observed: Native contact required guard; no create | PASS | MD |
| CRM02 | Expected: Probability 101 rejected. Observed: 101 rejected HTTP 422 with visible bound error | PASS | MD |
| CRM03 | Expected: Reserved invalid email rejected clearly. Observed: Reserved .invalid email HTTP 422 and visible readable error; cleared before save | PASS | MD |
| CRM04 | Expected: Create synthetic company lead with source/value/self-assignment. Observed: UI company lead source/value 125/probability 35/self-assignment persisted; blank email | PASS | MD, CR |
| CRM05 | Expected: Status New→Qualified records audit. Observed: New to Qualified UI transition exact before/after names in persisted timeline | PASS | MD, CR |
| CRM06 | Expected: Add note activity. Observed: Note UI create, exact body timeline and API readback | PASS | MD |
| CRM07 | Expected: Add catalog interest qty 2. Observed: UI catalog service qty 2 price 100 scope; USD 200 estimate and API readback; no stock/movements | PASS | MD |
| CRM08 | Expected: Won locks and offers conversion. Observed: Won modal displayed; lead status editor removed; API locked mutation returns 409. | PASS | CR |
| CRM09 | Expected: Convert won lead once. Observed: UI conversion retains catalog requirements byte-for-byte in API readback | PASS | MD, CR |
| CRM10 | Expected: Search typing/Enter/blur filters. Observed: Explicit Enter and blur retain typed matching query and exact result; typing/no-match/reset covered existing CRM test | PASS | MD, CR, AX |
| CRM11 | Expected: Status/source filters and Reset. Observed: Source filter matches exact persisted lead/source and Reset clears; status filter covered separate crm spec; Combined Won/source UI intersection and Reset of both filters | PASS | MD, CR |
| CRM12 | Expected: Past next-follow-up counts due. Observed: Past follow-up persisted and due count 1 | PASS | MD |
| CRM13 | Expected: Future follow-up activity reschedules lead. Observed: 2030 follow-up persists on lead and timeline; due count zero | PASS | MD |
| CRM14 | Expected: Lost stage removes from open pipeline. Observed: Lost removes sole open lead; persisted status and audit timeline | PASS | MD |
| CRM15 | Expected: Custom stage create/rename/disable. Observed: Custom create rename disable, default disable/delete UI protected | PASS | MD |
| CRM16 | Expected: Custom source create/disable. Observed: Custom source UI create disable; reload and API persisted | PASS | MD |
### Clients

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| CLI01 | Expected: Conversion profile correctly linked. Observed: Converted profile retains assigned owner employee and source lead | PASS | MD, CR |
| CLI02 | Expected: Edit city/master notes. Observed: UI city/master notes edit; exact detail page and API readback | PASS | MD |
| CLI03 | Expected: Deactivate/reactivate. Observed: Inactive client quotation control disabled, restored enabled after reactivation | PASS | MD, CR |
| CLI04 | Expected: Reusable client note create/edit. Observed: Reusable note UI create edit reload and exact body persisted | PASS | MD |
| CLI05 | Expected: Synthetic document upload. Observed: UI text upload and reload; 89 bytes persisted | PASS | MD |
| CLI06 | Expected: View uploaded text. Observed: Actual new preview tab exact UTF-8 DOM text and browser download exact bytes/filename; visibility has separate assertion and diagnostics | PASS | MD |
| CLI07 | Expected: Client search / inactive filter. Observed: Real name/code/no-match/status/Reset and reload show exact client set; controlled stale-response race is separately mocked. | PASS | CR, AX |
### Projects

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| PRJ01 | Expected: Order-derived project handoff. Observed: Native completed order reopened; Create Project handoff creates active/high project, owner manager and single-member team. New isolated synthetic order, not historical IDs. | PASS | CO, HP |
| PRJ02 | Expected: Project create due date. Observed: Native project due date Dec 31 persists through completion and full reload. | PASS | HP |
| PRJ03 | Expected: Milestone create native due date. Observed: Native milestone Dec 20 due date persisted in create response and later workspace readback. | PASS | HP |
| PRJ04 | Expected: Task create milestone/self-assignment/date/estimate. Observed: Native urgent/todo task linked to milestone/owner with yesterday due date and 150-minute estimate; workspace overdue count 1. | PASS | HP |
| PRJ05 | Expected: Work execution and logs. Observed: Native work updates blocked 25%+15 min → review 50% → completed 100%; exact 3 note strings, 3 work logs, 3 success audits with 25/50/100 after-data and linked work-log IDs retained. | PASS | HP |
| PRJ06 | Expected: Roll-up progress. Observed: Independent workspace reads after each UI update assert project/milestone 25→50→100 and final milestone completed. | PASS | HP |
| PRJ07 | Expected: Milestone edit persistence. Observed: Native milestone rename persists with original Dec 20 due date unchanged. | PASS | HP |
| PRJ08 | Expected: Project note create. Observed: Native project-only note saves exact content; fresh project-notes GET retains it. | PASS | HP |
| PRJ09 | Expected: Team read. Observed: Team UI renders owner employee code; fresh project read has owner manager, 1 member and review_tips access. No permissions changed. | PASS | HP |
| PRJ10 | Expected: Review & Tips gated by completion. Observed: Review/tip UI locked before completion; Add review and Record tip form appear afterward. No review/tip money submitted. | PASS | HP |
| PRJ11 | Expected: Hold/resume/complete. Observed: Native active→on_hold→active→completed transitions persist; task/milestone/project rollup 100 remains. | PASS | HP |
| PRJ12 | Expected: Restore order after test. Observed: Native service-order restore plus HTTP stock variant: total 47.25, fulfilled 3, stock, items and existing draft invoice unchanged across reopen/project-create/complete. | PASS | HP |
| PRJ13 | Expected: Completed-project document lock. Observed: Native project completion followed by authenticated upload and metadata-edit requests both 409; exact document list unchanged. Completed UI exposes no upload/edit control. | PASS | HP |
| PRJ14 | Expected: Active-project document upload, edit and secure readback. Observed: Native active-project upload and title/notes edit persist; secure authenticated file response equals exact uploaded synthetic bytes. | PASS | DO, HP |
| PRJ15 | Expected: Project document download. Observed: Owner project PDF actual browser download, filename and saved bytes exact. | PASS | DO |
### Personal My Work

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| MW01 | Expected: Self-assigned task propagates. Observed: Personal My Work task propagation not entered. | Excluded | SC |
| MW02 | Expected: Search negative case. Observed: Personal My Work search not entered. | Excluded | SC |
| MW03 | Expected: Board view. Observed: Personal My Work board not entered. | Excluded | SC |
| MW04 | Expected: Progress upper bound. Observed: Personal My Work progress entry not entered. | Excluded | SC |
| MW05 | Expected: Completed status consistency. Observed: Personal My Work completion behavior not entered. | Excluded | SC |
### Notifications

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| NT01 | Expected: Overdue alert generation. Observed: Exactly one owner-assigned overdue task alert with actual task code/critical severity; UI attention 1/overdue 1/due soon 0; unassigned overdue and later task excluded. | PASS | NA |
| NT02 | Expected: Filters. Observed: Actual Due soon empty, Overdue exact task, All exact task; Refresh preserves actionable alert. | PASS | NA |
| NT03 | Expected: Alert deep link. Observed: Deep link targets personal My Work; no browser journey claimed. | Excluded | SC |
| NT04 | Expected: Completion clears alert. Observed: Owner completes task through project administration; persisted status Completed/progress 100 while controls remain incomplete; notification API and UI after reload all 0/caught-up. | PASS | NA |
### Catalog

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| CAT01 | Expected: Duplicate existing SKU QA-STOCK-001 cannot create another item. Observed: Duplicate SKU HTTP 409 and readable error; original preserved | PASS | MD |
| CAT02 | Expected: Fixed service duration 0 rejected. Observed: Fixed duration zero blocked by native min 1 | PASS | MD |
| CAT03 | Expected: Service create with 3 month term. Observed: UI fixed service create; persisted price 30, duration 3 | PASS | MD, IN |
| CAT04 | Expected: Service edit name/term/category. Observed: UI rename term 6 and category, API persisted | PASS | MD, IN |
| CAT05 | Expected: Category create. Observed: UI category create and exact API persisted description | PASS | MD |
| CAT06 | Expected: Catalog search isolates matching SKU. Observed: SKU search isolates service | PASS | MD |
| CAT07 | Expected: Combined search/type mismatch. Observed: Service SKU + stock type mismatch yields empty | PASS | MD |
| CAT08 | Expected: Negative selling price rejected. Observed: Negative price HTTP 422 and readable minimum error | PASS | MD |
| CAT09 | Expected: Zero-stock product master create. Observed: UI product create price 12, persisted zero onhand and inventory value | PASS | MD, IN |
| CAT10 | Expected: Product edit name/unit. Observed: Name and unit edit survive full reload exact editor readback | PASS | MD |
| CAT11 | Expected: Unused product disable. Observed: Unused product disable persists and Enable control appears | PASS | MD |
### Suppliers

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| SUP01 | Expected: Empty supplier required-name validation. Observed: Native supplier name required | PASS | MD |
| SUP02 | Expected: Malformed email rejected. Observed: Malformed email native type mismatch blocked | PASS | MD |
| SUP03 | Expected: Supplier create no contact data. Observed: Blank contact creation, persisted purchases 0 outstanding 0 | PASS | MD, IN |
| SUP04 | Expected: Supplier search. Observed: Positive and negative supplier search | PASS | MD |
| SUP05 | Expected: Supplier edit rename. Observed: UI rename persisted | PASS | MD |
| SUP06 | Expected: Supplier disable. Observed: UI disable persisted | PASS | MD |
### Warehouses

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| WH01 | Expected: Empty warehouse code required. Observed: Native code required | PASS | MD |
| WH02 | Expected: Duplicate warehouse code QA-WH-A rejected. Observed: Duplicate code HTTP 409 visible error | PASS | MD |
| WH03 | Expected: New empty warehouse. Observed: UI non-default empty warehouse created | PASS | MD, IN |
| WH04 | Expected: Rename and deactivate warehouse. Observed: UI rename/deactivate persisted across reload | PASS | MD |
### Stock

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| ST01 | Expected: Baseline quantity/cost unchanged after master tests. Observed: 7 units/value 42 and cost 6 conserved after UI selling-price master edit and stock filters | PASS | MD |
| ST02 | Expected: Low-stock threshold filter. Observed: UI threshold 3 retains B3 and hides A4; toggle restores both; persisted stock/journals unchanged | PASS | MD |
### Authentication

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| AUTH01 | Expected: Account registration, matching verification, sign-in and onboarding. Observed: Local signup, matching-token verification, login and owner onboarding persist; wrong-email token denied. SMTP disabled. Actual delivery and mailbox ownership excluded. | Owner PASS | NA |
| AUTH02 | Expected: Empty login submission. Observed: Empty actual login focuses identity and sends no request; identity-only submission focuses required Password and still sends no request; form remains. | PASS | NA |
| AUTH03 | Expected: Password accessible field name. Observed: Actual PasswordField label/reveal component plus real browser Password locator, Show/Hide control and type transition pass. | PASS | AX |
### Finance

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| FIN01 | Expected: Service invoice partial and final collection. Observed: Retained registered HTTP untaxed invoice 200 receives 80 then 120 with due 120 then 0; prior native taxed invoice independently proves both collection UI actions, cash and paid status. | PASS | CO |
| FIN02 | Expected: Invoice overpayment guard. Observed: Native amount 121 against due 120 has range overflow; review does not open; field focused and API paid 80/due 120 unchanged. | PASS | FU |
| FIN03 | Expected: Inventory receipt accounting. Observed: Receive 10×USD 6; one linked payable and inventory/AP 60; settle 20/40, reverse/re-pay 40; stock/cash/AP/journals/history exact. | PASS | IN |
| FIN04 | Expected: Inventory receipt visibility in Payables. Observed: Receive 10×USD 6; one linked payable and inventory/AP 60; settle 20/40, reverse/re-pay 40; stock/cash/AP/journals/history exact. | PASS | IN |
| FIN05 | Expected: Stock warehouse transfer and overdraw guard. Observed: Registered owner transfer 11 against 10 rejected with all organization-owned rows unchanged; transfer 3 conserves quantity and inventory value 60. | PASS | FE |
| FIN06 | Expected: Stock-sale dispatch, reversal and final fulfillment. Observed: Registered stock dispatch 1 costs 6 then reversal restores; final dispatch 3 costs 18 leaves 7/value 42. Reversed and posted history retained; repeat reversal and overdispatch rejected without mutation. | PASS | FE |
| FIN07 | Expected: Valid stock adjustment submission. Observed: Real adjustment +1/−1, quantity/value/GL/movement exact; overdraw 409 and visible useful error; immutable denied state checked. | PASS | IN |
| FIN08 | Expected: Opening asset depreciation and repeat guard. Observed: Two opening assets 120 each; monthly depreciation 5+5=10; repeated month 0; cash unchanged. | PASS | FE |
| FIN09 | Expected: Existing bill internal settlement. Observed: Ordinary (non-inventory) payable subtotal 20/tax 2/withholding 1 creates AP 21. Internal settlements 5+16 reduce cash 21/AP 21 and leave profit unchanged; bill paid 21/due 0. Bounded alternate amount, not duplicate expense. | PASS | FE |
| FIN10 | Expected: Loan approval, receipt and repayment lifecycle. Observed: Draft disbursement rejected; approve 100; reject 101; principal 100 receives 97 after fee 3; repayment 105 includes 100 principal+4 interest+1 fee; principal 0, cash net−8. Overrepayment/closed repayment rejected with exact unchanged rows. | PASS | FE |
| FIN11 | Expected: Owner contribution and drawing classification. Observed: Owner contribution 50/drawing 10 changes cash+40 and leaves operating profit unchanged. | PASS | FE |
| FIN12 | Expected: Company funding lifecycle and upper bounds. Observed: Company commitment/funding 40 and principal return 40+distribution 2 leaves outstanding 0, cash−2; overfunding/principal 41 rejected unchanged. | PASS | FE |
| FIN13 | Expected: Company investment recovery and carrying-value guard. Observed: Investment 20 recovered with income 3 leaves carrying 0, cash+3; principal 21 and repeated recovery rejected unchanged. | PASS | FE |
| FIN14 | Expected: Project funding lifecycle. Observed: Project funding 10/return 10 leaves outstanding 0 and cash net 0; overfunding rejected unchanged. | PASS | FE |
| FIN15 | Expected: Manual noncash journal and reversal. Observed: Balanced noncash journal 7 and reversal 7 retain original, no cash movement; repeat reversal 409 with exact state unchanged. | PASS | FE |
| FIN16 | Expected: Recurring manual post, pause and expense void. Observed: Manual 4 and auto 3 post cash and accrual together with one journal each; retry/pause/void/tax/failure guards pass. Competing 4+4 against cash 5 yields 200/409 and cash 1. No historical backfill. | PASS | FE |
| FIN17 | Expected: Quotation rounding, sections and revision preservation. Observed: Persisted owner HTTP R1:3×18.8889 rounds 56.67 and scope retained. R2:3×18.9=56.70 rejected; R1 retained, two-version lineage; incomplete payment schedule and superseded edit rejected unchanged. | PASS | FE |
| FIN18 | Expected: Customer advance classification. Observed: Customer advance 10 increases liability, not revenue; owner HTTP and ledger classification asserted. | PASS | FE |
| FIN19 | Expected: Direct income and minimum-amount guard. Observed: Direct income 5.55 persisted and cash rises 5.55; zero rejected 422 with exact unchanged rows. | PASS | FE |
| FIN20 | Expected: Client expense included-tax guard. Observed: Direct client expense amount 6/tax 7 rejected 400 with all rows unchanged; corrected expense 6 persisted. Expanded recurring effective-tax guards separately pass. | PASS | FE |
| FIN21 | Expected: Input/withholding bill and tax position. Observed: Bill subtotal 20+tax 2(50%recoverable)−withholding 1 gives expense 21, input-tax asset 1, AP 21, withholding liability 1; independent ledger assertions. | PASS | FE |
| FIN22 | Expected: Account-statement search, direction and date filters. Observed: Actual five-row statement ends 145 with working filters. HTTP exhausts 5/14-row and opening-25 controls to 145/62.55/45; unique rows, sums and independently computed running balances match. | PASS | FE, LS |
| FIN23 | Expected: FX transfer, rate prerequisite and round-trip. Observed: Registered outbound USD 10 including fee 1 gives EUR 8 with carrying USD 9. EUR 9 overdraw 409 and EUR 8→USD 10 return before historical rate 409 preserve exact organization-owned rows; add rate 1.25 then return succeeds, cash restored, EUR 0, fee expense 1 and realized gain 1. | PASS | FE |
| FIN24 | Expected: Period close, rejected posting and reasoned reopen. Observed: Close one-day period; posting inside closed date 409 unchanged; short reopen reason 422 unchanged; valid reason persisted and status Open restored. | PASS | FE |
| FIN25 | Expected: EUR reconciliation difference guard and finalization. Observed: EUR incoming and outgoing transaction matching: after first match finalize 409; after both, difference 0 and 2 matched/finalized. Subsequent add/remove match 409 unchanged. | PASS | FE |
| FIN26 | Expected: Purchased fixed asset posting. Observed: Purchased asset 12 reclassifies cash to asset with operating profit unchanged. | PASS | FE |
| FIN27 | Expected: Asset validation error presentation. Observed: Native salvage 101>cost 100 yields 422, readable salvage error and no object-string; fresh asset list remains empty. | PASS | FU, AX |
| FIN28 | Expected: Latest statements and trial-balance reconciliation. Observed: Two same-fixture reconciliations passed. Commercial fixture: trial gross 441/441, assets 169=liabilities 10+earnings 159, income 200−expenses 41=profit 159; exact category balances reconcile to statements. Payroll fixture at Oct 20/31: trial 0/0→1000/1000, expense/liabilities 0→1000; payroll payable 874.65+withholdings 125.35=1000; equity/current earnings 0→−1000 keep assets 0=liabilities+equity. | PASS | CO, HP, RP |
| FIN29 | Expected: Trial-balance historical dates and ledger/source search. Observed: Actual as-of totals 0/120/162; ledger search preserves global totals. Source/reference filters retain originals and reversals; rejected closed-period reference absent; Clear restores seven journals. | PASS | FE, LS |
| FIN30 | Expected: Taxed invoice issuance. Observed: Taxed quote/order/project invoice issued; original totals remain and edit action absent. | PASS | CO |
| FIN31 | Expected: Management profit consistency. Observed: Actual Reports operational margin 169 explicitly says not accrual net profit; Accounting net profit 159 reconciles unpaid AP 10; dashboard 169 consistent. | PASS | FU, RP |
| FIN32 | Expected: Order-linked project revenue attribution. Observed: Order-only invoice project_id null paid 200 is attributed to linked project in actual Reports/dashboard; project revenue 200/cost 25/profit 175. | PASS | FU, RP |
| FIN33 | Expected: Financial statement historical date boundaries. Observed: Historical earlier month assets/P&L/cash 0; prior month assets 240/TB 240 from opening only, income/expenses/cash 0. Current-month flows excluded at those cutoffs. Native date-control reset is not claimed. | PASS | FE |
| FIN34 | Expected: Tax-aware vendor bill partial and final settlement. Observed: Tax-aware ordinary payable 21 rejects 22 unchanged; partial 5 leaves 16, final 16 leaves 0; cash−21/AP reduced 21, profit unchanged, withholding 1 retained. | PASS | FE |
| FIN35 | Expected: Internal receipt reversal and retained history. Observed: Actual reversal restores paid 80/due 120, original reversed payment retained; native reversed row has no Reverse payment control. Prior registered HTTP repeated reversal rejection preserves all financial/audit rows. | PASS | CO, FU |
| FIN36 | Expected: Customer advance application and upper bound. Observed: Advance application 11 against 10 rejected unchanged; application 10 reduces invoice due 120→110, advance 0, AR 110 without cash movement. | PASS | FE |
| FIN37 | Expected: Embedded invoice preview refresh after reversal. Observed: Actual invoice embedded preview immediately reflects UI draft edit, issue and reversal without page reload; reversal paid 200→80, due 0→120, partial status matches fresh API. | PASS | FU |
| FIN38 | Expected: Replacement receipt after credit application. Observed: Same invoice 200: receive 80+120, reverse 120, apply advance 10 without cash, replace 110. Final paid 200/due 0/cash 200/revenue 200; seven balanced journals and retained reversed record. | PASS | FE, LS |
| FIN39 | Expected: Taxed invoice partial and final cash collection. Observed: Actual prior taxed invoice 367.50 partial receipts 137.50+230 settlement retained. Final integrated owner UI additionally asserts a fresh taxed 22 invoice, tax 2, receipts 5+17 both Confirmed, paid 22/due 0, paid preview and no Collect payment link on that same taxed document. Both synthetic equivalents prove the named tax/partial/full-settlement invariant, not a real provider payment. | PASS | CO, FU |
| FIN40 | Expected: Noncash input-tax offset and excess guard. Observed: Input-tax offset 2 exceeds recoverable 1 and rejects unchanged; offset 1 reduces input asset to 0/output-tax liability 2→1 with cash unchanged. | PASS | FE |
| FIN41 | Expected: Dashboard receivable excludes unissued drafts. Observed: Actual dashboard collection card and Period receivables 144.68 match issued 224.68−collected 80; draft 47.25/cancelled 24.68 excluded. Collection count 2 differs deliberately from operational open-document count 3. H-app additionally excludes stale legacy due values and foreign tenant. | PASS | FU, RP, CL |
| FIN42 | Expected: Unissued direct invoice create, edit and cancellation. Observed: Native draft 12.34→24.68; cancel disabled without reason; reason retained across reload and cancelled state cannot collect. Fresh journals exactly unchanged and reports exclude draft/cancelled. | PASS | FU |
| FIN43 | Expected: Duplicate source invoice ordinary UI eligibility. Observed: Actual source selectors omit billed order/project and include their unbilled controls. No bypass/concurrency claim. | PASS | FU, RP |
| FIN44 | Expected: Outstanding filter eligibility for cancelled invoice. Observed: Actual outstanding filter shows only issued due invoices; draft/cancelled hidden despite totals; Clear restores them. Cancelled detail due 0 and no Collect action. | PASS | FU, AX |
### Human resources

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| HR01 | Expected: Department, designation and owner-profile persistence. Observed: Native department/designation create, owner profile association and full reload; positive/negative directory search; fresh readback retains both structure names. | PASS | HP, HF |
| HR02 | Expected: Attendance positive, fractional and duplicate cases. Observed: Native 8 h/2 h and 7.5 h/.5 h persist as 480/120 and 450/30 minutes. Duplicate-date 409 leaves exact two records unchanged. | PASS | HP, HF |
| HR03 | Expected: Leave setup, approval and balance. Observed: Owner approves a real API-created 3-day request. Separate PG fixture allowance 12/used 5/remaining 7 passes. Personal balance display excluded; day-count convention unresolved. | PASS | HF, LV |
| HR04 | Expected: Overlapping leave reservation. Observed: Owner HTTP overlap 409; PG inclusive/cross-type/concurrent reservations reject duplicates and preserve balances; cancellation/rejection restores. Personal submission UI and leave policy not approved. | PASS | HF, LV |
| HR05 | Expected: Invitation delivery and pending state. Observed: Mail-disabled native invalid email rejected before creation; synthetic invitation created with email_sent=false, truthful failed-delivery text, persisted Pending/expiry; resend false; native revoke clears pending. Excluded: real email delivery and acceptance. | Owner PASS | HP |
| HR06 | Expected: Invitation acceptance. Observed: Invitation acceptance and actual delivery excluded. | Excluded | SC |
| HR07 | Expected: Office and weekly attendance mode setup. Observed: Native latitude 91 range overflow/no office created; office prerequisite disables Save. Explicit office/remote/field/off weekly array and assigned office survive full reload. | PASS | HP |
| HR08 | Expected: Valid owner remote request. Observed: Personal remote request excluded. | Excluded | SC |
| HR09 | Expected: Employee document upload and expiry aggregation. Observed: Native owner employee-document upload/reference/10-day expiry; reload retains date, correct employee association and expiring 30 d count 1. | PASS | DO, HP |
| HR10 | Expected: Employee document content retrieval. Observed: Real owner HR upload/download event completes; expected filename and saved bytes exactly match synthetic PDF. | PASS | DO, LV |
| HR11 | Expected: Synthetic hiring job and candidate lifecycle. Observed: Native job/candidate creation, candidate Rejected and job Closed persist; actual UI open/active counts 0. | PASS | HP |
| HR12 | Expected: Performance review validation and completion. Observed: Native rating 6 range overflow prevents completion; manager feedback/rating 4/completed persist. Owner edit/restoration separately tested. Excluded: employee self-review. | Owner PASS | HP |
| HR13 | Expected: Synthetic policy publication and acknowledgement. Observed: Native owner policy publication persists is_policy=true, publication timestamp and body; title visible after full reload. No edit/archive UI exists and was not part of original assertion. Excluded: personal acknowledgement. | Owner PASS | HP |
| HR14 | Expected: Payroll draft decimal calculation and persistence. Observed: Prior native decimal payroll assertion 1250.25−150.25=1100 retained; new native generated 1000 draft survives full reload/reopen with draft status and displayed 1000. These are bounded distinct fixtures. | PASS | HP, HF |
| HR15 | Expected: Payroll duplicate-run and negative-net guards. Observed: Native duplicate run 409/readable error/exact 1 run; tax 1000.01 disables Save and exact draft unchanged. H-app negative-net request 400 independently preserves entire draft. | PASS | HP |
| HR16 | Expected: Payroll invalid-input message. Observed: Native reverse-date period and negative-tax adjustment both 422 with readable field errors, no object-string; period list empty and stored tax 0 unchanged. | PASS | FU, AX |
| HR17 | Expected: Draft payslip status wording. Observed: Actual owner draft payslip footer explicitly draft/not approved and excludes approved-record wording. | PASS | FU |
| HR18 | Expected: Payroll approval. Observed: Owner approves payroll; Approved/locked, Adjust absent, edit and reapprove 409; liabilities 1250.25 reconcile, no payout. | PASS | HF |
| HR19 | Expected: Completed performance review owner-admin edit and restoration. Observed: Completed owner-admin review rating 4→4.5→4 persists; feedback and completed status unchanged. Not a personal self-edit. | PASS | HP |
| HR20 | Expected: Salary profile effective-date eligibility. Observed: Native September Generate 409/readable no-eligible-profile message leaves run list empty when salary effective Oct 1; October eligible. | PASS | HP |
| HR21 | Expected: Overlapping payroll period guard. Observed: Native Oct 1–15 period against full October 409; exact two periods retained, no object-string error. | PASS | HP |
| HR22 | Expected: Half-month payroll generation and proration observation. Observed: Half-month draft still uses full monthly 1,000. Intended proration not agreed; correctness remains unresolved. | Policy | LV |
| HR23 | Expected: Approved payroll payslip and report-date cutoff. Observed: Actual approved owner payslip retained. Same new cutoff fixture expense/total-liability 0 Oct 20 then 1000 Oct 31; payroll payable 874.65 plus withholding 125.35 exactly 1000; no payout. | PASS | HP, HF |
| HR24 | Expected: Payroll withholding date preview. Observed: Native withholding date preview Oct 20=0 vs Oct 31=125.35; fresh endpoint readback agrees and payment list remains empty. | PASS | HP |
| HR25 | Expected: Leave request rejection and reservation restoration. Observed: Native rejection changes pending 1 to 0 without attendance changes. Separate PG preserves current reservation 7 to-8 and restoration 7/used 5; overdraft convention remains undecided. | PASS | HP, LV |
| HR26 | Expected: Missed attendance correction request validation and submission. Observed: Personal missed-attendance correction request excluded. | Excluded | SC |
| HR27 | Expected: Completed review owner self-service lock. Observed: Personal completed-review editing excluded. | Excluded | SC |
| HR28 | Expected: Owner payslip approval visibility. Observed: Personal payslip visibility excluded. | Excluded | SC |
| HR29 | Expected: Independent HR approval and negative self-approval test. Observed: Native independent manager approval persists correction 480 min and reviewer; payroll unchanged. Separate H app rejects requester self-review 403 and foreign tenant 404 without mutation. | PASS | HP, LV |
### Company settings

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| SET01 | Expected: General note and date-format reversible persistence. Observed: UI note/date format edit reload verified; originals restored and API readback | PASS | MD |
| SET02 | Expected: Client numbering invalid-next error presentation. Observed: Actual client and invoice numbering next 0 reject 422; readable next_number field error, no object-string, all original sequences unchanged. | PASS | FU, AX |
| SET03 | Expected: Branding footer persistence and URL validation. Observed: Invalid URL native block, footer UI save/reload/restoration | PASS | MD |
| SET04 | Expected: Cost-only client profitability detail. Observed: Actual Reports includes cost-only client revenue 0/cost 6/profit−6; dashboard shows−6. | PASS | FU, RP |
| SET05 | Expected: Company PDF upload and persistence. Observed: Synthetic PDF UI upload; navigate away/back persists title/document metadata and authenticated download link | PASS | MD, DO |
| SET06 | Expected: Company PDF download. Observed: Owner company PDF upload with title/link; actual browser download filename and exact saved bytes. | PASS | DO |
| SET07 | Expected: Custom Other identifier create and persistence. Observed: Other BD non-primary identifier UI create/reload/delete with exact persisted value | PASS | MD |
| SET08 | Expected: Non-tax identifier invoice rendering. Observed: Actual invoice preview excludes Other identifier/Tax ID; recognized VAT included; issued snapshots remain immutable after identifier deletion. | PASS | FU |
| SET09 | Expected: Mailing address create, edit and reload. Observed: Mailing create/edit/full reload, other address types untouched | PASS | MD |
### Service terms

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| SVC01 | Expected: Direct fixed-term order creation and completion. Observed: UI manual order blank line rejected; catalog fixed service 2 x 30 less 10%=54 created, started and completed; persisted readback | PASS | MD |
| SVC02 | Expected: Service entitlement dates and analytics. Observed: UI past/future/current date edits, inclusive month-end expiry, expired/upcoming/active status, restored Active reload and analytics; journals unchanged | PASS | MD |
### Audit

| ID | Expected scenario and observed bounded invariant | Outcome | Evidence |
|---|---|---|---|
| AUD01 | Expected: Activity action/entity/outcome/search/reset filters. Observed: Action/entity/success conjunctive filter; negative query empty; Reset restores 50 real rows; Exact three service-term updates from three UI changes isolated by action/entity/outcome in real audit UI; negative/reset separately covered | PASS | MD |
| AUD02 | Expected: Audit pagination append. Observed: Real >50-row audit API fixture; UI appends second cursor page, retains initial rows, unique IDs | PASS | MD |
| AUD03 | Expected: Audit date filtering. Observed: Synthetic run date 2026-10-22 returns 50; next day 2026-10-23 empty; date selections retained on Apply | PASS | MD |
