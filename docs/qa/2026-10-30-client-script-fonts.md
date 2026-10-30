# Clients Unicode rendering correction

## Evidence

CI2339 passed all58 functional browser cases, but actual directory/detail/mobile
pixels showed missing Bengali and Japanese company-suffix glyphs. Data/DOM Unicode
roundtrip assertions passed; Latin accents rendered. Root Inter configuration and
Next's installed font metadata lack those scripts. The prior browser environment
therefore depended on OS fallback fonts. Do not describe this as corrupted client
data, or substitute ASCII test names to hide it.

## Scoped implementation

Keep Inter first for sans/heading typography and Geist Mono unchanged. Append
Next-self-hosted Noto Sans Bengali, then Noto Sans JP, then system-ui/sans-serif.
Both added families have preload:false and adjustFontFallback:false; only
Unicode-range shards selected by actual text need loading. There are no workflow,
permissions, palette, geometry or external production-network changes. JP is a
deliberate fallback for the existing Japanese 株式会社 fixture, not language
inference or a comprehensive international-font solution. Official OFL notices
are served under /fonts/licenses/ with their original headers and source hashes.

## Local emitted asset measurement

Webpack font compilation emitted these actual assets (bytes, not compressed HTTP
transfer sizes):

| Family | Shards | Total build bytes |
|---|---:|---:|
| Inter (unchanged) | 7 | 218888 |
| Geist Mono (unchanged) | 6 | 70516 |
| Noto Sans Bengali | 3 | 147144 |
| Noto Sans JP | 124 | 5470704 |

All140 font-face rules have Unicode ranges. For the fixture's non-Latin characters,
range intersection selects one Bengali shard107884B and one Japanese shard13004B.
This is a static eligibility estimate, NOT measured browser transfer. The build
stores all5.62MB of added assets but does not preload that collection. CI logs
actual font request URLs and Chrome platform-font glyph counts for verification.

## Verification gates

Dedicated unit checks reject a glyph probe that sees only Latin, only system Noto,
unused Noto, or missing Inter. Real E2E waits for document.fonts.ready and two
animation frames, then asks Chrome CSS.getPlatformFontsForNode for actual used
self-hosted Noto+Inter glyphs on existing content before all4 screenshots. It also
asserts every font request remains same-origin. All original Unicode fixtures and
functional assertions are retained.

Local default Turbopack build is blocked by the workspace's node_modules symlink
outside its detected root. A supported webpack build compiled in102s and emitted
assets, then reported a generic typecheck failure; standalone tsc passed. Do not
claim full production-build or visual success from compilation alone. Exact-head
CI build,58 browser cases, actual glyph logs and independent pixel review remain
mandatory before merge. No live deployment performed.

## Final local checkpoint

- Dedicated font/protocol tests:7/7 pass; standalone TypeScript passes.
- Full concurrent suite:7563 pass, one file-level failure in the unchanged
  accounting-payables-presentation.test.cjs without assertion diagnostics; zero
  skips. Preserve this inconclusive aggregate, do not label it green. Parent
  serial integration/CI verification is required.
- Exact emitted-family totals and fixture-eligible file names are recorded in
  2026-10-30-client-script-font-assets.json. Chromium resource timing will log
  transferSize/encodedBodySize/decodedBodySize, with cached-zero caveat.
