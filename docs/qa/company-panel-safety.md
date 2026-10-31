# Company Currency and Gateway parent panel safety

Scope: UI ownership only. No endpoint, permission, provider configuration, database or arithmetic policy changes. Original five Currency mutation payload/URL/method ASTs are pinned, as are the three Gateway parent POST routes and the three unchanged provider child files. The main Company page retains all twelve original action callback ASTs.

Before correction, the actual Currency component's retained Save callback dispatched twice in one turn and once after unmount. The new layout-owned controller synchronously admits one operation, invalidates stale reads, checks current ownership after asynchronous boundaries and locks unknown outcomes. Only meaningful structured definitive rejections are correctable. An acknowledged malformed receipt or failed follow-up read stays acknowledged and locked. Ordinary GET success cannot clear either unresolved state. Explicit leaving warns about retained outcome loss; no automatic retry or provider action occurs.

Parent Company tab/Back now composes Currency and Gateway registered child guards using the existing Defaults identity-safe pattern. Focused tests execute the actual parent controller plus actual child safety hook: pending same-turn tab/Back blocked, unknown Cancel retained. Keyed wrappers retire UI and callbacks on workspace/access changes. Currency requires existing tenant admin role; Gateway reads require existing finance.view and writes existing admin role. Gateway unavailable status does not imply Not connected.

Validation: 127 focused Company tests pass, including actual Company/Finance proxy unreadable422 handling, stale lifecycle callbacks, component Save reproductions, parent composition, original action ASTs and provider-child hashes. Scoped ESLint: zero errors, three existing-style effect warnings. No aggregate, typecheck or browser execution performed in this slice; real rendered/runtime evidence remains pending. No real provider requests, credentials or configuration were used.

Limitations: nested Stripe manual-key, webhook and live-lifecycle controllers are unchanged and not newly certified by parent fieldset disabling. FX Number payload/display precision is a separately authorized follow-up, not changed here. Unresolved outcomes deliberately remain frozen through read-only review, requiring explicit informed exit rather than claiming GET proves nonexecution.

## Separate FX precision correction

Actual FastAPI request/read schema echo proof (synthetic, no production handler/DB/provider) established that Number-converted `12345678.1234567890` becomes `12345678.12345679`, and transition `1234567890.12345678` becomes `1234567890.1234567`. Sending the original decimal string preserves both through the existing Decimal request/read schemas. Existing output strings already preserve precision; no API/schema change is needed.

Manual and optional transition input now use positive finite decimal strings (including scientific notation), retaining blank transition -> null. Existing backend quantization/rounding and ledger arithmetic are unchanged. Display expands scientific strings and groups only the integer using BigInt; all nonzero fractional digits remain visible, so a valid 1E-8 no longer displays as zero. A narrowly reviewed two-argument inverse keeps the original five mutation AST baseline; tampered arguments still fail. An actual component callback test verifies the outbound manual-rate JSON is the original string. No provider action was performed.

Local combined focused receipt: 163 tests passed (Company families, FX, administration guard). Actual schema-boundary proof rerun separately; rendered mobile long-rate wrapping and real browser execution remain pending.
