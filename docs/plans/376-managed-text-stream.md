# Managed text stream coordination

## Issue and problem

Issue: #376. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Compose authorized managed candidates with the trusted direct OpenAI text stream port. Preserve model and final-provider IAM, limits, Jev/order selection, per-attempt metadata-only usage and required audit. Deliver scoped text frames with awaited backpressure; expose final usage/DONE only after successful usage and audit. Never retry after any emitted delta or cancellation. Public HTTP activation remains a subsequent increment.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. This stage does not activate public
managed streaming, define model snapshot equivalence or settle open architecture
choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/managed-text-stream.md).

## TDD plan

First add boundary tests that fail because the coordinator does not exist; cover authorized success, model/provider Deny, limit, required handoff failure, missing terminal, malformed scope, delivery failure, cancellation and classified fallback before output.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Verification evidence

Compose native OpenAI text streaming with the existing managed route coordinator rather than duplicating candidate IAM, limits, Jev/order selection or per-attempt accounting. Required usage and outcome audit gate final usage/DONE. Scope/identity/terminal checks and cancellation/delivery tracking prohibit retry after output, including a misclassified trusted-port failure; classified pre-response fallback retains duplicate attribution.

Red: the new boundary test failed with ERR_MODULE_NOT_FOUND before implementation. Green: all 14 managed stream boundary tests pass, covering success, explicit model/provider Deny, limit, missing/failing usage, audit failure, safe pre-output fallback, malformed completion/scope, delivery failure and cancellation. Public HTTP activation remains separate; unsupported native providers/tools and exact model-ID equivalence remain bounded limitations. No schema pin change.


Full npm run check passes strict types, lint, 1747 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
