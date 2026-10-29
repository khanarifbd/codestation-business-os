# Immutable frontend contract inputs

`frontend-original/` contains only original source files consumed by frontend
preservation tests. These are test data, not application code. Keeping them outside
`frontend/` avoids compiling or linting a second historical application.

The original 801-file source archive and the v40 validation companion were recovered
from the user's existing sealed artifacts. Every recovered source byte was checked
against the original baseline manifest; support files were checked against the
original app-support manifest. Archive hashes, member paths and per-file hashes are
recorded in `frontend/evidence/recovered-fixtures-provenance.json`. No browser logs,
authenticated traces or user records are included.

The original runner used one `BASELINE_FRONTEND` for all preservation suites. The
checked-in subset is now the portable default; that explicit environment override
still works. Run the complete suite from `frontend/` with:

```sh
node --test tests/*.test.cjs
```

The integrity test verifies all included original bytes. Do not regenerate the
baseline or its hashes from current application code to make a test pass. Any
missing original input must be recovered from the sealed source and verified first.
