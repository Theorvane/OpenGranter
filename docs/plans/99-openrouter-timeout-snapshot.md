# Retain the validated OpenRouter timeout

## Issue and problem

- Issue: [#99](https://github.com/Theorvane/OpenGranter/issues/99).
- The delegated adapter validates timeout configuration but rereads it after awaiting secret lookup. A configuration update can change this attempt's duration after validation.

## Scope and expected behavior

- Capture and validate the configured duration once per attempt before secret lookup; use the same value afterwards.
- Preserve the existing 30,000-ms default, inclusive 1 through 2,147,483,647-ms range, and safe configuration failure metadata. Subsequent calls inspect updated configuration.
- No change to IAM, routing bounds, timeout policy, cancellation behavior, secret delivery, retries, billing, schema, or configuration reload support.

## Design

- Read the optional duration into a local variable, resolve only undefined to the existing default, validate it, and use that local duration for the upstream signal.
- Revalidation after credential access would still allow late configuration to change an existing attempt and complicate failure attribution. Capturing the already checked value keeps the behavior deterministic.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [contract](../../contracts/openrouter-timeout-snapshot.md). Deployment configuration delivery remains open.

## TDD plan

- Through the public invoker, mutate a supplied or absent duration during asynchronous secret resolution and verify this attempt still succeeds with its previously validated configuration.
- Verify the next call rejects the updated invalid configuration before resolving another credential; preserve rejection of initially invalid configuration and existing valid/default/upstream behavior.
- Implement the local capture, run focused provider tests, format, and `npm run check`.

## Delivery

- Issue/plan precede implementation. Record red/green evidence and validation in a ready PR.
- Callers changing configuration during an active attempt affect subsequent attempts only. No migration; rollback restores rereading behavior.

## Verification evidence

- Red: two mutation regressions failed on the prior delegated implementation; the initially invalid configuration baseline passed.
- Green: all three focused cases passed after timeout capture.
- Initial `npm run check` passed strict TypeScript, Biome, all local runnable tests, and planning/link/contract/fixture checks. One external PostgreSQL driver test was skipped locally without a database URL; CI supplies PostgreSQL.
- `git diff --check` passed; `CLAUDE.md` remains linked to `AGENTS.md`. No migration or live provider call.

### Integration with the approved direct timeout change

PR #98 became approved during independent implementation and was merged to main. Integrated its direct timeout validation and preserved both additive documentation sections. The combined `npm run check` passed strict TypeScript, Biome, 387 tests, and planning/link/contract/fixture checks. The same external PostgreSQL driver case remained locally skipped; CI supplies PostgreSQL. The delegated production change was unchanged during integration.
