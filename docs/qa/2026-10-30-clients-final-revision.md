# Clients final-admin revision — 2026-10-30

## Scope and baseline

Phase 2 after Dashboard. Implementation worktree starts at develop `d23060f9e7038065ecd903545a08aeb68be0f78b`; integration/publishing belongs to the parent task. No production database, migrations, live deployment, source/IP sale, outbound invitations or messages.

## Findings corrected

- Client create names trim before validation; whitespace-only names cannot become blank persisted records. PATCH rejects explicit null required display name/type/status, while omitted fields and optional null clearing retain their contracts.
- Existing supported ISO normalizers validate/normalize client country and currency and effective inherited lead-conversion codes before mutation. No competing ISO list and no broad CRM schema rewrite.
- Large monetary decimal strings use the existing exact formatter in client workspace and services, retaining currency separation and the existing two-decimal accounting policy.
- WhatsApp is visible in the profile; phone fields retain international/free-form extensions with tel keyboards, API-aligned limits, stable accessible labels and described hints.
- Viewer-local timestamps identify their timezone. This is not a new organization/client timezone policy; date-only fields remain date-only.
- Create/edit validation renders a readable inline alert; unsaved fields remain for correction. Edit null country/currency stays empty rather than silently adopting organization defaults.
- Client workspace route reads and edit-drawer reads have ownership/unmount/dismiss guards. Older responses cannot replace a newer selected client or redirect after a dismissed stale401. A mismatched payload is rejected; current read errors have a read-only retry.
- Read-only viewers skip unused form metadata. Managers retain the existing `/crm/meta` permission boundary; client-only managers without `crm.view` remain unable to load editing choices until explicit approval of the separately held minimal client-assignment enumeration endpoint. No new enumeration endpoint is included in this independent commit.
- Client mutation affordances/direct handlers use existing owner/wildcard/clients.manage semantics. Viewer retains View and separate portal permission policy.
- Existing ProjectDialogFocus reused for modal/drawer focus entry, containment, nested selector Escape ownership and return focus (including directory fallback). Synchronous save lock blocks duplicate writes and dismissal/navigation during pending save. Only one create/edit dialog can be open.

## Evidence and boundaries

| Area | Evidence | Status |
| --- | --- | --- |
| Schema and effective conversion validation | 10 real Pydantic/FastAPI-boundary/recording-conversion tests, existing 47 client tests | Local pass; not PostgreSQL proof |
| Backend CI wiring | Existing verify_crm_won_flow invokes new contract tests before existing real PostgreSQL conversion scenario | Authenticated CI pending |
| Handler behavior / redesign immutable guards / shared dialog helper | Focused actual-function tests, exact reviewed before/after hunks; unrelated API payloads/permissions remain checked | Local pass |
| Full frontend Node suite | 7,584/7,585 pass at final local candidate; sole expected browser-count delta owned by integrator | Integration must update count and rerun final tree |
| TypeScript | next typegen + tsc --noEmit | Local pass |
| Scoped ESLint | 0 errors, 8 warnings (existing effect/render conventions) | Pass with warnings |
| Real UI/API journey | clients-final-revision.spec.mjs, one isolated account login/org; invalid/create/edit/null-clear/Unicode/postal/phone, keyboard, desktop/mobile screenshots | Authored; actual CI pending |
| Actual screenshots | neutral-theme-clients-final-* retained by existing artifact rule | Not yet rendered/reviewed |
| Live site | None | Not deployed or verified |

### Coverage not overstated

Directory/create/edit/detail and shared read-format changes are in this patch. Existing resource tabs retain behavior; tests do not certify every note/document/credential/access mutation. Real restricted-role browser verification remains distinct from actual handler authorization tests. Accounting with non-two-decimal currencies is a product-policy decision, not silently changed here. Additional multi-contact/shipping/retention fields were not invented because existing contracts already cover the requested international basics.

### Active integration items

Exact-head aggregate browser count, authenticated PostgreSQL/browser CI, independent pixel review and user approval for the separately held client-assignment metadata endpoint remain gates. Endpoint-specific ASGI/SQLite tests are retained in the held candidate, not this independent tree. Browser token issuance and live deployment are not claimed.
