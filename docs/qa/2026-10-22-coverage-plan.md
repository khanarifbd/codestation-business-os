# Owner cross-module QC coverage plan — 22 October 2026

Read-only planning against local revision `99d2c7a`, with a source review of the new, concurrently authored owner-browser specs. This is **not a test execution result**. Sources: [V2 traceability](qa-v2-coverage-traceability.md), the recovered 20 October V2 report (sections 3–10 and Appendix A), and the test sources named below. Original 160-case statuses remain historical.

Scope is the **local synthetic owner/admin workspace only**. Client Portal, Employee Portal, personal My HR/My Work/self-service journeys, external email/payment providers, real payouts/remittances, production and publication are excluded. Owner administrative People/Time & Leave/Payroll screens and the embedded customer preview inside the owner's invoice screen are in scope. This planning pass changed only this document; it started no services, ran no product tests, edited no product code and made no commits, pushes or external requests.

## Current run: avoid duplicating work

A fresh **85/85 backend pass has been reported** for this run; it was not independently reexecuted by this audit. These new real-browser journeys are already being worked on, not completed results from this planning pass:

- `frontend/e2e/qc-owner-commercial.spec.mjs`: owner client → discounted/taxed quote → order/project → **project invoice** → receipts/reversal → statements. Source inspection confirms invoice creation uses the project source, so it does not test order-invoice attribution fallback.
- `frontend/e2e/qc-owner-inventory.spec.mjs`: supplier/warehouse/product → receive 10 at USD 6 → payable partial/final settlement → positive/negative adjustment and overdraw. Source inspection found no payable-payment reversal step.
- `frontend/e2e/qc-owner-hr-finance.spec.mjs`: owner administrative People, attendance and leave approval, exact payroll approval/payslip, expense and statements. Do not add a separate personal self-service journey.
- `frontend/e2e/qc-owner-module-sweep.spec.mjs`: route availability and rendered module shells. It does not establish mutations or cross-module reconciliation.

Finish and retain results from these journeys first. The bounded additions below target concrete missing branches rather than replaying the whole application again.

## Evidence levels

- **D:** real PostgreSQL plus direct Python function/service calls. Constructing `Request(...)` or catching `HTTPException` is not actual HTTP authentication/routing coverage.
- **H-app:** `TestClient(app)` exercises actual application routing, authentication, tenant dependencies and schema parsing with local PostgreSQL rebound to rollback fixtures. It does not prove TCP/proxy or browser behavior. Existing examples: `backend/scripts/verify_qa_invoice_api.py`, `verify_qa_document_http.py`.
- **B-real:** actual owner browser through the local Next proxy and backend, with domain requests unintercepted. Record which setup/check steps use browser API requests rather than UI actions.
- **B-mock:** real Chromium with intercepted synthetic domain responses. `qa-invoice-preview.spec.mjs`, `qa-search-accessibility.spec.mjs` and document print specs are this level despite real login.
- **S/R/M:** source assertions, rendered component checks, or isolated migration checks. None replaces a transaction journey. `critical-flow.spec.mjs` is real navigation smoke, not the transaction its title suggests. `verify_quotation_v2_api.py` and `verify_accounting_api_hardening.py` inspect routes/schema/DB invariants; their names do not mean HTTP transactions were executed.

API paths below are backend paths under `/api/v1`; the owner's browser proxy uses `/api`. Registered safety/fast handlers can differ from the leaf function used by a direct test.

## 1. Highest-value addition: order invoice → linked project economics

**Gap:** original QA-004 remains untested by the new commercial browser source because that journey invoices the project directly. The old defect concerned an invoice with `order_id` but no explicit `project_id`. Checking a project invoice can pass while the fallback is broken.

**Existing sources:** `verify_reporting_qa_regressions.py` and `verify_secondary_profitability_qa.py` (**D+S**) explicitly assert fallback and explicit-override behavior; `verify_sales_catalog_flow.py` (**D**) covers commercial lineage; `verify_qa_invoice_api.py` (**H-app**) primarily covers direct invoices. These are useful controls, not the missing B-real case.

**Bounded addition:** reuse the current commercial setup pattern for one distinct USD 200 service order and linked project. Create the invoice **from order**, verify its `order_id` and absence of an explicit `project_id`, issue/collect it, then read owner Reports and Expenses. Stop once this single fallback branch and its independent calculations are established.

**Exact routes:** `POST /sales/orders/from-quotation/{quotation_id}`; `POST /projects/from-order/{order_id}`; `POST /finance/invoices/from-order/{order_id}`; `PATCH /finance/invoices/{invoice_id}/status`; `POST /finance/payments`, `/finance/expenses`; `GET /reports/overview`, `/finance/profitability`, `/accounting/reports/financial-statements`. Owner pages: `/dashboard/accounting/invoices`, `/dashboard/reports`, `/dashboard/expenses`, `/dashboard/accounting/reports`.

**Oracles:** revenue 200, linked-project expense 25 and margin 175. Add expense 6 on a different cost-only client: that client must appear at revenue 0/cost 6/margin −6; combined operational margin is 169. If one ordinary unpaid bill 10 is also created, accrual expenses become 41 and profit 159, versus operational margin 169 with an explicit basis label. In a zero-opening fixture cash/assets are 169, AP 10 and earnings 159. A separate draft 47.25/cancelled unissued invoice 24.68 must not increase recognized revenue/AR. Do not force operational margin and accrual profit to be equal.

**Target evidence:** one B-real creation/visible linked-project row, plus real API/DB reconciliation. Existing D tests retain the explicit project-override branch; no need to build another broad commercial chain for it.

