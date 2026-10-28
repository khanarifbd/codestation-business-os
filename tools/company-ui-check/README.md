# Bounded actual Company-page synthetic check

Preparation only: no compiler/server/browser run claimed. Base application commit `5ca073c102b9b7fae9f7a7f04dbdef7588dab6ad`; actual Company page SHA256 `8c1ec1c99775564f34138fef3eda0dc413ef23243ff33ee5b615504ee2c7e698`. Six pinned source/package files, plus installed dependency pins (including pnpm-resolved scheduler). Adapted from `64372fe` Hiring fixture; no new dependencies.

Place these nine files at repository `tools/company-ui-check/`. Build only when separately authorized, using a verified SHA256 of the matching local `frontend/.next/BUILD_ID`:
```
node --max-old-space-size=768 tools/company-ui-check/build.cjs --build-id-sha VERIFIED_SHA256 --output /absolute/fresh/outside-repository
```
No hardcoded earlier BUILD_ID accepted. Source/dependency pins and BUILD_ID are checked before and after; existing built CSS/fonts copied unchanged. Source page/form CSS is not rewritten. This component-only diagnostic is NOT a normal Next build or proof that existing built CSS covers every current utility.

Serve only after independently verifying `receipt.json` SHA256:
```
node tools/company-ui-check/serve.cjs /absolute/output 4181 VERIFIED_RECEIPT_SHA256
```
Open `http://127.0.0.1:4181/dashboard/company`. GET-only static loopback server, no backend proxy. CSP blocks connections/images; browser fetch is intercepted for ONLY root settings GET and core/profile PATCH. Other methods/paths/transports/navigation are blocked. No real auth, provider, uploads, documents or database.

Actual modules: Company page, SearchableSelect, company options, API-error formatter. Only Next navigation and unused currency/payment/default panels are stubbed. Fixture banner/journal is visibly separate; it doesn't alter Company markup or styles. Use synthetic input only. Journal records method/path/status/body field names, not field values; inspect `window.__companyFixture.getSnapshot()` or visible journal.

## Manual browser cases — outcomes must be observed, not assumed
1. `initial-get-failure`: first GET500; real unavailable view. Click Retry loading; GET200 and actual form appears. No PATCH.
2. `initial-network-failure`: first GET rejects fetch; real unavailable view must appear (not endless spinner). Retry GET succeeds. `initial-json-failure`: first HTTP200 json() rejects; same recovery, no PATCH.
3. `saved-refresh-failure`: initialGET200. Change Display name to a synthetic value and submit Save changes. Expect corePATCH200, profilePATCH200, refreshGET500; real acknowledged-save warning and Retry loading. Click Retry: only one GET200, no repeat PATCH; saved synthetic name appears.
4. `partial-profile-failure`: initialGET200. Submit General form. corePATCH200 then profilePATCH422. Expect real message that name/business type saved but remaining details not confirmed, including field validation detail. No implicit GET/replay. Reset creates a fresh synthetic scenario.

Required evidence: actual screen state and ordered request journal for each case, source/BUILD_ID/compile receipt hashes. This does not qualify SSR, Dashboard shell, HTTP permissions, SQL transactions, real providers or full application behavior.

## Mac execution envelope (only after explicit release)
From the verified repository root; replace the hash with independently confirmed current BUILD_ID SHA. Use a private fresh parent; the bundle child must NOT exist:
```bash
RUN_ROOT="$(mktemp -d /private/tmp/company-ui-check.XXXXXX)"
python3 - "$PWD/tools/company-ui-check/build.cjs" 81af19d687b6f48dc87021c5f35a0dfd477eefe36baa63e717775b3ca65a49ce "$RUN_ROOT/bundle" <<'PY'
import os, signal, subprocess, sys
p = subprocess.Popen(['node', '--max-old-space-size=768', sys.argv[1], '--build-id-sha', sys.argv[2], '--output', sys.argv[3]], start_new_session=True)
try:
    code = p.wait(timeout=150)
except subprocess.TimeoutExpired:
    os.killpg(p.pid, signal.SIGKILL)
    p.wait()
    raise SystemExit('150-second fixture limit reached; preserve output, do not retry automatically')
raise SystemExit(code)
PY
shasum -a 256 "$RUN_ROOT/bundle/receipt.json"
# Verify that receipt/hash and generated asset map before starting this loopback-only server:
node tools/company-ui-check/serve.cjs "$RUN_ROOT/bundle" 4181 VERIFIED_RECEIPT_SHA256
# Ctrl-C stops this foreground server after browser checks; do not kill unrelated processes.
```
The inner component compile deadline is120s; outer150s explicitly kills only its own process group. Preserve failures/uncertain output. Do not reuse or delete previous output to retry.

Explicit URLs, each fresh scenario starts with reset journal:
- `http://127.0.0.1:4181/dashboard/company?scenario=initial-get-failure`
- `http://127.0.0.1:4181/dashboard/company?scenario=initial-network-failure`
- `http://127.0.0.1:4181/dashboard/company?scenario=initial-json-failure`
- `http://127.0.0.1:4181/dashboard/company?scenario=saved-refresh-failure`
- `http://127.0.0.1:4181/dashboard/company?scenario=partial-profile-failure`

Expected manual request totals: each initial-failure scenario after one Retry has2GET/0PATCH; saved-refresh-failure after one Save and one Retry has3GET/2PATCH (core200,profile200,GET500,GET200 after initialGET); partial-profile-failure after one Save has1GET/2PATCH (core200,profile422), no auto read or repeated write. These are assertions for the observer, not pre-recorded PASS results. No StrictMode wrapper is used in this fixture.

Parent-verified Mac source5ca073c BUILD_ID SHA is `81af19d687b6f48dc87021c5f35a0dfd477eefe36baa63e717775b3ca65a49ce`, from supported `next build --webpack` PASS. Default Turbopack build was BLOCKED by port-bind Operation not permitted; do not call this a default Turbopack success. If loopback fixture serving is denied, stop/report; do not switch OS routes or bypass that denial.
