# Registered OpenAI function stream invoker

## Issue and problem

Issue: #384. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Introduce an explicit function-stream mode on captured direct request transport. Reuse validated OpenAI tools/choice/parallel controls and correlated result history, fixed registered host, output caps, immutable pre-secret scope/body, timeout and cancellation. Compose native function response validation. Preserve text-only rejection and fail unsupported kinds/invalid controls before keys. No inference retry in the adapter.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. Managed OpenAI text streaming is already public. This stage does not activate
public managed function streaming, define model snapshot equivalence or settle
open architecture choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/native-function-invoker.md).

## TDD plan

First add missing-module native function invoker boundary tests. Verify captured request/history, unchanged text-only rejection, unsupported kinds, HTTP errors, pre-inference unbilled missing credential, pre-abort and opened-body timeout.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Verification evidence

Add an explicit function-stream capability to captured direct transport and compose the native OpenAI function invoker. Reuse immutable pre-secret candidate/alias/body snapshots, existing tool controls and correlated result-history validation, registered fixed host, output cap, required native final usage, timeout and composed cancellation. Existing text-only streaming still rejects function controls before provider credentials; adapters do not retry inference.

Red: new invoker boundary tests failed on the missing module before implementation. Green: 11 native function invoker cases and 30 existing native text/transport cases pass (41 focused tests): captured tools/history, fixed destination, output caps, text-only rejection, unsupported kinds, HTTP categories, missing credential unbilled failure, pre-abort and hanging-body timeout. Public managed function streams remain a later increment; pin v19 and full #116 remain open.


Full npm run check passes strict types, lint, 1814 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
