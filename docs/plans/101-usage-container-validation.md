# Distinguish malformed provider usage containers

## Issue and problem

- Issue: [#101](https://github.com/Theorvane/OpenGranter/issues/101).
- Provider adapters discard the shape of usage containers before projecting counters, so malformed containers become missing rather than invalid in accounting.

## Scope and expected behavior

- For OpenAI, Anthropic, Gemini, and OpenRouter, absent/null usage remains missing. Non-null primitive or array containers become a safe invalid marker.
- Object containers retain the existing recognized-counter projection, including partial counts and sanitized invalid counters. Empty and unrecognized-only objects remain missing.
- A normalized invalid container is represented as total_tokens null, allowing existing ledger classification without arbitrary raw values. Successful completion text remains successful.
- No schema, billing amount, quota, reconciliation, routing, IAM, provider-specific request, or content-audit change.

## Design

- Add a pure shared container boundary around the existing counter projector. Adapter-supplied field names select recognized counters after object validation; no raw container is copied.
- Use the existing invalid-counter marker instead of retaining malformed data or introducing a new ledger status. Dropping container errors would continue hiding upstream reporting quality.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [container contract](../../contracts/provider-usage-containers.md), and existing direct/delegated usage contracts. Billing/reconciliation decisions remain open.

## TDD plan

- Through actual adapter invokers and `createChatHandler`, reproduce string/array/number/boolean containers producing missing records.
- Cover all four families with malformed containers and absent/null/empty/unrecognized baselines. Assert normalized response, ledger state, successful outcome, and exclusion of raw invalid data.
- Implement shared validation and update adapter calls. Keep existing partial/invalid-counter suites green, format, and run `npm run check`.

## Delivery

- Issue/plan precede tests and production changes. Include actual red/green and validation evidence in a ready PR.
- Clients must accept the existing null-counter representation when upstream usage containers are malformed. No migration; rollback restores missing classification.

## Verification evidence

- Red: all 16 malformed-container cases failed while all 16 absent/null/empty/unrecognized baselines passed across the four adapters.
- Green: all 32 adapter-to-gateway regression cases passed after the shared container boundary was applied.
- `npm run check` passed strict TypeScript, Biome, 419 tests, and planning/link/contract/fixture checks. One external PostgreSQL driver case was skipped locally without a database URL; CI supplies PostgreSQL. Embedded database tests and existing partial/invalid-counter, authorization, secret, and upstream-failure suites passed.
- `git diff --check` passed; `CLAUDE.md` remains linked to `AGENTS.md`. No schema changes or live provider calls.
