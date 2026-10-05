# Explicit prompt cache controls

## Issue and problem

Issue: [#434](https://github.com/Theorvane/OpenGranter/issues/434), continuing #116 after #432. Both chat bases reject optional top-level cache_control despite verified OpenRouter and native Anthropic support.

## Scope and expected behavior

Accept non-nullable optional {type:"ephemeral",ttl?:"5m"|"1h"} on delegated OpenRouter/managed Anthropic nonstream/stream text/refusal/function requests. Preserve supplied TTL exactly; omission injects no directive/default TTL. Validate known fields and capture/freeze once before async credentials. Null/malformed/extra fields and unknown future TTLs reject before routing as an explicit local bounded subset. Native Anthropic nullable cache_control remains an extension gap because the public OpenRouter field is non-nullable. Native OpenAI/Gemini supplied directives reject before secrets without translating to prompt_cache_key/options or cachedContent. Existing administrator output caps, declarations/history translation and approved destinations remain effective.

Top-level automatic caching marks the upstream last cacheable block; this does not change prompt text, authorize a destination or create local content audit/retention. Model/provider cache support, minimum token thresholds, endpoint limits and upstream errors remain provider behavior. No cache hit, savings, TTL accounting, billed cost or token usage is synthesized. Preserve existing reported cache-aware aggregates/categories, missing usage, per-attempt accounting, required audit/ledger before final delivery and cancellation. Out of scope: explicit block breakpoints, mixed TTL configuration, native OpenAI/Google mappings, server tools, cache resources/ownership, tier/session routing, unknown TTLs, full #116 and unresolved #7.

## Design

Add a pure directive snapshot helper to gateway and both request adapters. Forward only to fixed registered OpenRouter/Anthropic URLs after complete approved model/provider IAM and limits. Native Anthropic uses its existing version header; add no beta header or generated defaults. Capture known own fields with normal/null prototypes; unsupported shapes/accessor failures produce existing safe errors. No new glossary term or costly architecture trade-off is introduced.

Repository grilling delegates primary-source/installed-SDK facts from [OpenRouter OpenAPI](https://openrouter.ai/openapi.json), [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching), [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) and [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create). SDK cacheControl maps to wire cache_control; the source TTL open-enum extension does not certify unknown semantics. Restrict runtime TTLs explicitly while preserving the extension in source coverage.

Version 24 adds only cache_control and whole AnthropicCacheControlDirective/AnthropicCacheControlTtl to 29 request fields and 16 request/history definitions. Removing exactly those selections must reproduce version 23 canonically. Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [contract](../../contracts/cache-control.md) and schema drift contract.

## TDD plan

First public HTTP/native/delegated and actual SDK tests expect exact optional directives: red reproduces unknown-field rejection/dropped fields. Cover omitted TTL/5m/1h, null/invalid/unknown/extra fields, non-record prototypes, mutable/throwing root/type/TTL getters, preserved output caps, independent user/cache preferences, both bases and all modes, no manufactured usage, auth/implicit/model/provider Deny, limits, required selection/outcome audit/ledger failure, sanitized opened failures and native unsupported rejection/defaults. Reuse established fixture transports and native text/function frames; assert cache-aware reported counters stay independent of the directive. Structural tests traverse directive and TTL even with unchanged request references, cover enum/default/null/required/bounds/extensions/annotations, missing/malformed sources and stale/rehashed invalid pin maps.

After observed red, implement minimum capture/projection. Format, focused regressions, full npm run check and explicit fixed-host compatibility:drift. No live inference tests.

## Delivery

Issue/new branch/plan precede implementation. PR records source/projection provenance, canonical equality, red/green, SDK fixture limits and remaining provider/model gaps. Exact-head sjungwon03-ai approval plus both CI precede sjungwon03 squash merge and clean main synchronization. Rollback removes optional forwarding and reverts projector/pin together; no storage migration.

## Reviewed provenance and upstream limits

Fresh fixed-host source on 2026-10-05 retains canonical SHA-256 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458. Version-24 projection SHA-256 is 740eb23ab1f0aba16debd3644680a8fa415cb396989f42737fbc571e43cad53a. Removing only cache_control and its directive/TTL definitions reproduces version 23 canonically; every prior map remains unchanged.

Current Anthropic automatic caching uses one of four breakpoint slots and may skip ineligible/undersized prefixes; mixed explicit TTL/slot conflicts are provider errors, not guaranteed cache outcomes. This subset exposes no explicit block markers. The fixed direct Anthropic endpoint has no legacy Bedrock activation issue; delegated provider/model behavior remains upstream. A generated refusal is supported by the existing outcome contract, not proof of cache population. No upstream default, null-extension or cache success is inferred.

## Verification evidence

Both chat bases previously rejected cache_control. They now capture and freeze optional non-nullable {type:"ephemeral",ttl?:"5m"|"1h"} before credentials and preserve exact supplied values on delegated OpenRouter/managed Anthropic nonstream and streaming text/refusal/function requests. Omission adds no directive or TTL default. Null/malformed/extra fields and unknown TTL reject before routes; native OpenAI/Gemini supplied directives reject before secrets without cache-key/options/resource substitutions. Unknown TTLs remain an explicit bounded runtime gap despite the source SDK open enum; Anthropic nullable extension and block-level/mixed-TTL semantics remain outside this subset.

Existing approved model/provider/host scope, authenticated attribution, IAM/Deny/limits, native output caps/version header, required audit/ledger, per-attempt safe possibly-billed failures and cancellation remain shared. No beta header, prompt-content transformation, content-audit activation, operational control logging or response echoing. Caching effectiveness, model/provider thresholds, TTL pricing, cache hits and billed savings are not inferred. Reported disjoint native cache counters still enter existing aggregate usage once; preference presence/absence cannot manufacture missing usage or change billing authority.

- Red: 99 of 247 public request/SDK/source cases failed before implementation, reproducing unknown-field rejection, dropped prepared controls and absent transitive structural selection.
- Green: 853 focused cache request/aggregate, caller metadata/user/key, installed SDK and source regressions pass. Added 104 cases, including immutable/throwing root/type/TTL capture, native rejection/defaults, all authorization and persistence gates, body cancellation with failed possibly-billed attribution, missing usage and reported cache-aware totals independent of cache preferences. The cancellation fixture uses a copied handler port object to preserve strict readonly types.
- Actual installed OpenAI 7.23.0 and OpenRouter 1.4.18 complete 48 fixture-backed gateway socket requests across two bases/routes, three modes and stream/nonstream. OpenAI SDK carries this proxy extension; native OpenAI support is not claimed.
- Version 24 adds only cache_control and whole directive/TTL definitions to 29 request fields/16 request-history definitions. Removing these three selections reproduces version 23 canonically. Fresh canonical official source SHA-256 remains 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; projection SHA-256 is 740eb23ab1f0aba16debd3644680a8fa415cb396989f42737fbc571e43cad53a. Preserve the source open-enum extension/absent default; transitive enum/type/required/default/bounds/extension drift and missing/malformed/stale/rehashed invalid maps are guarded. Explicit fixed-host compatibility:drift passes.

Live cache/provider/model certification, unknown TTLs, native nullable/block/resource mappings, complete #116 and unresolved #7 remain open. No storage migration, dependency, registration, usage algorithm or workflow-authority change.


Full npm run check passes strict types, lint, 3845 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
