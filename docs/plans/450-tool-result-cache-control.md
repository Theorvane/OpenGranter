# Final tool-result cache directive plan

## Issue and problem

- Issue #450; release gate #116 remains open.
- Native Anthropic rejects all cached result arrays. Its May1,2025 release notes explicitly define promotion of the final nested directive to the parent result, rejecting earlier nested directives.

## Scope and expected behavior

- Map only last-part Anthropic-style cache_control to outer native tool_result, with exact plain inner text blocks/order and no nested cache controls. Keep delegated arrays unchanged.
- Preserve both chat bases, nonstream/text/refusal/function streams, complete IDs/results and adjacent parallel-result grouping. Support omitted/5m/1h TTL and bounded root automatic coexistence with the outer directive as the eligible target.
- Earlier/multiple result markers, empty marked text, OpenAI format mixtures and richer result content remain unsupported for native Anthropic. Combined requests reject earlier markers before routes; existing delegated explicit-only partial-array forwarding is unchanged.
- Shared immutable capture, IAM/Deny/limits/fixed hosts, private operational projections, required audit/usage, reported/missing usage and possibly-billed failures/cancellation remain unchanged. No cache/live/billing claims or model eligibility changes.

## Design

- Add a small final-result boundary validator shared by native conversion and automatic target validation. Native conversion removes the final nested directive and attaches it to the parent block; no concatenation or moved partial boundary.
- Relax native blanket array guard only because conversion now validates final-only semantics before credentials. Existing native helper failure envelopes remain safe.
- Alternative concatenation loses text block shape; arbitrary promotion moves partial boundaries. Keep exact blocks and documented final-only equivalence.
- Dependencies: [official release note](https://platform.claude.com/docs/en/release-notes/overview#may-1-2025), current native tool_result shape and existing version28 source definitions. No glossary/ADR change for reversible wire mapping; richer/mixed mappings and #7 stay open.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/tool-result-cache-control.md), explicitly superseding prior blanket nested-result exclusions only for this subset.

## TDD plan

- First public-boundary tests expect200 and parent-level cache_control for final-only result arrays; existing native code rejects pre-secret and root combinations return400.
- Cover adjacent parallel results, all text/order/Unicode/empty-unmarked preservation, malformed/earlier/duplicate/empty markers, slot/order/default rules, final same/different TTL with empty trailing messages, accessor capture/mutation and safe exported converter failures.
- Exercise both bases/routes/modes/streams, auth/model/provider/implicit Deny, limits and all persistence gates, reported/missing usage, opened failure/cancellation; actual installed SDK sockets verify both providers/bases/streams/modes.
- Small implementation: shared final-boundary helper, native result conversion and eligible-target adjustment; format, focused/full npm run check and fresh compatibility:drift.

## Delivery

- New issue/branch/plan, red evidence, implementation, all validation, exact published diff review, both required check jobs, sjungwon03-ai approval and sjungwon03 squash merge.
- Risk: source guarantees last-block compatibility, not live model caching or arbitrary earlier boundaries. Roll back the bounded native mapping/admission expansion without migrations.
- Report red/green counts, full tests, actual socket matrix, fresh source equality and remaining #116/#7 limitations.

## Verification evidence

Support final-only Anthropic-style cache_control on correlated tool-result text arrays for managed Anthropic and delegated OpenRouter, both chat bases and nonstream/text/refusal/function streams. Native conversion applies the final directive to the parent tool_result under the documented May 1, 2025 backward-compatibility rule and retains exact plain inner text blocks/order/Unicode/empty-unmarked parts. Adjacent parallel results preserve separate boundaries in one native user turn. Delegated arrays remain unchanged. Bounded automatic coexistence uses the outer directive as its eligible target even through trailing empty messages.

TDD: 55 of 67 new cases failed on the previous native/root blanket exclusions. An additional exported-converter regression failed because empty marked final text was accepted without HTTP normalization; the shared boundary guard now rejects it safely. All 68 new tests, 381 focused new/cache-history/tool tests and 24 actual OpenAI 7.23.0/OpenRouter 1.4.18 SDK socket cases (48 requests) pass. The previous combined-result rejection now tests an earlier partial marker; valid final-only coverage proves the contract expansion.

Tests cover omitted/5m/1h final/root TTL collisions, reserved slots/order, parallel results, immutable getter/mutation capture, native unsupported formats, auth/IAM/Deny/limits and all required persistence gates, reported/missing usage, opened failures and cancellation. Native earlier/multiple/empty directives and combined partial results remain rejected without moving boundaries; explicit-only delegated partial forwarding stays unchanged. Full version-28 offline integrity and fresh fixed-host live structural equality pass. No live cache/model certification or provider-billed savings is claimed; richer/partial/mixed mappings, full #116 and unresolved #7 remain open.


Full npm run check passes strict types, lint, 4785 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
