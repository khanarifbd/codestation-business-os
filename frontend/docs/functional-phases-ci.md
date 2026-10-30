# Functional CI compiler-lifetime experiment

The original 60 application tests run exactly once in fixed 52+8 groups. Before starting the frontend, three actual Playwright JSON `--list` reports must prove baseline60 equals disjoint first52 and final8 identities. The final files are personal/client portals and the two quotation print specs. Existing test bodies, assertions, timeouts, fixture headers, retries0 and worker1 are unchanged.

Phase1 preserves the original session-contract project dependency. Only after its entire report verifies52 single-attempt passes and its owned Next process group stops successfully can phase2 run. Phase2 explicitly uses `--no-deps`: the already-successful session dependency is not repeated against the shared rate limit. This is an explicit once-only orchestration change, not a claim that two independent Playwright commands preserve a single internal dependency graph automatically.

The backend process, database, seeded users and all rate limits remain untouched. There is no reseeding, retry, identity rotation or failed-phase restart. Each frontend uses the reviewed descendant-safe development process helper, including its6144MiB V8 heap ceiling, bounded startup and exact-owned-group cleanup. Successful prior tests are never replayed. Any failure stops the sequence.

Reports and screenshots use separate phase directories. The combined summary requires both phase identities and60 passes; only sanitized summary/lifecycle files and existing neutral screenshots are uploaded. Raw Playwright JSON reports remain local to avoid expanding private artifact contents. Existing transport telemetry retains the same256KiB/file and32-file cap: phase2 instrumentation may be absent if phase1 filled this cap. Missing diagnostics are not evidence of health.

This is a bounded CI-only mitigation experiment after two runner-level shutdowns, not proof of OOM or a known application fix. The retained passing CI2363 Next RSS sample was3.73GB, not13GB; failed runs lack terminal memory evidence. Production build still runs separately; development functional execution does not certify production HTTP/runtime behavior.
