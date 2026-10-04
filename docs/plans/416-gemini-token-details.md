# Gemini informational token details

## Issue and problem

Issue: [#416](https://github.com/Theorvane/OpenGranter/issues/416). Managed Google adapters preserve native aggregate usage but discard reported cachedContentTokenCount and thoughtsTokenCount. Compatible clients already understand the corresponding bounded ChatUsage detail fields.

## Scope and expected behavior

Map nonnegative safe integer cachedContentTokenCount to prompt_tokens_details.cached_tokens and thoughtsTokenCount to completion_tokens_details.reasoning_tokens in supported nonstream text/safety/function completions and text/function SSE on both bases. Native omitted/null counters remain omitted; zero remains zero. Invalid categories omit only their group. Preserve aggregate classification and reported Google total exactly; details alone cannot manufacture usage or a final usage frame.

Categories are informational client output. Never add/subtract them from aggregates, infer relationships, change billed/estimated cost, or persist new ledger fields. Final stream categories come only from terminal usage or its permitted replacement tail; never merge earlier details. Required ledger/audit persistence still precedes final usage/DONE. Authentication, complete model/provider IAM, Deny, limits, fixed hosts, cancellation and private operational records remain shared.

Out of scope: thinking defaults/eligibility, native thought bodies, cached-content requests, category ledger migration, Anthropic/modality/server-tool categories, live upstream certification, SDK/schema pin updates, full #116 and unresolved #7.

## Design

Reuse normalizeProviderUsage with native field names and deriveTotal=false. A shared Google ChatUsage normalizer maps only the two supplied native counters and returns an immutable allowlisted snapshot through snapshotChatUsage. Use it at nonstream and both stream terminal/tail boundaries. Prefer this over adapter-specific duplication or adding details to aggregate accounting.

Official [UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata) distinguishes prompt, candidate, cached and thought counts. [ProtoJSON](https://protobuf.dev/programming-guides/json/) treats null as unset. The existing detail contracts permit independently supplied categories without sum/subset inference. Repository grilling delegated source/environment facts; no new domain term, costly ADR or unresolved product decision is required for this reversible projection.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [contract](../../contracts/gemini-token-details.md) and historical category contracts with this extension.

## TDD plan

First add public adapter/HTTP cases asserting reported native cached/reasoning detail fields. Expected red: current aggregate-only normalizers omit both groups. Cover zero, omitted/null/invalid values independently, unknown/cost payloads, partial/invalid/missing aggregate usage, detail-only containers, nonstream text/safety/functions, final stream replacement and no earlier recovery, immutable captures, both SDKs/bases, required persistence failures and pre-secret denial.

Implement the smallest shared normalizer and wire three existing adapters. Update the reported-total regression expectation to include supplied reasoning details without changing ledger assertions. Verify stored direct/dual generated adapters with native categories, aggregate-only private records and fresh Deny. Run npm run format, focused tests and npm run check; record red/green evidence.

## Delivery

Create issue and new issue-numbered branch before coding. Link plan/contract, source and TDD evidence in the PR. Review exact head as sjungwon03-ai, require both exact-head CI checks, then squash merge as sjungwon03 and synchronize clean main. Rollback removes only optional output categories; ledger/schema/defaults remain unchanged. Fixture conformance does not certify live providers or complete detailed billing.

## Verification evidence

Managed Google adapters previously discarded reported cached and thought token counts. Preserve valid cachedContentTokenCount as prompt_tokens_details.cached_tokens and thoughtsTokenCount as completion_tokens_details.reasoning_tokens through one shared immutable ChatUsage projection, used by nonstream text/safety/functions and terminal/replacement-tail text/function SSE on both API bases.

Preserve zero, independently omit absent/null/invalid native categories, ignore unknown/native modality/tool/cost/OpenAI-shaped groups, and never derive Google totals, add/subtract categories or infer subset relationships. A usage-only tail replaces earlier categories rather than merging them; detail-only usage remains missing. Complete valid aggregates and required ledger/audit handoffs still govern final usage/DONE. Category fields remain client-only: aggregate ledger schema, prices, attempt count, IAM, limits, fixed registered hosts, cancellation and thinking/default/model eligibility remain unchanged.

TDD: 132 new public HTTP/SDK/immutable-boundary cases produced 50 expected missing-category failures and 82 passing omission/security/accounting checks before implementation. Six existing generated PostgreSQL direct/dual server cases separately failed on missing categories before wiring the normalizer. Focused green verification passes 150 cases: all 132 additions, twelve updated reported-total regressions and six stored-server cases. Both installed OpenAI 7.23.0 and OpenRouter 1.4.18 SDKs complete nonstream/text/function socket workflows on both bases (twelve successful client requests). Required usage/audit failure, pre-secret authentication/model/provider Deny/limits, sparse/invalid/detail-only aggregates, tail replacement, immutable captures, private operational records and fresh stored-provider Deny remain covered.

No native thought body or cached-content request support, category ledger migration, billed-cost reconciliation, live-provider certification, SDK/schema pin update or new product decision. Other native/modality/server-tool categories, full #116 and unresolved #7 remain open. Refresh the compatibility checkpoint to the previously verified fifty OpenCode probes without claiming a new installed-client run for this category change. Official source and bounded behavior are linked in the English plan/contract.


Full npm run check passes strict types, lint, 2638 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
