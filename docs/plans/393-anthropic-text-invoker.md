# Registered Anthropic text stream invocation

## Issue and problem

Issue: #393. Native managed OpenAI text and function streams are already public; Anthropic native streaming is not yet connected. External-client compatibility remains gated by #116.

## Scope and expected behavior

Internal native Anthropic text invocation uses an explicit transport mode, captured administrator registration and Messages request, fixed host and headers, capped output, timeout and caller cancellation. Existing OpenAI-only stream modes remain restricted. This stage does not yet wire persisted public Anthropic streams or tools.

## Design

Reuse bounded SSE framing and the native text callback/summary contract. Capture exact approved upstream model and client alias before asynchronous work. Timestamp native Anthropic output once at the gateway, as in its existing nonstream response, because Messages has no created field. Consume sequential text blocks without accumulating response content. Input usage comes from message_start (or a final reported update); output usage in message_delta is cumulative, never summed. Missing or invalid counters remain unavailable. Cache/tool categories and model snapshot equivalence remain outside this bounded slice. No new glossary term or costly ADR decision is required.

Official protocol reference: https://platform.claude.com/docs/en/build-with-claude/streaming . Use fixed safe failures, propagate cancellation and await callbacks. Preserve authenticate, route scope, model/provider IAM, limits, secrets, required usage and audit ordering at existing managed coordination boundaries.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), and [contract](../../contracts/anthropic-text-invoker.md).

## TDD plan

First run the native invocation tests without the new module and record the missing-module red; then compose existing fixed-host preparation with the bounded response consumer and rerun native/OpenAI regressions.

Verify success, outside-scope and unsupported-event denial, malformed/incomplete/error failures, missing usage, callback backpressure and cancellation. Run focused tests, npm run format, and full npm run check.

## Delivery

Issue and plan precede production code. Report red/green evidence and risks in the PR. Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash merge. Broader compatibility #116 and unresolved architecture #7 stay open.

## Verification evidence

Compose the native Anthropic text response validator with an explicit registered Anthropic text transport mode. Messages receives stream:true at its fixed HTTPS endpoint with the registered key reference and version header. Existing request snapshots, output caps, unsupported-parameter validation, timeout and caller cancellation apply before/through inference. OpenAI-named text/function adapters remain OpenAI-only; no adapter retries or public capability wiring are introduced.

TDD: the new native invoker suite failed with the expected missing module before implementation. All 57 focused Anthropic/OpenAI text/function/transport cases pass afterward, including captured scope/body, fixed headers and host, capped output, unsupported registration/input before secrets, classified HTTP failures, partial/missing usage, callback cancellation, pre-abort, unbilled secret failure and hanging-body deadline.

Public persisted Anthropic activation remains next-stage work; Anthropic functions/thinking/server tools, snapshot equivalence and full #116 remain open. Tests use controlled native fixtures, not live provider certification.


Full npm run check passes strict types, lint, 1931 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
