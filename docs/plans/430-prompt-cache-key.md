# Prompt cache request keys

## Issue and problem

Issue: [#430](https://github.com/Theorvane/OpenGranter/issues/430), continuing #116 after #428. Current compatible clients can supply prompt_cache_key, but the gateway rejects the field before upstream request preparation.

## Scope and expected behavior

Both API bases accept nullable optional string prompt_cache_key for managed OpenAI/delegated OpenRouter nonstream/stream text/refusal/function requests. Null/omission omits the upstream field; preserve exact empty/whitespace/Unicode/case-sensitive strings without hashing, coercion or generated defaults. Malformed types fail before route/credential work. Use existing HTTP body size bounds; no undocumented provider string limit is added. Capture once before asynchronous credential work.

Native Anthropic/Gemini supplied strings reject before secrets, including empty strings. Their cache_control/cachedContent features change native content or cache resources rather than providing an exact placement key, so never translate silently. Null/omission retains their existing behavior. The key does not authenticate a principal, select an unapproved host/provider/model, change prompt context, or guarantee caching. All permissions, limits, audit and ledger attribution remain authenticated; reported usage remains independent of the key. Do not echo/log it or infer cache hits, counters, savings or billed cost.

Version 22 adds exactly prompt_cache_key to the 27-field request selection while retaining every existing definition/map. Track nullable string shape and structural drift without source-invented bounds/defaults. Out of scope: cache retention, native cache configuration or cached-content resource ownership, live/model guarantees, safety_identifier, broader endpoints, full #116 and unresolved #7.

## Design

Add one pure optional nullable string capture helper at public gateway and both prepared request boundaries. Forward the captured value only through existing fixed OpenAI/OpenRouter hosts and preserve all response/accounting/delivery logic. Extend the source field and exact pin version after failing conformance tests; review a fresh fixed-host source and verify removing only this field reproduces the prior projection.

Repository grilling delegates factual research from [OpenRouter OpenAPI](https://openrouter.ai/openapi.json), [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [OpenAI create](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), native provider docs and installed SDK definitions. Cache placement/partition details are upstream/model behavior; this adapter makes no cache-hit or billing inference. No new domain term, costly ADR or unresolved architecture default is introduced.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [contract](../../contracts/prompt-cache-key.md) and schema drift contract.

## TDD plan

First public HTTP and adapter cases expect exact prepared cache keys and unchanged authenticated attribution; red is unknown-field rejection and dropped adapter fields. Cover omission/null/empty/Unicode/whitespace, longer strings under HTTP bound, malformed types, native unsupported strings, single/throwing accessor capture, both bases and actual SDKs, nonstream/stream text/refusal/functions, authentication and model/provider Deny, limits, required selection/outcome audit and ledger failure, missing usage and sanitized transport failure. Source tests select exactly nullable string and detect type/required/default/bounds/extension drift, missing/malformed sources and rehashed invalid/stale pins.

Use descriptor-preserving fixtures so getters reach public provider boundaries. Add the minimum request capture/projection and source-selection changes; format, focused verification, full npm run check and explicit compatibility:drift. Update historical field-count assertions without removing earlier selections or tests.

## Delivery

Issue and new branch precede this English plan and code. Record red/green, fresh source/projection digests and remaining limits in the PR. Exact-head sjungwon03-ai review and both CI jobs precede sjungwon03 squash merge and clean main synchronization. Rollback removes the optional field and restores pin/projector together; no storage migration. SDK fixtures do not certify live models or full #116.

## Reviewed provenance

Fresh official retrieval on 2026-10-05 retains canonical source SHA-256 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458. Version-22 projection SHA-256 is 5795330860eaac856462a65ec6cac4b465e814e51519f07d8edc267f1807e6e0. Removing exactly prompt_cache_key reproduces the previous projection canonically; every earlier selection remains unchanged.

## Verification evidence

Compatible external clients previously received an unknown-field error for `prompt_cache_key`. Both API bases now capture nullable optional strings once before credentials and preserve exact supplied values on managed OpenAI/delegated OpenRouter nonstream and streaming text/refusal/function requests. Null/omission leaves the upstream field unset; empty, Unicode, whitespace, case-sensitive and longer under-body-bound strings retain their original form. Malformed types fail safely before routes or credentials.

Cache preferences and caller `user` attribution remain independent. Authenticated principal/credential/policy IAM, limits, audit and ledger attribution stay effective. The adapter does not echo/log keys, change prompt context, create cache configuration, derive usage or assert hits/savings/billed costs. Native Anthropic/Gemini supplied strings reject before credentials rather than mapping to cache_control breakpoints or cachedContent resources; null/omission preserves defaults.

- Red: public cache-key/SDK/source tests failed 159 of 300 cases before implementation, reproducing unknown-field rejection, dropped adapter metadata and absent structural selection. Existing unrelated/denial/source cases passed.
- Green: 895 focused request/SDK/probability/Gemini/source regressions pass. Added 177 cases covering exact nullable controls, native defaults/rejection, field independence, HTTP body bounds, single/throwing accessor capture, missing usage, authentication/Deny/limits, selection/persistence failures and sanitized opened failures.
- Actual installed OpenAI 7.23.0 and OpenRouter 1.4.18 SDKs complete 48 fixture-backed gateway socket requests across both bases/routes, nonstream/stream and text/refusal/functions. These do not certify live models or cache hits.
- Version 22 selects 27 request fields, adding only nullable string prompt_cache_key. Removing it reproduces version 21 canonically. Fresh official source SHA-256 remains `0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458`; projection SHA-256 is `5795330860eaac856462a65ec6cac4b465e814e51519f07d8edc267f1807e6e0`. Explicit fixed-host compatibility:drift passes; type/nullability/required/default/bounds/extension changes remain guarded.

Native caching/retention/resource ownership, model/provider guarantees and full #116/#7 remain open. No policy/ledger/storage migration, response/accounting rule, SDK dependency, registered destination or workflow authority changes.


Full npm run check passes strict types, lint, 3647 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
