# Automatic and explicit cache control plan

## Issue and problem

- Issue: #448; release gate #116 remains open.
- Automatic root cache_control rejects all explicit tool/text cache directives. Anthropic documents coexistence, reserved slots, eligible-block walkback and final TTL conflict behavior.

## Scope and expected behavior

- Support the existing non-null ephemeral 5m/1h subset jointly on managed Anthropic and delegated OpenRouter, both chat bases and nonstream/text/refusal/function streams. Forward captured root, tool and text directives without synthesizing markers/defaults or moving boundaries.
- Reserve one automatic slot; at most three explicit directives, including when automatic caching is a same-TTL no-op. Validate explicit tools→system→messages order, then automatic target. Omitted TTL is effective 5m only for validation.
- Walk backward past empty text to the last eligible native text/tool definition/tool-use/tool-result block. Same effective TTL on the final explicit block is valid; different TTL rejects. A 1h automatic target cannot follow 5m explicit directives.
- Mixed OpenAI marker/options formats and combined marked tool-result arrays remain unsupported. No rich/native thinking blocks, cache certification, model eligibility changes, conversions, hits, savings or provider-billed cost inference. #7 remains unresolved.
- IAM/Deny/limits, fixed hosts, pre-secret immutable capture, private audit projection, required audit/usage handoffs, missing usage and possibly-billed failures/cancellation remain unchanged.

## Design

- Extend the shared history validator at HTTP and public adapter boundaries. Use captured ChatMessage roles/calls to identify eligible blocks, respecting Anthropic instruction joining/separator behavior and outer tool-result boundaries. Retain provider-specific support guards.
- Forwarding without validation would permit avoidable upstream failures; converting/synthesizing markers changes boundaries. Keep existing mixed-format restrictions where facts do not establish equivalence.
- Dependencies: documented Anthropic automatic cache edge cases and TTL ordering; current OpenRouter root/text/tool schemas. No glossary or ADR change for this reversible wire subset. Native partial nested tool-result caching remains a separate issue.
- Update PRD, architecture, acceptance, compatibility inventory and [contract](../../contracts/automatic-explicit-cache-control.md); supersede earlier blanket root/explicit restrictions explicitly.

## TDD plan

- First tests expect joint root/text/tool controls to return200 and survive exact native/delegated serialization; current implementation returns400 or rejects public invokers.
- Cover three/four explicit boundaries, default/5m equivalence, final TTL mismatch in both directions, long-before-short order, empty trailing parts/messages, instruction separator targets, tools-only fallback, empty tool results, complete function history, root/part getters and credential-time mutation.
- Exercise auth, implicit/model/provider Deny, limits, selection/audit/usage failures, missing/reported usage, opened failures and cancellation through public boundaries. Both installed SDKs use actual local sockets across bases/providers/modes/streams.
- Smallest implementation: remove same-format blanket guard, reserve automatic slot, inspect eligible final target and order; leave wire conversion untouched. Format, focused tests, full npm run check and fresh compatibility:drift.

## Delivery

- Issue/branch/plan, red tests, smallest implementation, focused/full validation, exact published diff review, both required CI jobs, sjungwon03-ai approval and sjungwon03 squash merge.
- Risk: delegated provider behavior/model support varies. Native rules are conservative local admission restrictions; forwarding cannot certify live cache outcomes. Roll back this bounded validator expansion without migrations.
- PR records failure reason/count, final passing tests, source integrity/drift and remaining #116/#7 risks.

## Verification evidence

Support root automatic cache_control with up to three explicit tool/text directives on managed Anthropic and delegated OpenRouter, both chat bases and nonstream/text/refusal/function streams. Preserve exact captured controls/text/tool boundaries without injected defaults. Reserve the automatic slot even for a matching final no-op; validate tools→system→messages TTL ordering and last eligible native block, including empty-text walkback, instruction separators and empty outer tool results. Invalid slot/TTL combinations reject before routing/credentials. OpenAI format mixtures and combined marked tool-result arrays remain unsupported.

TDD: 100 of 152 new public-boundary cases failed on the old blanket restriction (valid requests returned400). After implementation, all152 pass; combined focused new/block/tool tests pass313 and actual OpenAI7.23.0/OpenRouter1.4.18 sockets pass24 tests/48 requests. Streaming persistence fixtures legitimately emit provider content before terminal failure; privacy assertions target caller controls/keys/operational records rather than prohibiting provider output. Previous blanket rejection cases now verify concrete final-TTL/slot failures; new valid cases prove the expanded contract.

Coverage includes auth, implicit/model/provider Deny, limits, required selection/audit/usage handoffs, reported/missing usage, opened failures, cancellation and immutable getter/mutation capture. Fresh fixed-host source drift passes with unchanged version28 projection. No live provider/model/cache certification or billed savings is claimed; broader formats, nested results, full #116 and unresolved #7 remain open.


Full npm run check passes strict types, lint, 4693 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
