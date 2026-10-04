# Controlled managed HTTP stream delivery

## Issue and problem

Issue: #378. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Reuse the existing single-pending-frame HTTP controller for managed text streams. Preserve awaited delivery, zero high-water mark, cancellation, metadata-only interruption audit and post-accounting final frame gates. Project managed provider/credential/usage/audit failures safely for OpenAI and OpenRouter formats; public gateway activation is a subsequent increment.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. This stage does not activate public
managed streaming, define model snapshot equivalence or settle open architecture
choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/managed-http-stream.md).

## TDD plan

First test the new HTTP response entry point and confirm its missing export fails. Cover success with bounded unread demand, pre-output denial/error mapping, midstream failures without DONE and client cancellation with exactly one billed attempt.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Verification evidence

Generalize the existing single-pending-frame HTTP controller to managed text stream input/results and add a managed entry point. Keep zero high-water mark, awaited body delivery, cancellation, interruption audit and safe OpenRouter/OpenGranter error projection unchanged. Map managed provider, Jev credential and outcome-audit failures explicitly.

Red: HTTP boundary tests failed on the missing managed export before implementation. Green: 14 new HTTP boundary tests pass across both formats, including unread-body backpressure, pre-output failures, midstream provider/usage/audit failures without DONE and cancellation with exactly one billed failed attempt. Existing delegated text/function regressions retain the shared controller. Public gateway activation remains a subsequent increment; #116 and unsupported native/provider/tool cases remain open.


Full npm run check passes strict types, lint, 1761 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
