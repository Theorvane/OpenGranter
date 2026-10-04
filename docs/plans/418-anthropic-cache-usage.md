# Anthropic cache-aware usage accounting

## Issue and problem

Issue: [#418](https://github.com/Theorvane/OpenGranter/issues/418). Anthropic input_tokens excludes cache_creation_input_tokens and cache_read_input_tokens. Existing nonstream text/refusal/functions and both native stream consumers discard these reported disjoint counts, undercounting new prompt/total ledger records and client usage.

## Scope and expected behavior

Include valid reported native cache counts in prompt normalization once; derive prompt+output total within safe integer bounds. Expose supplied valid cache reads/writes as optional prompt_tokens_details.cached_tokens/cache_write_tokens. Categories are client-only, never added again to already normalized aggregates or interpreted as billed cost.

Both cache fields wholly absent retain the historical input/output-only mapping, without certifying full cache/billing reporting. Any initial/nonstream cache field present requires known valid base input and both cache components before a complete prompt sum. Missing/null components make the prompt/total unavailable; malformed or unsafe counts/sums make the prompt invalid. Do not silently treat unknown cache counts as zero. Independently valid optional detail counters remain observable on sparse legacy usage, while compatible incomplete usage stays omitted. Details alone cannot manufacture prompt or total usage.

Stream input/cache counters retain their captured values across omitted/null deltas and replace nonnull supplied updates, matching the official SDK's cumulative semantics. Never add event snapshots. Capture final output from the latest message_delta; initial output estimates cannot fill a missing final count. Required ledger/audit handoffs precede final usage/DONE. Authentication, complete model/provider IAM/Deny, limits, registered hosts, cancellation and private operational records stay shared.

Out of scope: historical record rewrite, storage migration, pricing/billed-cost authority, cache requests/defaults, thinking/models, TTL/modalities/server-tool details, schema/SDK pins, live upstreams, full #116 and unresolved #7.

## Design

Create one immutable allowlisted Anthropic usage normalizer and a small internal per-stream counter snapshot shared by text/function consumers. Keep only recognized scalar counters; sanitize malformed values to an invalid marker. The normalizer computes native disjoint prompt partitions, then reuses existing total derivation and ChatUsage snapshots. Stream fields update individually; this intentionally differs from Gemini's final complete-usage replacement rule.

The [Messages reference](https://platform.claude.com/docs/en/api/messages/create) and [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) specify the input partition sum. [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) and the [official SDK accumulator](https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/lib/MessageStream.ts) specify cumulative nonnull input/cache replacements. Initial nullable cache fields have no documented zero meaning; apply the repository's existing unknown-usage invariant rather than introducing a zero assumption. The wholly absent legacy convention remains explicitly bounded for compatibility. Repository grilling delegated facts; no new glossary term or costly ADR is needed.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [contract](../../contracts/anthropic-cache-usage.md), and historical native/category/availability contracts.

## TDD plan

First public cases: input=3, cache-write=4, cache-read=5, output=2 must yield prompt=12,total=14, with exact optional read/write details and one corrected aggregate-only ledger record. Expected red: current prompt=3,total=5 and missing details. Cover nonstream text/refusal/functions and native text/function streams on both bases, zero, legacy absence, explicit unknown/invalid/cache-only/unsafe sums, independently valid details, cumulative updates with omitted/null retention, missing final output, immutable capture, SDKs, stored direct/dual records, fresh Deny and required persistence failure.

Implement minimal shared normalizer/snapshot and wire all existing native paths. Run npm run format, focused tests and npm run check; report expected red and green evidence. Earlier Gemini/OpenAI categories must never join aggregates through this provider-specific fix.

## Delivery

Issue and branch precede plan and code. Link plan/contract, actual SDK/stored evidence and material limits in PR. Review exact head as sjungwon03-ai, require both exact-head CI checks, squash merge as sjungwon03 and synchronize clean main. Rollback restores previous normalization for future records; previously recorded values are not rewritten. This fixes reported cache accounting only, not provider-billed reconciliation or complete compatibility.

## Verification evidence

Anthropic input_tokens excludes reported cache-creation and cache-read partitions. Current managed adapters dropped those counters, undercounting prompt/total usage. Normalize their native sum exactly once in nonstream text/refusal/functions and text/function SSE, expose valid read/write counters as optional immutable prompt details, and persist corrected aggregates in each new attempt record. Example input=3,write=4,read=5,output=2 changes prompt/total from 3/5 to 12/14. Projected details never add another count or become billed cost.

Capture recognized scalar counters only. Both cache fields wholly absent retain the historical bounded input/output mapping without certifying full cache reporting. Explicit cache reporting requires known valid base input and both components: missing/null data remains unavailable, invalid/overflow counts cannot yield reported usage, and details alone cannot manufacture input. Compatible incomplete usage stays omitted; legacy sparse counters retain independently valid optional details.

Stream input/cache counters use cumulative nonnull field replacements, preserving previous reports across omitted/null deltas as the official SDK does. Do not sum snapshots. Final output comes only from the latest message_delta, never an initial output estimate. Required ledger/audit still precedes final usage/DONE; registered hosts, model/provider IAM/Deny, limits, cancellation, privacy and one-per-attempt accounting remain shared.

TDD: 166 focused cases before implementation produced 94 expected aggregate/detail/snapshot failures and 72 passing legacy/security/omission boundaries. That includes 160 new public HTTP/SDK/immutable-boundary regressions and six existing stored direct/dual cases extended with caches. Green focused verification passes 302 cases, including existing native stream malformed/cancel/usage-availability regressions. Both installed OpenAI 7.23.0 and OpenRouter 1.4.18 SDKs verify nonstream/text/function sockets on both bases (twelve successful client requests). Six stored direct/dual cases assert corrected aggregate-only JSON records, actual Anthropic identity, privacy, required persistence failure and fresh provider Deny.

No historical record rewrite, ledger migration, prices/billed-cost authority, cache requests/defaults, thinking/model policy, SDK or schema pin update, live-provider certification or new product decision. TTL/modalities/server-tool details, complete billing reconciliation, full #116 and unresolved #7 remain open. English plan/contracts link official native partition and cumulative-update evidence.


Full npm run check passes strict types, lint, 2798 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
