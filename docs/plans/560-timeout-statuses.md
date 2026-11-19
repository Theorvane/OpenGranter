# Observed upstream timeout HTTP statuses

## Issue and problem

- Issue: [#560](https://github.com/Theorvane/OpenGranter/issues/560), refs #116.
- Registered HTTP408/504 responses currently collapse to502. Preserve those observed protocol facts without guessing an HTTP status from a transport timeout that produced no response.
- Base: PR #559 approved on 4aa74d8281aa772c1f8d1a25de2c9c5359926e79 with all three checks successful, merged as 93e9e8e; #558 closed.

## Scope and expected behavior

- Both bases/all four registered adapters/nonstream and pre-stream text/function JSON failures. /api/v1 preserves exact observed408/504 and matching numeric error.code; /v1 keeps502/symbolic upstream_failed.
- Retain existing classification:408 is other/upstream,504 is server-error. Known failure metadata must match classification, require responseStarted:true and pass route revalidation after required failed-attempt usage/outcome audit.
- Preserve fixed messages/unmapped error_type/request IDs, complete IAM/limits and private missing/possibly-billed accounting. Suppress retry hints for validated408/504 on both bases, including contradictory custom metadata. Existing429/503 hints are unchanged.
- No status inference from timeout categories, arbitrary exception properties or raw error bodies; no new precise cause claim, post-start HTTP/SSE behavior, retry/fallback eligibility, destination, pin/dependency/storage or audit/ledger schema change. Full #116 and unresolved Jev #7 remain open.

## Design

Extend the existing pure status allowlist and scalar union. Nonstream adapters supply only an actually observed HTTP status; stream consumers already classify the response and will supply its status through the same validation. Keep hint parsing restricted to429/503. Known failure constructors and route projection suppress hints when the validated status is408/504, while retaining existing unknown-status handling. Reuse the current nonstream/pre-stream projection; started streams retain generic safe failures.

Alternatives: do not map every timeout category to408/504, since it does not establish an observed response or precise provider cause. Forwarding raw diagnostics or changing fallback rules is unnecessary. Existing accepted compatibility scope covers this bounded increment; no new domain or costly architectural decision is required.

Primary sources checked2026-10-30: [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging), [RFC9110 408](https://www.rfc-editor.org/rfc/rfc9110.html#name-408-request-timeout) and [504](https://www.rfc-editor.org/rfc/rfc9110.html#name-504-gateway-timeout). These define protocol/status distinctions, not a guarantee about provider internals. Update [error contract](../../contracts/openrouter-error-schema.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and handoff.

## TDD plan

- First public-boundary cases: observed408/504 across both bases/all routes/nonstream/text-function streams. Expected red: compatible502 instead of observed status; legacy502/no hints remains green.
- Add admission/required persistence failure and delays, private error/usage assertions, custom missing/malformed/mismatched/no-response metadata, actual transport timeout, post-frame isolation and managed fallback final-outcome cases. Verify contradictory408/504 hints cannot escape through legacy502.
- Actual pinned SDKs with retries disabled must receive correct JSON status without Retry-After on both bases/routes/modes. Existing429/503/status/header, cancellation, tool and signed-Gemini suites remain regression gates.
- Make the minimum implementation after recording red; run focused tests and npm run check. Update obsolete expectations only where the new contract intentionally changes them, preserving other assertions.

## Delivery

Open a ready PR with plan, red/green commands/outcomes and full-check evidence. Clients may change retry behavior when they can distinguish observed codes; probes certify delivery only. Rollback restores the bounded generic502 projection and needs no data migration. Required accounting and denial audit remain unchanged.

## Verification evidence

- Initial red before production changes: 144 cases, 60 expected compatible collapsed-status failures and 84 passes. Minimal implementation made all 144 pass.
- Added typed/untyped/malformed/no-response metadata and contradictory retry-hint cases; the 204-case boundary/core selection passed. Actual OpenAI/OpenRouter/AI SDK probes passed 144 cases with retries disabled and one upstream request.
- Extended existing post-frame and fallback matrices for408/504, preserving generic SSE/interruption errors and final-outcome isolation. Updated only the intentionally superseded408/504 expectations in existing status/hint matrices, retaining other status, privacy and accounting checks. Integrated focused regressions passed 1,067 cases, including all 356 added cases.
- Final npm run check passed: 8,569 total, 8,568 passed, zero failures/cancellations and one optional external PostgreSQL skip (~258 seconds). Typecheck, lint, planning/link/fixture-secret checks and all six offline source-integrity checks passed. Existing 42 lint warnings/65 infos remain unchanged.
- Final document/whitespace/CLAUDE.md symlink checks passed. Six pins, dependencies, migrations and operational schemas are unchanged relative to approved main 93e9e8e.

Red and initial green command on Node22.14:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/observed-timeout-statuses.test.ts
```

Final focused command:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  test/observed-timeout*.test.ts test/sdk-observed-timeouts.test.ts \
  test/prestream-error*.test.ts test/sdk-prestream-errors.test.ts \
  test/upstream-status*.test.ts test/upstream-retry-hints.test.ts \
  test/sdk-upstream-retry-hints.test.ts test/retry-hint-boundaries.test.ts \
  test/managed-http-stream.test.ts test/managed-function-http-stream.test.ts \
  test/managed-text-stream.test.ts test/managed-function-stream.test.ts \
  test/delegated-http-stream.test.ts test/delegated-function-http-stream.test.ts \
  test/sdk-function-stream.test.ts test/sdk-managed-function-stream.test.ts \
  test/sdk-anthropic-function-stream.test.ts test/sdk-google-function-stream.test.ts
```

Full gate:

```sh
taskset -c 0-3 env -u NODE_OPTIONS -u NODE_NO_WARNINGS PATH="/home/ubuntu/.local/bin:$PATH" npm run check
```

## Main integration refresh (2026-11-01)

The user requested completing and merging PR #561. Refresh onto main 70a624adaa15c3bbd27aa3696e25cf2542ff6e31 using a normal merge, without rewriting the approved branch history. Resolve only the four documentation conflicts by preserving both branches' requirements and historical evidence. The original timeout-specific source and test files remain byte-identical except direct-chat.ts, which also retains main's intervening Gemini schema work; its main-relative timeout change is still only observed-status forwarding. Do not weaken assertions, CI, resource limits, dependency pins or accounting controls. Revalidate the integrated tree and require new exact-head CI and formal approval; previous approval does not certify this merge.

Integrated validation: focused timeout/status/hint/SDK/streaming plus current Gemini response-format regressions passed 1,359 tests (zero failures/skips). TypeScript and lint passed (existing warnings/information remain). The standard taskset -c 0,1 npm run check was executed once and FAILED: 8,789 passed, seven file-level SIGKILL failures, one optional external PostgreSQL skip, ~237 seconds. Failed files: model-identifier-metadata, postgres-dual-http-server, postgres-gateway-runtime, postgres-gateway, postgres-policy-simulator, postgres-sso-management-http and proxy-token-lifecycle. No assertion failure was reported; the cause is not established. Cgroup oom_kill rose from 353 to 363 during the run, consistent with resource pressure but not per-test proof. This is not a full local pass; no full retry, concurrency/deadline/assertion weakening or replacement-pass claim. Separately, planning/link/contract/fixture-secret checks, all six offline source-integrity checks and whitespace checks passed. Runtime/tests were unchanged after this run. Fresh GitHub CI and independent formal review remain mandatory.
