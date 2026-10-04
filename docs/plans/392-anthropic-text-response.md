# Native Anthropic text response validation

## Issue and problem

Issue: #392. Native managed OpenAI text and function streams are already public; Anthropic native streaming is not yet connected. External-client compatibility remains gated by #116.

## Scope and expected behavior

Internal response-only preparation validates native Anthropic text SSE, exact model identity, sequential blocks, cumulative aggregate usage, safe failure and cancellation. Anthropic transport, public activation, functions, reasoning and server tools remain follow-up work.

## Design

Reuse bounded SSE framing and the native text callback/summary contract. Capture exact approved upstream model and client alias before asynchronous work. Timestamp native Anthropic output once at the gateway, as in its existing nonstream response, because Messages has no created field. Consume sequential text blocks without accumulating response content. Input usage comes from message_start (or a final reported update); output usage in message_delta is cumulative, never summed. Missing or invalid counters remain unavailable. Cache/tool categories and model snapshot equivalence remain outside this bounded slice. No new glossary term or costly ADR decision is required.

Official protocol reference: https://platform.claude.com/docs/en/build-with-claude/streaming . Use fixed safe failures, propagate cancellation and await callbacks. Preserve authenticate, route scope, model/provider IAM, limits, secrets, required usage and audit ordering at existing managed coordination boundaries.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), and [contract](../../contracts/anthropic-text-response.md).

## TDD plan

First run the new native response consumer tests before adding its module: they must fail because the module does not exist. Then verify the same tests against the smallest bounded state machine.

Verify success, outside-scope and unsupported-event denial, malformed/incomplete/error failures, missing usage, callback backpressure and cancellation. Run focused tests, npm run format, and full npm run check.

## Delivery

Issue and plan precede production code. Report red/green evidence and risks in the PR. Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash merge. Broader compatibility #116 and unresolved architecture #7 stay open.

## Verification evidence

Add the internal native Anthropic Messages text response consumer. It validates exact approved model identity and sequential text blocks, maps supported stop reasons, ignores pings, and awaits cancellable callbacks without retaining text in completion metadata. Final cumulative output usage is not summed or fabricated from the initial output count; missing/invalid counters retain existing unavailable semantics. Unknown/nontext events, malformed sequences, errors and incomplete EOF fail with fixed opened/possibly-billed failures.

TDD: the new module-boundary suite first failed with ERR_MODULE_NOT_FOUND (red); after implementation, all 39 Anthropic cases and 28 existing native OpenAI cases pass (67 focused cases). Covers scope/unsupported-event denial, HTTP/body/sequence failures, 1 MiB payload and 128-block bounds, cumulative/missing usage, callback backpressure and cancellation.

This response-only stage does not activate Anthropic transport or public streams. Anthropic functions, thinking/server tools, cache categories, model snapshot equivalence and full compatibility remain open. Official event protocol was checked against Claude Platform streaming documentation; controlled fixtures are not live provider certification.


Full npm run check passes strict types, lint, 1915 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
