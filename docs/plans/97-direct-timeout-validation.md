# Validate direct-provider timeouts before secrets

## Issue and problem

- Issue: [#97](https://github.com/Theorvane/OpenGranter/issues/97).
- Direct adapters resolve provider secrets before validating timeout durations, unlike the delegated adapter. Invalid values can trigger runtime exceptions or overflow behavior; mutable configuration can change across secret lookup.

## Scope and expected behavior

- Capture each attempt's timeout before asynchronous work. Accept the existing 30,000-ms default or an integer from 1 through 2,147,483,647 ms, matching the existing delegated bound.
- Invalid configuration raises the existing sanitized `DirectProviderFailure` category other, responseStarted false, possiblyBilled false. Perform no secret resolution or fetch, and do not fallback or create billable attempt usage.
- Use the captured validated duration after secret resolution. This is validation of existing configuration, not a new cancellation or live reload feature.
- No IAM, billing, retry trigger, timeout default, HTTP error, schema, or deployment-config changes.

## Design

- Validate at the direct invoker's per-attempt boundary before lookup of provider credentials. Keep the existing registration/kind checks and safe failure contract.
- Reuse existing non-retryable other-category semantics rather than adding a new externally visible failure category. Runtime-only validation is too late to protect secret lookup and can produce inconsistent failure metadata.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [contract](../../contracts/direct-timeout-validation.md). Operational configuration delivery remains undecided.

## TDD plan

- Through the public direct invoker, reproduce invalid durations reaching secret lookup or returning runtime exceptions instead of sanitized failures.
- Cover all three provider kinds, valid default/minimum/maximum, malformed type/range values, and duration mutation during asynchronous secret lookup.
- Through the chat gateway, verify invalid configuration stops managed fallback, audits a non-billable failure, and writes no usage. Existing provider suites cover secret and upstream failures.
- Implement the smallest captured-duration check, format, and run `npm run check`.

## Delivery

- Issue/plan precede tests and implementation. Record actual red/green and full-check evidence in a ready PR.
- Configurations relying on zero, fractional, or overflow durations now fail safely. Valid durations and default are unchanged. No migration; rollback restores late runtime validation.

## Verification evidence

- Red: 5 regression failures and 3 passing valid/default/bounds cases on the original implementation.
- Green: all 8 focused cases passed after timeout validation and capture; invalid type/range inputs are checked across all three direct providers.
- `npm run check` passed strict TypeScript, Biome, 384 tests, and planning/link/contract/fixture checks. One external PostgreSQL driver test was skipped locally without a database URL; CI supplies PostgreSQL, and embedded database tests passed.
- `git diff --check` passed; `CLAUDE.md` remains linked to `AGENTS.md`. No schema change or live provider calls.
