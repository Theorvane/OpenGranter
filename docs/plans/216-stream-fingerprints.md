# Preserve delegated stream fingerprints

## Issue and problem

- Issue: [#216](https://github.com/Theorvane/OpenGranter/issues/216), related release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- The decoder and client serializer drop optional system_fingerprint metadata, although non-streaming clients receive it. The existing pinned official ChatStreamChunk selects its optional string schema.

## Scope and expected behavior

- Preserve opaque string/omission on delegated text, terminal and final usage chunks. Accept null as the existing local OpenAI compatibility allowance; the official OpenRouter stream schema selects string only. Preserve exact empty/Unicode/newline values with JSON framing.
- Final usage carries its own source fingerprint, even when different, null or omitted; do not infer identity or require cross-chunk equality. Missing usage still emits no fabricated usage frame.
- Malformed values fail safely before a frame or after already delivered frames, with existing possibly-billed failed-attempt accounting and no DONE on failure.
- Keep fingerprints out of audit, ledger metadata, errors and logs. IAM, limits, cancellation, backpressure and accounting-before-final-delivery stay unchanged. Direct/tool/multimodal streams and full conformance remain outside scope.

## Design

- Extend bounded delta/usage events, independent encoder validation, and complete outcome with optional systemFingerprint. Decode the scalar once; retain only the actual usage-event scalar in the sequence; project it when the coordinator synthesizes final frames after required persistence.
- Reusing terminal metadata for the final fingerprint would lose source omission or changing values, so carry usage metadata explicitly. No new domain term or ADR is needed: existing opaque fingerprint semantics apply.
- Sources: [official schema](https://openrouter.ai/openapi.json), checked 2026-10-02, and [existing contract](../../contracts/system-fingerprint.md).
- See updated [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [stream contract](../../contracts/stream-fingerprints.md). Open dependencies include direct/tool streaming, other response metadata, full instance validation and named client workflows.

## TDD plan

- First regression: decode+encode a supplied fingerprint and expect the current omission to fail the equality assertion. Add an actual HTTP native-invoker case for both bases; expect absent metadata before coding.
- Cover string/null/empty/Unicode/framing text and omission on text and both usage layouts; malformed values, safe errors before/after first frame, possible-billing accounting, different/omitted final usage fingerprints, SDK sockets and audit/ledger sanitization.
- Implement minimal projection and usage-outcome capture. Run focused tests, npm run check and offline schema integrity. No source pin expansion is required.

## Delivery

- Issue/plan before code, new branch and PR with red/green evidence. Merge approved prior work only after CI and approval.
- Risk: fingerprints are unverified upstream data, not identity, determinism or authority. Recovery uses existing safe failures/accounting; do not fabricate missing usage or fingerprints.

## Validation evidence

- Red: three fingerprint regressions failed before implementation: decoded/HTTP fingerprints were absent and malformed values did not throw the expected fixed error. Command: node --experimental-strip-types --test --test-name-pattern=fingerprints test/openrouter-stream-chunks.test.ts test/delegated-http-stream.test.ts.
- Green: the three regressions passed after minimal projection/capture. Additional public-boundary tests cover actual usage-event omission/null/different values, safe first/later errors and possible-billing accounting, framing and six installed SDK socket cases across both bases. Audit and ledger metadata exclude supplied fingerprints.
- npm run check passed against merged main: 1,007 tests passed and one existing test was skipped; strict types, lint, planning/links/secret checks and offline source-pin integrity passed. No source pin changed. PR #215 merged after approval and successful CI; integration validation below supersedes this baseline.

- Integration: after approved PR #215 merged, both additions were preserved while resolving overlapping documentation/test appends. npm run check passed again with 1,014 passing tests and one existing skip; strict types, lint, documentation checks and version-6 source-pin integrity passed.
