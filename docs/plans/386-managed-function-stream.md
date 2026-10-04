# Managed function stream coordination and HTTP delivery

## Issue and problem

Issue: #386. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Compose trusted native function streams with existing managed IAM, limits, Jev/order selection, per-attempt usage and required audit. Explicitly exclude completed tool calls from routing/accounting responses. Gate usage/DONE after required handoffs, retain safe pre-output fallback accounting and prohibit retry after output/cancellation. Add a function entry point on the shared bounded HTTP controller with safe interruption projection.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. Managed OpenAI text streaming is already public. This stage does not activate
public managed function streaming, define model snapshot equivalence or settle
open architecture choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/managed-function-stream.md).

## TDD plan

Write missing-module/export boundary tests before code. Verify function fragment delivery, call-content privacy, Deny/limits/missing or failing required handoffs, scope/terminal mismatch, safe pre-output fallback, no replay after output/cancellation and HTTP backpressure/errors/cancellation across both formats.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Verification evidence

Compose managed function streams with existing candidate authorization, limits, Jev/order selection, attempt accounting and required audit. The routing response explicitly excludes completed toolCalls and retains only snapshotted usage/identity metadata. Await indexed SSE delivery, gate final usage/DONE on required handoffs and prohibit retry after any output/cancellation, including misclassified trusted adapter failures. Reuse the existing bounded HTTP controller and safe interruption/error projection for the function entry point.

Red: new coordinator/HTTP boundary tests failed on missing module/export before implementation. Green: 28 new function coordinator/HTTP cases and 28 existing managed text cases pass (56 focused tests), including call-content privacy, explicit Deny, required persistence failure, pre-output fallback, no replay after output, bounded unread demand and cancellation. Existing public managed text support remains unchanged; public managed function activation is a separate increment and full #116 remains open.


Full npm run check passes strict types, lint, 1842 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
