# Portable synthetic Hiring UI check

This fixture uses the repository's unchanged three Hiring route defaults, actual
Hiring workspace/model/hooks and normal React rendering. Session/HR permissions,
Next navigation and GET responses are synthetic. It does **not** render the full
Dashboard shell or prove Next SSR, authentication, database or provider behavior.

No package installs, database, account, real records or external resume required.
Use the already installed frontend dependencies and the existing successful Mac
Next build. Do not replace source files or rebuild Next for this fixture.

## Admission and execution (explicit operator release required)

From repository root, independently confirm the supplied Mac build-ID hash:

```sh
shasum -a 256 frontend/.next/BUILD_ID
node --max-old-space-size=768 tools/hiring-ui-check/build.cjs --build-id-sha 49936c3e7d766a4632f5682d4a372404dfc6e7d0f9af5d235585eb1684643d0 --output /private/tmp/hiring-ui-UNIQUE
shasum -a 256 /private/tmp/hiring-ui-UNIQUE/receipt.json
node tools/hiring-ui-check/serve.cjs /private/tmp/hiring-ui-UNIQUE 4179 VERIFIED_RECEIPT_SHA256
```

The output directory must not already exist. The bundle compiler is existing
Next webpack + existing TypeScript loader, not a new framework/install or another
Next production build. All 1500 other pinned source files must match. `.gitignore` may match either the original map or the explicitly approved backup-ignore-only hash `6c63205f35fd1a5465289e554d6992dbd11fe9a223efd630de55456d86a70cb0`; the receipt records which. This non-runtime metadata exception does not change built application source. Tooling is outside
the source projection. The compiler records exact local BUILD_ID, copied built
CSS/font hashes, generated output hashes and network-block observations. The
server binds 127.0.0.1 only and refuses non-GET, wrong Host and non-allowlisted
files. No API proxy exists. CSP disallows connections and external assets.

Open `http://127.0.0.1:4179/dashboard/hr/talent/hiring` in the authorized Mac
browser. Everything is synthetic. Avoid external resume clicks; fixture blocks
ordinary external/legacy navigation. Inspect console for runtime failures.

## Bounded manual checks and honest results

- Normal: Jobs shows 100 loaded (not global total), Candidates 200; switch tabs,
  native GET search, clear, detail, returnTo and referenced-job links; use native
  browser Back/Forward. Returning outside the capped set must not claim server404.
- Candidate `candidate_A_0` in normal mode has rating 0.00, not unavailable.
  External resume is labeled/unfetched. Do not open it.
- Keyboard-only Tab/Shift-Tab/Enter: visible focus, accessible search label,
  detail links and read retry; no mutation controls in actual Hiring workspace.
- Inspect at desktop and 375px viewport (real browser resizing). Long-content
  scenario: check overflow/line-wrap and detail values. Report clipping as a bug,
  never adjust fixture CSS to hide it.
- Empty, error, malformed scenarios: distinguish zero records vs error, no stale
  private detail while error shown, read retry. Deny access after loading hides
  candidate fields immediately; no real permissions assertion.
- Slow/stale401: while request pending change synthetic owner and scenario to
  normal; old401 must not affect current owner. Current401 attempts intercepted
  /login navigation; blocked-navigation banner is fixture instrumentation, not
  actual login success or full router qualification.

Scenario persists across native GET navigation in this origin's sessionStorage;
owner/denied flags are memory-only and reset on full reload. All network data is
in-memory. Record exact URL/scenario/viewport, observed result and receipt hash.
Compile success alone is not browser PASS. Do not run the repository's broader
Playwright scripts: those use authenticated/mutating workflows.

Compile requires 768 MiB V8 heap and has a 120-second event-loop watchdog, not a hard wall-time guarantee during synchronous compiler work. The execution operator must additionally apply a 150-second external process supervisor timeout with process-tree cleanup. A failure preserves output; do not blindly rerun. External/legacy links are also made inert in fixture DOM, including context-menu opening. This intentionally does not qualify real external navigation.

Admission is limited to reported Mac BUILD_ID hash `49936c3e7d766a4632f5682d4a372404dfc6e7d0f9af5d235585eb1684643d0` and source-map hash `cf6c9ae9286fe043ba6a161b4be336dedcdacfd83b72c6632e24595825ee3471`. Paths resolve from this tool directory, not the cloud workspace.

On macOS use `/private/tmp` rather than symlinked `/tmp`; output ancestor symlinks are intentionally rejected.
