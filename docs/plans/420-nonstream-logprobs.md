# Nonstream chat token log probabilities

## Issue and problem

Issue: [#420](https://github.com/Theorvane/OpenGranter/issues/420), a bounded continuation of #116. Both external paths reject logprobs/top_logprobs and the managed OpenAI/delegated OpenRouter adapters discard supplied choice.logprobs. External clients cannot inspect reported token alternatives or refusal probabilities.

## Scope and expected behavior

Nonstream requests accept optional nullable logprobs boolean and top_logprobs safe integer 0..20, with top_logprobs requiring logprobs=true. Null/absence omits each native field; false and zero are retained exactly. Managed OpenAI/delegated OpenRouter forward controls before credential awaits. Supplied controls on native Anthropic/Gemini or streaming fail before credentials/transport; no implicit translation or capability fallback.

Preserve absent versus null choice.logprobs. An object has required nullable content and optional nullable refusal. Token entries require token string, finite logprob number, bytes null or dense integers 0..255, and dense top_logprobs alternatives with the same scalar fields. Capture deep immutable snapshots, preserving empty lists, zero, Unicode, sentinel probabilities and optional refusal omission. Never infer byte/token correspondence or probabilities, clamp values, or derive usage from probabilities. Local limits: at most 65536 tokens across groups, 20 alternatives per token, 16384 UTF-16 code units per token string, 1024 bytes per byte array, and 1048576 combined token-string code units/byte elements including alternatives. Unknown object keys and malformed/sparse/bounded data reject with fixed errors. Valid positive finite logprob values remain structurally accepted; source schemas impose no sign constraint.

Use existing success/denial/failure IAM, fixed hosts, limits, single-attempt aggregate accounting and required handoffs. Token strings/bytes are protected response content and never operational audit/usage/error fields. Malformed opened responses are failed possibly-billed attempts with missing usage, without content release.

Out of scope: streamed probabilities, native Anthropic/Gemini mapping, synthesis when absent, price/billing/storage changes, model support guarantees, live providers, source-pin expansion, full #116 and unresolved #7.

## Design

Add shared request-control capture in chat-parameters and an allowlisted deep immutable nonstream probability snapshot helper. Validate at HTTP and both adapter boundaries; project choice-level data without changing assistant messages. Shared direct transport rejects unsupported native/stream controls before resolveSecret. No glossary/ADR change: this implements already authorized protocol facts and introduces no costly domain decision.

Primary facts were delegated under repository grilling: [OpenRouter parameters](https://openrouter.ai/docs/api/reference/parameters), [official OpenAPI](https://openrouter.ai/openapi.json), [OpenAI chat reference](https://platform.openai.com/docs/api-reference/chat/create), and installed OpenAI 7.23.0/OpenRouter 1.4.18 schemas. Null dependency behavior is unspecified; null enters the existing omission convention. The 0..20/true dependency and UTF-8 byte range are explicit bounded contract checks, not claimed OpenAPI structural constraints. The existing version-19 selected schema pin does not traverse these fields/definitions; expansion remains tracked by #116.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), and [contract](../../contracts/nonstream-logprobs.md).

## TDD plan

First public HTTP cases send true/0 or true/20 and expect exact native controls plus choice-level probabilities through both bases and both adapters. Expected red: 400 unsupported controls and missing response metadata. Cover omission/null/false, malformed controls and dependencies, native/stream pre-secret refusal, text/refusal/function outputs, both actual SDKs, immutable request/response capture, malformed response objects/bytes/lists/nonfinite values/local bounds, authentication/model/provider explicit Deny/limits, selection/outcome audit failure, required usage failure, missing usage and safe possibly-billed failure.

Write tests before production code; record red. Implement smallest shared snapshots and projections, format, run focused cases and full npm run check, recording actual green.

## Delivery

Issue precedes new issue-numbered branch/plan/tests/code. Link English plan/contract and red/green evidence in PR. Exact-head review by sjungwon03-ai; both exact-head CI checks must pass before sjungwon03 squash merge and clean main synchronization. Rollback removes future controls/projections without historical migration. SDK fixture verification is not live model certification. Streaming, other native routes, unselected schema targets and complete #116 remain open.

## Verification evidence

Both client bases rejected logprobs/top_logprobs and managed OpenAI/delegated OpenRouter discarded reported token probabilities. Accept a bounded nullable nonstream control pair (boolean logprobs, integer top_logprobs 0..20 requiring true), forwarding exact false/zero before credential awaits. Preserve supplied absent/null/content/refusal choice-level probabilities, token alternatives and bytes in text, refusal and function completions; do not synthesize probabilities or usage.

Validate required fields, dense arrays, finite numbers, byte range, strict keys and documented local payload limits; capture nested arrays/objects immutably with fixed initial lengths. Unsupported streaming and native Anthropic/Gemini controls reject before credentials/transport. Malformed opened responses are safe failed possibly-billed attempts with missing usage. Shared authentication, complete model/provider Deny, limits, fixed endpoints, aggregate accounting and required audit/ledger handoffs remain enforced. Token strings/bytes never enter operational records or fixed errors.

TDD: initial new HTTP/SDK tests reproduced 140 expected failures out of 144. After correcting fixture fingerprint and delegated unknown-provider expectations and adding boundary cases, the final preimplementation comparison reproduced 148 expected failures out of 152 (four existing boundaries passed). A subsequent accessor-array regression reproduced two failures before fixing capture lengths. Final focused verification passes 191 cases, including 154 new public HTTP/adapter/SDK regressions and 37 existing logit-bias/reasoning-detail regressions. Installed OpenAI 7.23.0 and OpenRouter 1.4.18 each verify both bases, both route kinds and text/refusal/functions (24 successful client requests). Tests also cover unknown/missing usage, auth/implicit/model/provider Deny, limit/selection/outcome/ledger failures, transport failure, sparse/nonfinite data, immutable references and maximum/combined bounds. Legacy SDK fixtures explicitly supply required fingerprint; no production fingerprint synthesis or delegated provider identity is invented.

Material limits: this is a nonstream subset with explicit local size/shape constraints, not per-model or live-provider certification. OpenRouter providers can ignore unsupported controls; no capability/default policy is introduced. Streaming probabilities, native Anthropic/Gemini mappings, selected version-19 source-pin expansion, complete #116 and unresolved #7 remain open. No storage, billing, SDK dependency, schema pin or historic usage migration. English plan/acceptance/contracts document verified primary facts and limits.


Full npm run check passes strict types, lint, 2952 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
