# Streamed chat token probabilities

## Issue and problem

Issue: [#424](https://github.com/Theorvane/OpenGranter/issues/424), continuing #116 after #420/#422. Supported nonstream probability controls reject streaming requests and choice-level stream probabilities are discarded.

## Scope and expected behavior

Both API bases support nullable logprobs/top_logprobs for managed OpenAI and delegated OpenRouter text, refusal and function streams, with the existing boolean, integer 0..20 and true-dependency contract. Capture exact controls before credentials. Native Anthropic/Gemini supplied controls still fail before secrets. Preserve optional nullable choice-level content/refusal probabilities and alternatives/bytes using the existing strict deep immutable local bounds. Never synthesize probabilities, tool-argument probabilities, usage or billed cost.

Ordinary delta probabilities follow existing backpressure and cancellation. Retain only one private bounded probability snapshot from a delegated content-free final usage choice, excluding it from routing summaries, ledger and operational audits/errors. Release it only after required ledger/outcome audit succeeds, including a metadata-only frame when aggregate usage is unavailable. Keep native OpenAI usage:null deltas and empty-choice final usage convention unchanged. Failure withholds final metadata and DONE, records the existing safe possibly-billed outcome and never retries after emission.

Out of scope: native Anthropic/Gemini probability mappings, model capability guarantees, probability storage, billing, SDK/schema pin changes, whole-stream probability assembly, live provider certification, complete #116 and unresolved #7.

## Design

Extend shared control capture, decoded delta/usage types, decoder and client encoder. Reuse snapshotChatLogprobs at untrusted and trusted callback boundaries. Sequence outcomes transport a private usageLogprobs field; all four coordinators snapshot and explicitly omit it from route results before required persistence, then project it after success. Clear private sequence state on finish/failure/discard. Each SSE event retains its existing one-MiB byte bound; each probability snapshot retains #420 bounds, with no full-stream accumulation.

Primary facts were delegated under repository grilling: [OpenRouter OpenAPI](https://openrouter.ai/openapi.json), [parameters](https://openrouter.ai/docs/api/reference/parameters), [streaming](https://openrouter.ai/docs/api/reference/streaming) and [OpenAI streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events). Choice probabilities are outside delta; OpenRouter's content-free repeated terminal usage choice is an accounting frame. A private sidecar preserves that content across persistence without contaminating accounting. No new domain/ADR decision: these are already authorized protocol facts. Per-model availability and native mappings remain open.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/stream-logprobs.md).

## TDD plan

First public HTTP stream tests expect exact forwarded controls and choice probabilities on both bases and both supported adapters; expected red is HTTP 400 or missing metadata. Cover text/refusal/functions, absent/null/empty groups, final usage probabilities with complete/missing usage, both installed SDKs, immutable capture, malformed controls/probabilities, native pre-secret rejection, auth/implicit/model/provider Deny, limits, selection/outcome audit and ledger failures. Exercise deferred persistence, invalid first/later/final frames, trusted callback mutation, backpressure, abort and operational privacy without deriving usage.

Write meaningful regressions first, record red, implement minimal snapshots/projections, format and run focused tests then npm run check. Retain strict TypeScript and existing public security boundaries.

## Delivery

Issue precedes branch/plan/code. Report actual red/green, full checks and material limits in PR. Exact-head sjungwon03-ai review and both exact-head CI checks precede sjungwon03 squash merge and clean main synchronization. Rollback removes new stream controls/projections; no historic migration. Fixture SDK conformance does not certify live providers or complete #116.

## Verification evidence

Supported streaming requests previously rejected logprobs/top_logprobs, and stream decoders discarded reported choice probabilities. Managed OpenAI and delegated OpenRouter now forward the same captured nullable controls and preserve bounded immutable content/refusal probabilities, alternatives and bytes in text, refusal and function streams on both API bases.

Delegated content-free final usage choices retain only one private bounded probability snapshot. All four stream coordinators exclude it from routing/accounting summaries, snapshot before persistence and project it only after required usage/outcome audit succeeds. Missing aggregate usage permits a probability-only choice frame without invented counters. Native OpenAI keeps usage:null delta and empty-choice final usage conventions. Private sequence state clears on completion, error, invalid continuation and external transport/delivery failure; ordinary deltas retain awaited delivery, cancellation and the one-MiB SSE event bound.

TDD: the initial preimplementation HTTP/adapter/SDK suite reproduced 132 failures out of 144 cases (12 existing boundaries already passed), including HTTP 400 for valid controls and discarded response metadata. A live private-sidecar serialization regression then reproduced one failure out of two before introducing runtime-private text storage. Final focused validation passes 396 cases, including 188 new HTTP/decoder/encoder/sequence/coordinator/SDK regressions. Installed OpenAI 7.23.0 and OpenRouter 1.4.18 verify both route kinds, both bases, all three response modes and complete/missing usage (48 actual SDK requests). Tests cover exact omission/null/false/zero controls, native pre-secret rejection, immutable/accessor capture, malformed/oversized probabilities, wrong delta placement, auth/implicit/model/provider Deny, limits, selection/outcome audit and ledger failure, deferred persistence, upstream backpressure/abort, client cancellation and exactly one safe possibly-billed attempt. SDK stream fixtures supply a valid reported fingerprint; no production fingerprint is synthesized.

Material limits: native Anthropic/Gemini probability controls remain unsupported, per-model/provider availability is not certified, and no tool-argument probabilities or usage are inferred. No billing/storage migration, SDK/schema pin or route eligibility/default change. Fixture SDK conformance is not live-provider or full named-client certification. Native probability mappings, full #116 and unresolved #7 remain open. English plan, contracts and acceptance document the scope and verified primary protocol facts.


Full npm run check passes strict types, lint, 3168 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
