# Pre-stream upstream status and retry hints

## Issue and problem

- Issue: [#558](https://github.com/Theorvane/OpenGranter/issues/558), refs #116.
- Compatible nonstream429/503 are preserved under #554, but stream:true text/function requests discard observed status/hints before client streaming begins. These failures are still plain JSON boundaries.
- Base: PR #557 approved on 59791e017c8bb728bfa2a9d34ef78db07a61ed53 with all three checks successful, merged as 491c3e8; #556 closed.

## Scope and expected behavior

- Both bases/all four registered adapters/text and function streams capture exact observed upstream429/503 and existing bounded integer-seconds Retry-After. Keep classifications, response-start/possible-billing flags and best-effort cancellation unchanged.
- Before the first client SSE frame, /api/v1 preserves observed429/503 with matching numeric error.code; /v1 keeps502/symbolic errors. Both may supply the canonical hint after required failed-attempt usage/outcome audit.
- Already-started streams keep HTTP200 and existing safe SSE failures, excluding new upstream status/hint projection. Local/persistence/cancellation errors, other statuses and success cannot inherit hints/status. No raw provider content/headers enters operational records/errors.
- No retry/sleep/fallback change, exact cause parsing, billed-cost inference, pin/dependency/storage change or full #116 claim. Jev #7 remains unresolved.

## Design

Reuse the #548 hint parser and #554 failure scalar validation. Existing stream HTTP response consumers capture bounded metadata only from a known rejected HTTP response. Existing route coordinators revalidate it after required persistence. The shared HTTP streaming adapter uses it only before client delivery starts; post-frame errors retain existing generic status semantics. Cancellation/interruption or persistence errors clear advisory metadata.

Update [error contract](../../contracts/openrouter-error-schema.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and handoff. Primary sources checked2026-10-29: [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) and [streaming](https://openrouter.ai/docs/api_reference/streaming). No new domain/architectural decision is required.

## TDD plan

- First public HTTP tests: stream:true text/function requests with registered429/503 and safe hints on both bases/all four adapters. Expected red: collapsed502 or missing canonical header.
- Additional cases: absent/malformed/date hints, unrelated statuses/invalid200 streams, auth/model/provider/limit/selection denials, delayed/failed usage/outcome audit, arbitrary/custom metadata, post-frame failures, unchanged same-kind fallback and cancellation accounting.
- Actual pinned OpenAI/OpenRouter/AI SDK clients receive pre-stream JSON status/header with retries disabled; assert one upstream attempt and private missing/possibly-billed usage.
- Make the smallest consumer/HTTP adapter change, run focused regressions, npm run check, document red/green evidence and open a ready PR.

## Delivery

Rollback the bounded metadata capture/projection to generic errors if needed. No persisted data conversion or schema migration. Keep partial/missing accounting and possible duplicate flags unchanged; advisory retry hints never promise free retry or availability. Full error/status/type/date/402 and client conformance remain open.

## Verification evidence

- Initial public-boundary red: 144 cases, 104 expected collapsed-status/missing-hint failures and 40 passes. No production changes preceded this reproduction. After minimal capture/projection changes, all 144 passed.
- Actual pinned OpenAI/OpenRouter/AI SDK JSON pre-stream error probes passed 96 cases with retries disabled, one provider attempt and unchanged private missing/possibly-billed accounting.
- Added post-frame/unclassified metadata isolation, interruption-audit failure and managed fallback success/generic/final-hint regressions. The final focused status/hint/SDK/HTTP-stream/routing selection passed 580 cases, including all 268 new cases.
- First full gate found 9 existing SDK assertions expecting the superseded compatible pre-stream429-to502 mapping (8 ordinary socket cases and one raw signed-Gemini gate). Updated only those pre-stream compatible expectations to429, retaining legacy502, invalid-response502 and all midstream/persistence/privacy assertions. No further production change was needed. The integrated focused selection including these four existing SDK suites passed 711 cases.
- Final npm run check passed: 8,213 total, 8,212 passed, zero failures/cancellations and one optional external PostgreSQL skip (~244 seconds). Typecheck, lint, planning/link/fixture-secret checks and all six offline source-integrity checks passed; existing 42 lint warnings/65 infos remain unchanged.
- Final document/whitespace/CLAUDE.md symlink checks passed. Six source pins, dependencies, migrations and ledger/audit schemas remain unchanged relative to approved main 491c3e8.

Red and initial green used the same command on Node 22.14:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/prestream-errors.test.ts
```

The final focused command was:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  test/prestream-error*.test.ts test/sdk-prestream-errors.test.ts \
  test/upstream-status*.test.ts test/upstream-retry-hints.test.ts \
  test/sdk-upstream-retry-hints.test.ts test/retry-hint-boundaries.test.ts \
  test/managed-http-stream.test.ts test/managed-function-http-stream.test.ts \
  test/managed-text-stream.test.ts test/managed-function-stream.test.ts \
  test/delegated-http-stream.test.ts test/delegated-function-http-stream.test.ts \
  test/sdk-function-stream.test.ts test/sdk-managed-function-stream.test.ts \
  test/sdk-anthropic-function-stream.test.ts test/sdk-google-function-stream.test.ts
```

The full gate uses the established constrained-environment command:

```sh
taskset -c 0-3 env -u NODE_OPTIONS -u NODE_NO_WARNINGS PATH="/home/ubuntu/.local/bin:$PATH" npm run check
```
