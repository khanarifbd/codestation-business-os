# Full 149-entrypoint source test support (not a test PASS)

33 immutable historical oracle/preimage/provenance files: 706,907 bytes. `manifest.json` records exact hashes and producer origins; origin paths document provenance, not required Mac paths. Source files and tests are unchanged. Existing Node network guard is preserved exactly. This is the previously admitted bounded support set, not a new claim of minimality established by runtime instrumentation.

## Baseline — materialize independently on the Mac
Existing Library file `libfile_e6dd693589908191afe6e619eac40a32`, version9, `Business_OS_Expanded_QA_Source_Evidence_Backup_Independent.zip`.
Outer ZIP: 2,700,263 bytes; SHA256 `9cb00885c80ae292213a15e7854b5af395b704275b6b17a4089c232426b4ec7e`.
Use supported Library materialization on the Mac (read-only existing file; no new Library writes). Extract nested `BusinessOS_Expanded_QA_Backup/source.zip` into a separate baseline folder. It contains801 source files. Never extract over the working checkout. Set the command below to that extracted `frontend` directory. The runner verifies all801 baseline hashes before doing anything.

## Command from repository root
First admission-only (does not install fixtures or execute tests):
```
python3 tools/hiring-ui-check-support/run.py --baseline-frontend '/absolute/baseline/source/frontend'
```
When authorized to execute, use a fresh results directory outside the checkout:
```
python3 tools/hiring-ui-check-support/run.py --baseline-frontend '/absolute/baseline/source/frontend' --run --output '/absolute/new/hiring-full149-results'
```
This installs only33 exact support files at their required frontend evidence/review paths, refusing different existing files. It runs every pinned149 `.test.cjs` entrypoint serially with2GiB Node heap, clean HOME/environment, BASELINE_FRONTEND and BACKEND_SOURCE explicit, network guard preload and1200s timeout. Dependencies must already be installed according to the repository lockfile. Test count is measured from TAP, never forced to an old total. Any failed/cancelled/skipped/todo case means failure. No real browser, backend aggregate, database, provider, build or production qualification is implied. Do not automatically retry uncertain results.

Guard is process-local and does not audit attempted connections or provide OS network isolation. Code snippets/mock data reviewed for credentials/private records: no live credentials or client records identified; synthetic oracle vectors and code preimages only. No Mac materialization or tests have been performed by the preparer.
