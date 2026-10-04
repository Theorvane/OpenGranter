# Native OpenAI function stream response validation

## Issue and problem

Issue: #382. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Consume native OpenAI indexed function deltas through bounded framing and the existing function sequence. Preserve exact model scope and stable response identity/timestamp. Ordinary usage:null is a delta extension, final empty-choice usage is required before DONE. Completed calls remain response content; rich/custom/deprecated fields fail safely. Classify opened-stream failures as possibly billed and cancel body on delivery failure or abort.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. Managed OpenAI text streaming is already public. This stage does not activate
public managed function streaming, define model snapshot equivalence or settle
open architecture choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/native-function-response.md).

## TDD plan

First add missing-module boundary tests for native function response consumption; cover two interleaved calls, text continuation, unknown usage, invalid scope/order/fragment/type/refusal, HTTP media/status, callback failure and cancellation. Run existing native text regressions after extracting shared guards.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Verification evidence

Add native OpenAI function response validation with shared native envelope guards and the existing bounded indexed function sequence. Ordinary usage:null is removed before common decoding; final empty-choice usage/DONE and stable exact model/identity/timestamp are required. Rich/custom/deprecated deltas and invalid call lifecycle fail with fixed possibly billed errors. Completed calls are response content; failed assembly is discarded and cancellation retains bounded awaited delivery.

Red: new public-module tests failed with ERR_MODULE_NOT_FOUND before implementation. Green: 19 native function response cases plus 28 existing native text cases pass (47 focused tests), covering interleaved calls, continuation, unknown usage, invalid identity/order/custom/deprecated/refusal/call fragments, HTTP status/media, callback failure and abort. Public managed function streaming remains a separate increment; existing public managed text support remains unchanged. Pin v19 and broader #116 gates remain open.


Full npm run check passes strict types, lint, 1803 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
