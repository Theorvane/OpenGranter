# Explicit text cache breakpoints

## Issue and problem

Issue: [#442](https://github.com/Theorvane/OpenGranter/issues/442), continuing #116 after #440. The client normalizer rejects prompt_cache_breakpoint and concatenates text parts, so reusable prefix boundaries disappear before native OpenAI/delegated OpenRouter serialization.

## Scope and expected behavior

Support optional nullable prompt_cache_breakpoint={mode:"explicit"} on text-only content parts for system/developer/user/assistant/tool-result histories through both chat bases and managed OpenAI/delegated OpenRouter nonstream/text/refusal/function streams. Null/omission removes the marker as a local normalization; native null semantics are not claimed. Preserve exact empty/whitespace/Unicode text, block order and marked boundaries, including function-result correlation. When any non-null marker exists, retain the complete captured text-part array; otherwise keep legacy literal concatenation. Bound marked messages to 128 text parts under existing body bounds; do not interpret that bound as a provider write or lookup limit. Reject malformed/extra/prototype marker fields, unknown mode/TTL and rich/refusal markers safely before routes; plain unmarked behavior remains unchanged.

Snapshot marked arrays deeply before credentials and reject marked histories on native Anthropic/Gemini before secrets without translating cache formats/resources. Raw internal adapter arrays remain invalid unless they contain a captured non-null breakpoint; external null-only/unmarked arrays normalize to strings. Reject simultaneous top-level cache_control and marked history as an explicit local restriction because precedence is unverified. Root prompt_cache_options is independent: omission injects no explicit-only mode or TTL. Keep current prediction-part restrictions; input message markers do not enable markers on prediction or refusal parts.

All approved model/final-provider/host scope, authenticated IAM/Deny/limits, private operational records/errors, required audit/usage, missing usage and safe possibly-billed failure/cancellation remain shared. Opt-in Jev prompt disclosure must retain the prior literal text view, joining parts without marker metadata or object-string coercion. No cache hit, prefix retention, write count, cache usage, savings or provider-billed cost is inferred. Provider/model support and errors remain upstream; catalog eligibility is unchanged.

Out of scope: Anthropic-style block directives/direct native conversion, mixed cache formats, richer parts, live cache certification, full #116 and unresolved #7.

## Design

Represent marked content in the existing message content union as frozen text parts rather than storing a duplicate private representation. The client normalizer retains arrays only when marked; shared message snapshots validate/capture the array. OpenAI/delegated serialization already carries captured messages. Direct native rejection precedes credentials. A deliberate text-view helper preserves existing Jev disclosure semantics, including nullable assistant content. This is a reversible representation change, not a new domain concept or costly architecture decision.

Repository grill-with-docs/grilling/domain-modeling fact research verifies all five roles, nullable OpenRouter versus nonnullable OpenAI marker shapes, and downstream normalization boundaries. Sources: [OpenRouter schema](https://openrouter.ai/openapi.json), [OpenRouter caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching), [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching), [OpenAI Chat reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), installed SDKs. Source guide/SDK lookup-window prose differs; do not hard-code either window or confuse writes with accepted history markers. Repeated implementation authorization covers this bounded continuation; no unresolved routing choice is settled.

Version 28 adds whole ChatContentText, PromptCacheBreakpoint and ChatContentCacheControl to 32 fields/22 request-history definitions. The latter tracks a referenced schema, not an implemented directive. Removing these three definitions must reproduce version 27 canonically. Keep exact source shapes without invented runtime bounds, defaults or extra-key prohibition. Update PRD, architecture, acceptance, compatibility and contracts/prompt-cache-breakpoints.md plus the drift contract.

## TDD plan

First failing public HTTP/adapter/actual SDK cases submit marked arrays and expect exact role/block preservation; current field rejection/string-only snapshot is the expected red. Cover both bases/routes/output modes/streams, all five history roles, empty/Unicode/order/null normalization, legacy unmarked arrays, 128/129 bound, root/part/type/text/marker/mode single and throwing capture, credential-await mutation, prototypes/sparse/rich/extra fields, native rejection/defaults, top-level cross-control restriction, independent controls and correlated history. Cover authentication/Deny/limits, required persistence, missing usage, opened failures/body cancellation and opt-in Jev plain-text disclosure. Guard transitive structural drift, absent/malformed targets, annotations, stale/rehashed pins and removal equality.

After observed red implement minimum retention/capture/native guards and text-view helper. Format, focused regressions, full npm run check and fixed-host compatibility:drift. Actual SDK socket fixtures certify boundary behavior, not live caching.

## Delivery

Issue/new branch/English plan precede coding. PR links plan/contract and reports red/green, canonical source/projection/removal evidence, SDK fixture limits and material remaining risks. Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash merge and clean main. Rollback reverts retained arrays/projector/pin together; no storage/dependency migration.

## Verification evidence

Preserve explicit prompt_cache_breakpoint text boundaries for all five history roles on both chat bases through managed OpenAI/delegated OpenRouter nonstream and text/refusal/function streams. Snapshot/freeze full marked arrays, exact text and correlated tool results before credentials; null-only/unmarked client parts retain prior concatenation. Native Anthropic/Gemini and their exported converters reject marked arrays safely before secrets. Opt-in Jev disclosure retains the literal text view without marker metadata. Root options stay independent; mixed request cache_control rejects without unverified precedence.

TDD: initial public HTTP/adapter/SDK/source tests recorded 104 expected failures out of 322 because text arrays/markers were rejected or source selections were missing. Three additional regressions failed as expected for native converter array acceptance and noncanonical internal index properties, then passed after minimal guards. Final focused checks passed 376 tests; full checks passed 4308 tests with one existing PostgreSQL skip. Actual OpenAI 7.23.0 and OpenRouter 1.4.18 sockets exercise 48 controlled requests across both bases/routes/output modes and streaming. Success, authentication/IAM/Deny/limits, required audit/usage, missing usage, opened failure, body cancellation, getter capture/mutation, native rejection and Jev disclosure remain covered.

Version 28 adds exactly ChatContentText, PromptCacheBreakpoint and ChatContentCacheControl (32 fields/22 request-history definitions). Fresh fixed-host source SHA-256 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; projection SHA-256 58e9a0a83abf7e1863d552979158684fe72dec43df1318e8d8ddcb7a81ef22b7. Removing the three definitions reproduces version 27 canonically. Offline integrity and fixed-host live structural drift pass, including transitive constraints/missing/malformed/stale/rehashed cases.

Limits: the 128-part maximum, null-marker omission and mixed-control rejection are documented local restrictions. Source block cache-control tracking does not enable that directive. No live model/cache hit/retention/savings/billed-cost guarantee, native conversion, lookup-window assumption or full #116 claim; unresolved #7 is unchanged. No storage, dependency or workflow changes.


Full npm run check passes strict types, lint, 4308 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
