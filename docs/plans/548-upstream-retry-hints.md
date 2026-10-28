# Bounded upstream Retry-After hints

## Issue and problem

- Issue: [#548](https://github.com/Theorvane/OpenGranter/issues/548), refs #116.
- Registered provider nonstream 429/503 responses currently lose Retry-After in both delegated and managed adapters. The client sees safe 502 upstream_failed without the provider's advisory wait interval.
- Primary references checked 2026-10-28: [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) and [RFC 9110 section 10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after). The standard also permits HTTP dates; this bounded increment intentionally supports delta-seconds only.

## Scope and expected behavior

- Both chat bases and all four nonstream adapters retain a canonical Retry-After header from upstream 429/503 only. Existing HTTP502/status/error formats and fixed messages remain unchanged.
- Accept at most 16 ASCII digits representing a nonnegative safe integer; preserve zero and canonicalize leading zeros. Reject dates, fractions/signs, comma/repeated values, oversized/unsafe/private strings and absent values without failing the normal safe error path.
- Only a validated typed scalar flows through known failure classes and route results. Emit after required failed-attempt usage and audit succeed; never persist the hint in operational audit/ledger or put it in an error body.
- No hint on successful completions, other statuses, local admission/configuration/secret/timeout failures or required persistence failure. Preserve current response-start/possible-billing/fallback behavior. No automatic gateway retries or sleeps.
- Out of scope: error-cause/status parity, HTTP dates, streaming headers/error frames, retry eligibility/capacity promises, client-driven routing, full #116 and unresolved Jev #7.

## Design

Add a pure bounded parser/validator, capture the selected response header in the two nonstream adapter boundaries, and extend existing failure/result types with optional retryAfterSeconds. Coordinators project only valid retry-category hints after their existing usage/audit handoffs. The fixed error serializer adds only the canonical header to502 upstream_failed; bodies and other error serialization stay unchanged. Revalidate the scalar at projection boundaries so malformed custom adapter values cannot become arbitrary header text.

A header-only increment preserves existing status/cause semantics; broad status remapping would need a separate contract. Delta-seconds avoids inventing a trusted clock/date-normalization policy. No new domain terms or ADR-worthy trade-off is introduced.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [error contract](../../contracts/openrouter-error-schema.md) and handoff.

## TDD plan

- First add public gateway cases using real native/delegated adapters with429/503 and valid Retry-After. Expect missing-header failures before implementation and record them.
- Cover zero/leading zeros/safe-integer bounds, malformed/private/repeated/date values, other statuses, successful responses, auth/IAM/limit/selection/usage/outcome-audit gates and scalar privacy. Verify existing possible-billing records and no altered fallback.
- Add pinned OpenAI/OpenRouter/AI SDK loopback cases with retries disabled; inspect actual response headers without caller wire rewrites or live inference.
- Run focused provider/routing/error/SDK tests, typecheck/Biome and npm run check with the documented CPU-affinity gate.

## Delivery

Implement the smallest typed-header change after the recorded red; keep existing contracts/tests green. Rollback removes hint propagation only. Advisory values may be stale or overly conservative, and a retry may still duplicate provider work. Full error parity is not claimed.

## Verification evidence

- Red before production changes: node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/upstream-retry-hints.test.ts ran 96 cases: 64 expected missing-header failures, 32 passes.
- Green after minimal typed propagation: all 96 public cases passed. Final focused selection of the three new retry suites plus safe-client-errors, direct-chat, openrouter-chat, delegated-chat-handler, ordered-managed-route and gateway-usage-capture passed 218 cases. This includes 48 actual pinned-client socket cases and delayed required-handoff tests.
- Full npm run check passed: 7,637 total, 7,636 passed, zero failures/cancellations, one optional external PostgreSQL skip (~253 seconds). Typecheck, Biome, planning/links/fixture-secret scan and all six offline source-pin integrity checks passed. Existing 42 lint warnings/65 infos remain unchanged.
- git diff --check and CLAUDE.md symlink checks passed. All six source-pin files, dependencies and migrations are byte-unchanged. No live inference, secret or blind source refresh was used.
- Exact-header delivery is certified only for the bounded nonstream subset. HTTP dates, streaming, 402 budget hints, precise causes/status parity and automatic backoff remain separate work.
