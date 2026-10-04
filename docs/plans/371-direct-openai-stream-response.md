# Native direct OpenAI text-stream response boundary

## Issue and problem

Issue: #371. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Consume an already-opened direct OpenAI SSE response with native text/refusal guards, usage:null ordinary chunks and exactly one empty-choice final usage event before DONE. Reuse bounded framing and validated sequence primitives while rejecting delegated reasoning/native-finish extensions and tools. Capture exact approved model scope; require stable response identity and preserve unknown final usage. Await delivery, interrupt on cancellation and classify HTTP/stream failures as response-started and possibly billed without reading failure bodies. Unsuffixed-to-snapshot identity mapping, other native modalities/providers and public managed streaming remain open.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. This stage does not activate public
managed streaming, define model snapshot equivalence or settle open architecture
choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/direct-openai-stream-response.md).

## TDD plan

Add native response-boundary tests before implementation; the missing decoder/consumer module is the expected red. Verify native ordinary-null usage is not mistaken for a final usage event, success/refusal, incomplete/misordered/error streams, unsupported deltas, HTTP status sanitization, scoped identity and cancellation.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Verification evidence

Add native direct OpenAI text/refusal decoding and already-opened SSE response consumption. Ordinary usage:null is removed before shared structural validation; only an empty-choice final usage event completes the native sequence. Native guards reject tools, audio and delegated reasoning/native-finish extensions. Stable exact upstream model, ID and created identity, captured client alias, awaited callbacks, terminal/usage/DONE order and content-free completion remain enforced. HTTP error bodies are not read; native failures become DirectProviderFailure with response-started/possibly-billed flags.

Red: the new native module boundary did not exist. Green: 28 focused native response cases pass, including ordinary null usage, native final usage, retained partial/invalid counters, refusal, unsupported/malformed chunks, wrong scope, missing/duplicate/reordered termination, HTTP status/media/body/UTF-8 failures, callback failure and cancellation. Initial assertions that all partial/invalid counters disappear were corrected to the existing shared usage contract; production preserves known counters and invalid nulls. Installed OpenAI SDK 7.23.0 types and the official streaming reference support the bounded native field cases. Unsuffixed/snapshot equivalence, live capability certification, native tools/other providers and public managed streaming remain open; pin v19 unchanged and full #116 remains open.


Full npm run check passes strict types, lint, 1717 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
