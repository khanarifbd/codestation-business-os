# Business OS V1 release gates

This file documents repository controls that are applied in GitHub settings, not in application code.

## `develop`

Before external launch, enable branch protection/ruleset for `develop`:

- Require a pull request before merging.
- Require the CI checks `backend`, `frontend`, and `browser-smoke` to pass.
- Require the branch to be up to date before merge when practical.
- Block force pushes and branch deletion.
- Do not allow direct production fixes that bypass the same CI gates.

## `main`

`main` is the production/release branch and must not be used as the active development branch.

For V1 release:

1. Finish and validate the V1 candidate on protected `develop`.
2. Open a release PR from `develop` to `main`; do not manually copy commits.
3. Require the same `backend`, `frontend`, and `browser-smoke` CI checks on the release PR.
4. After the release PR is merged and production verification passes, create the annotated release tag `v1.0.0` from the exact `main` release commit.
5. Keep `main` protected against direct pushes, force pushes, and deletion.

Do not create `v1.0.0` before the V1 candidate has passed production verification. A tag is a release marker, not a way to make an unverified branch production-ready.
