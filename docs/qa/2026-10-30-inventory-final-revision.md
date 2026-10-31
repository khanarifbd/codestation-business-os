# Inventory final revision — bounded safety and precision

Base: local Projects integration `4347763`. No production DB operations, migrations, publication or deployment by this worker.

## First patch
- Keeps item prices/reorder, adjustment quantity/cost, purchase quantity/cost and transfer quantity as decimal JSON strings. No binary Number conversion, premature four-decimal rounding, or reuse of Sales Numeric(16,2) limits. Backend Decimal validation/quantization stays authoritative.
- Dedicated Inventory preview follows the existing backend: each raw quantity × cost is HALF_UP-rounded to cents, then each line tax is rounded to cents, then totals are added. Preview over the existing Numeric(18,2) receipt capacity is unavailable, not a fabricated total. Inventory unit-price/cost displays retain four places; receipt totals retain two, using exact integer formatting.
- Adjustment/purchase/transfer POSTs are not idempotent. Transport/body-read failure, malformed or unverified posting response, HTTP408 and server errors latch the current editor into unknown outcome. Repeated handler calls cannot repost. Valid structured known rejection responses (400/401/403/404/409/422/429) remain correctable. Existing acknowledged-commit and catalog second-write guards remain.
- Recovery offers read-only reads and register review, not an automatic retry. Clear warning: reload or absence from latest rows is not evidence of rollback.
- Lock scope is the current company/document component lifetime, NOT durable backend idempotency. Deliberate reload/new navigation can discard the local latch; the warning makes no contrary guarantee. A persistent intent/reconciliation protocol is a separate reviewed future change. Capped latest200 receipts remain a known read limitation and are never treated as proof of failure.

## Verification
- Focused actual hook/model/decimal + extraction contracts: 314/314 pass on final candidate (0 skipped). Focused lint: 0 errors,4 existing controller warnings. E2E syntax and git diff checks pass; aggregate TypeScript/Node and actual browser checks remain integration gates.
- Source extraction guard narrowly permits only eight audited decimal Number→string fields and the two dedicated money/preview helpers. Unrelated payloads, business guards, proxies, editor callback/constraint contracts remain frozen.
- Actual browser evidence added to existing owner inventory journey (same login, test count and180s limit). It forwards one real synthetic adjustment, verifies the backend committed response, drops browser transport, awaits requestfailed and visible recovery state, checks no submit control, read-only refresh, then stock/movement/journal reconciliation exactly once. Desktop/mobile viewport screenshots are retained with neutral-theme prefix. Real CI execution/pixel review remain REQUIRED; no local rendered pass claimed.
- No changes to Orders reserve_posting/fulfillment/reversal or financial policy.

## Remaining coverage
This is not all Inventory pages complete. Schema and organization locale/defaults patches are integrated separately below. Same-org role-change cache boundary, deep-link receipt access beyond latest200 and exhaustive page/mobile/keyboard states remain audit items. See workspace `final-admin-audit/INVENTORY-AUDIT.md`.

## Separate locale/defaults patch
- New supplier country defaults from the existing organization context, never hardcoded BD. Missing organization country remains blank. Existing supplier null country/currency remains blank on edit, rather than silently inheriting company defaults.
- Date-only adjustment/purchase/transfer defaults use the organization's calendar timezone, captured once for this document. Existing explicitly entered dates are untouched. Missing/invalid historical timezone falls back to UTC; no schema/timezone settings are changed.
- Focused325/325 pass0skip includes midnight across New York/Dhaka/Kiritimati, US DST spring/fall, invalid timezone and create-vs-edit-null behavior. Real browser/aggregate gates remain pending.

## Review corrections
- Posting acknowledgment requires a nonblank string identity; missing/empty/whitespace success identities enter unknown recovery, never committed state.
- Stock/reorder comparisons now compare exact decimal ratios rather than binary floating-point values. Large adjacent18,4 quantities cannot falsely trigger/clear low-stock classification; malformed values are unknown, not zero.
- Final focused333/333 pass0skip for the frontend candidate before the separately reviewed schema commit. Raw invalid/overflow preview explicitly renders an em dash, not zero.

## Separately reviewed schema patch
Required catalog labels trim before their existing constraints; explicit null for required PATCH fields is rejected before persistence. Optional clears, omitted keys, Unicode/internal spaces and Decimal/tracking policy remain. Supplier ISO values reuse existing supported helpers. Seven actual Pydantic tests pass on the final integrated source and run through the existing inventory-management verification entrypoint. No migration or financial-rule change.

## Aggregate receipt and Decimal-context edge correction
Exact `96fc3b` passed7,869/7,869 full CI Node tests0skip, Next typegen, TypeScript and full frontend ESLint (0errors120warnings), run sequentially under the shared slot. Logs `/tmp/inventory-final-*`.

A later independent edge probe found Python's default Decimal precision28 rounds `1 * 0.0049999999999999999999999999999999` to `0.005000…` before cents HALF_UP, yielding0.01 while unlimited-rational cents would promise0.00. Inventory does not override the global Decimal context (the only app override is a scoped payroll localcontext). The subsequent bounded patch withholds only the preview when quantity×cost or cents×tax-rate intermediate has more than28 significant digits; unchanged raw decimal strings still reach the authoritative backend. Zero and normal18,4 boundary values remain previewable. UI explicitly states the estimate is unavailable rather than showing0. New focused335/335 tests pass; full aggregate receipt above belongs to the prior exact commit, and final integration/CI remains required.
