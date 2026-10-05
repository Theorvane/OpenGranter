# Explicit request prompt-cache options

## Issue and problem

Issue: [#438](https://github.com/Theorvane/OpenGranter/issues/438), continuing #116. Both public chat bases reject the official prompt_cache_options field. Compatible callers cannot select explicit-only caching, including the documented no-breakpoint request that disables managed prompt-cache writes on supporting OpenAI models.

## Scope and expected behavior

Accept optional nullable {mode:"explicit",ttl?:"30m"|null} for managed OpenAI and delegated OpenRouter nonstream and text/refusal/function streams. Null options omit the field; null/undefined TTL omits that member. Capture own known fields once, freeze them before credentials and preserve only supplied values without adding mode/TTL defaults. Reject malformed/non-record/extra fields, missing mode, implicit/unknown mode and TTL strings other than 30m before route work. Unknown TTL and native implicit mode are explicit local gaps against the broader upstream schemas. Native Anthropic/Gemini supplied options reject before secrets; null/omission keeps existing defaults. Reject simultaneous non-null cache_control as a conservative local restriction because request-level cross-control precedence is unverified.

Existing string/text-part normalization stays unchanged; no block-level markers are accepted or synthesized. No explicit cached prefixes are created by this subset. Supported upstream models may use explicit-only requests without block markers to disable caching; forwarding alone cannot guarantee a provider outcome, retention, savings or billed cost. Catalog eligibility remains administrator controlled. Preserve independent user/key/metadata/prediction and existing tool/control validation. All approved destination scope, authentication/IAM/Deny, limits, secret references, private operational projections, required audit/usage, missing usage, cancellation and safe possibly-billed failures remain shared. No cache counters are derived from these options.

Out of scope: block breakpoints, implicit native extensions, arbitrary TTLs, cache_control translation/coexistence, cachedContent resources, retention aliases, model eligibility/live guarantees, broader endpoints, full #116 and unresolved #7.

## Design

Add one pure snapshot helper and apply it at gateway, native and delegated preparation boundaries. Only managed OpenAI/delegated bodies receive the options. Use captured cache_control for the coexistence guard without getter rereads. Track the complete PromptCacheOptions target and its parent field in the source projection, advancing the reviewed pin to version 26. Removing only these two selections must reproduce version 25 canonically; preserve source nullable root/string TTL and absent structural bounds/defaults rather than encoding local restrictions.

Primary sources: [OpenRouter schema](https://openrouter.ai/openapi.json), [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching), [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), and installed OpenAI 7.23.0/OpenRouter 1.4.18. Repository grill-with-docs/grilling/domain-modeling fact research checks exact fields and native mapping. No new domain term, irreversible architecture decision or unresolved routing option is settled; repeated implementation authorization covers this bounded continuation.

Update docs/PRD.md, docs/architecture.md, docs/acceptance.md, docs/openrouter-compatibility.md, contracts/prompt-cache-options.md and the schema drift contract.

## TDD plan

First run public request/adapter/SDK tests expecting exact supplied options to survive; current unknown-field rejection/dropped adapter field is the expected red. Cover both bases, route kinds and supported response modes/streaming; null/omission/default absence, malformed/prototype/throwing/single-read capture, asynchronous mutation, native rejection, cross-control rejection, independent controls/function history, auth/Deny/limits, required persistence, opened transport failures, missing usage and cancellation. Verify actual installed SDK sockets with controlled approved upstream fixtures. Add structural drift tests for nullable root/TTL, required mode, enum, optional members, defaults/bounds/extensions, missing/malformed source and stale/rehashed maps.

After observed red implement minimum capture/forwarding, format and run focused regressions, full npm run check and fixed-host compatibility:drift. No live inference.

## Delivery

Issue/new branch/plan precede coding. Link this plan and contract in the PR; record primary-source and canonical provenance, red/green evidence, SDK fixture limits and remaining risks. Require exact-head sjungwon03-ai approval and both CI check jobs before sjungwon03 squash merge. Rollback reverts optional forwarding/projector/pin together; no storage or dependency migration.

## Verification evidence

Both chat bases previously rejected prompt_cache_options. They now capture/freeze optional nullable explicit-only options once before credentials and forward them on managed OpenAI/delegated OpenRouter nonstream and text/refusal/function streams. Preserve supplied ttl=30m; nullable options/TTL normalize to omission without defaults as a documented local choice, not native null certification. Missing/malformed/extra keys, implicit mode and other TTLs reject before routes; native Anthropic/Gemini supplied options reject before secrets. Simultaneous non-null cache_control rejects as an explicit local restriction because request-level precedence is unverified. No block markers, retention/resource translation or eligibility change.

Approved destinations/fixed hosts, authenticated IAM/Deny/limits, private operational records/errors, required audit/usage before final frames, missing usage, safe possibly-billed failures and cancellation remain shared. Independent key/user/metadata/prediction/function history pass existing validators. Options never manufacture cache counters, zero usage, savings or billed cost. Primary guides document explicit-only no-marker use on supporting OpenAI models; fixtures do not certify live provider behavior.

- Red: 107 of 285 public request/adapter/SDK/source cases failed before implementation, reproducing unknown-field rejection, dropped/cross-control fields and absent transitive selections.
- Green: 449 focused option/prediction/cache/SDK/schema regressions pass; 114 new cases cover exact nullable/default behavior, prototypes/extra fields, single/throwing capture and await mutation, native rejection, all authorization/persistence gates, missing usage/opened failure/body cancellation and independent controls/history. Actual installed OpenAI 7.23.0 and OpenRouter 1.4.18 complete 48 controlled gateway socket requests across both bases/routes, three modes and nonstream/stream.
- Version 26 adds only prompt_cache_options and whole PromptCacheOptions (31 fields/19 request-history definitions). Removing both reproduces version 25 canonically. Fresh official source SHA-256: 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; projection: c0003968e46150ee776341a9c2bb7b3a2565e491e48956c9ed83adb24ebceef0. Preserve source nullable string TTL and absent enum/default/bounds/extra-key prohibition; transitive drift and missing/malformed/stale/rehashed map failures are covered. Explicit fixed-host compatibility:drift passes.

Block boundaries, native implicit/arbitrary TTL extensions, cross-control precedence/native mappings, live model/cache/billing guarantees, complete #116 and unresolved #7 remain open. No storage, dependency, usage algorithm or workflow-authority change.


Full npm run check passes strict types, lint, 4071 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