## 2. Extend current inventory case: reverse final payable settlement

**Gap:** the new inventory browser source settles 20 + 40 but does not reverse a purchase-linked payable payment. This is the most useful additional mutation branch for QA-002, because it must restore both purchase and payable state without duplicating inventory or expense.

**Existing sources:** `verify_inventory_qa_regressions.py` (**D**) covers the exact USD lifecycle and historical FX; `verify_inventory_payables_migration.py` (**M**) covers legacy linkage and preservation. The new browser case supplies the missing real HTTP/UI transaction path once it passes.

**Bounded addition:** continue its already-created paid USD 60 receipt; reverse only the final 40, inspect the purchase/payable/GL, then re-pay that 40. Do not create another supplier/catalog fixture.

**Exact routes:** `GET /accounting/payables/workspace`; `POST /accounting/corrections/reverse` with payable-payment source; `POST /accounting/payables/{bill_id}/payments`; `GET /inventory/purchases`, `/accounting/trial-balance`. Owner pages: `/dashboard/accounting/advanced/corrections`, `/dashboard/accounting/payables`, `/dashboard/inventory`.

**Oracles:** after 20 + 40 settlement, due/AP 0 and net cash out 60. Reverse final 40 → receipt due 40, payable due 40, AP 40 and net cash out 20. Re-pay → due/AP 0 and net cash out 60. Stock quantity/value and expense recognition are unchanged. Retain original/reversal history; duplicate reversal must not alter exact financial or audit rows. Existing adjustment +1/−1 remains 10/value 60 → 11/value 66 → 10/value 60.

**Target evidence:** B-real owner correction and immediate/reloaded UI, with DB/API assertions. Keep historical FX as focused D evidence for this run unless a new FX failure appears: EUR 60 at 1.2 carries USD 72; partial EUR 20 at 1.4 releases AP 24/cash 28/loss 4; final EUR 40 at 1.1 releases AP 48/cash 44/gain 4. Do not claim the browser replay includes FX.

## 3. One actual owner file download, not another mocked print

**Gap:** original HR10/PRJ15/SET06 now have real application HTTP bytes/permissions coverage, but no saved browser file is established by the current new specs. A printable page is not a download.

**Existing sources:** `verify_qa_document_http.py` (**H-app**) uploads/downloads exact 414-byte synthetic PDF content with MIME, attachment header and access/unchanged-state assertions. `verify_qa_document_downloads.py` is direct functions plus a synthetic HTTP adapter, not the actual application route. Invoice/quotation print specs use mocked document data.

**Bounded addition:** choose **one owner company document** first, upload a synthetic local PDF through owner Company, click its download, capture the actual download event and verify saved bytes/hash, filename and MIME. Stop after this owner download boundary is established. Project and HR saved-download coverage may remain explicitly unverified rather than expanding this run indefinitely.

**Exact route:** `GET /company-settings/documents/{document_id}/file`, owner `/dashboard/company`. Related real routes, not claimed tested by the single case: `/projects/{project_id}/documents/{document_id}/file` and `/hr-documents/{document_id}/file`. Never use a self-service document endpoint or a portal. If the browser environment blocks the operation, report the exact blocked action without treating it as a product failure or retrying a denied action.

## 4. Optional next commercial branch, only after the additions above

Quotation payment terms → order billing milestones → first partial invoice is a concrete untested browser branch, not required to rerun the main sale.

**Existing sources:** `verify_quotation_order_billing.py`, `verify_order_commercial.py` (**D**), `verify_quotation_v2_api.py` (**S/D**, not H-app). Exact routes: `PATCH /sales/quotations/{quotation_id}/commercial`; conversion route above; `GET /sales/orders/{order_id}/commercial`; `POST /sales/orders/{order_id}/billing-milestones/{milestone_id}/action` and `/invoice`. Owner `/dashboard/orders/{order_id}/commercial`.

**Oracle:** 600 + (400 × 90% × 110%) = 996; schedule 30%/40%/30% = 298.80/398.40/298.80, sum 996 with per-line discounts/taxes preserved. First invoice 298.80; neither draft creation nor scheduling alone recognizes revenue. Duplicate milestone invoicing cannot create another active invoice. A single H-app or B-real branch is sufficient; do not add renewals, every cancellation variant or all commercial features under this plan.

## Finish criteria and honest reporting

For each addition record revision, local fixture/run ID, exact command/log or browser trace, original issue/case, evidence level, expected/observed arithmetic, denial invariants and retained/cleaned fixture state. Mark individual assertions passed/failed/blocked/not run. A suite count is not 160 original cases replayed.

The existing HR/finance journey should retain its own exact payroll and dated-statement assertions; no self-service expansion is needed. Original USD payroll oracle is 1,000 + 125.50 = gross 1,125.50; deduction 25.25 + withholding 100.10 = 125.35; net 1,000.15. Draft has no accrual; approval recognizes expense/liability at period end with no cash change. Calendar-vs-working-day leave, pending overdraft and half-month proration remain policy questions, not newly invented defects.

Do not reconstruct the entire historical live fixture just to reproduce totals. Historical October 20 assets 495.80/profit 153.55/gross debits and credits 1,667.05, and October 31 loss 971.95/gross debits and credits 2,792.55, are not current branch outputs unless exactly recreated and observed. Smaller fresh fixtures should have their own independently reconciled totals.

No technical blocker occurred in this planning audit. New test execution outcomes belong to the fresh run report, not this plan. Once the three prioritized additions are resolved or explicitly blocked, consolidate remaining coverage limits rather than continuing an unbounded wishlist.
