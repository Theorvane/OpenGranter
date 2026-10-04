# Internal direct OpenAI text-stream invoker

## Issue and problem

Issue: #373. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Compose the captured direct OpenAI transport and native SSE response boundary into an internal text/refusal invoker. Preserve fixed registered host, exact approved upstream identity and immutable client alias, existing controls/caps, forced native final usage, awaited callback delivery and deadline/cancellation. Return a content-free native completion only after terminal/usage/DONE; failures retain sanitized categories and response-started/possibly-billed semantics with no inference replay. Unsupported providers/tools reject before secrets. The caller must already authorize the managed candidate; public managed IAM/limits/usage/audit streaming composition, identity alias equivalence and other native providers remain subsequent work.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. This stage does not activate public
managed streaming, define model snapshot equivalence or settle open architecture
choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/direct-openai-stream-invoker.md).

## TDD plan

Add complete invoker-boundary tests first; the missing factory module is the expected red. Cover scoped fixed-host success, pre-secret rejection, partial failure, unknown usage, callback cancellation/backpressure, hanging-body timeout and pre-inference unbilled failure.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Verification evidence

Compose the captured direct OpenAI transport and native text/refusal response consumer as an internal invoker. One registered fixed-host request uses the immutable approved candidate/client alias, existing controls and output caps, and forced native include_usage. It awaits delta delivery and completes only after terminal/usage/DONE. Timeouts, caller cancellation, malformed or partial responses and callback failures preserve fixed DirectProviderFailure categories and response-started/possibly-billed flags without inference retry; pre-inference secret/abort failures stay unbilled.

Red: the composed factory module was absent before tests. Green: 58 focused transport/native response/invoker tests pass, including fixed-host scoped success, mutation during secret resolution, unsupported provider/tool/reasoning rejection before credentials, HTTP categories, partial/incomplete stream failure, unavailable final usage, callback backpressure/cancellation, uncooperative-body timeout, pre-inference failure and exact-model mismatch. Full check passes 1733 tests with one existing PostgreSQL skip. No live provider calls, public managed streaming activation or coordinator IAM/limits/usage/audit bypass. The caller must already authorize the candidate. Public managed streaming persistence/HTTP wiring, snapshot equivalence, native tools/other providers and complete #116 remain open; pin v19 unchanged.


Full npm run check passes strict types, lint, 1733 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
