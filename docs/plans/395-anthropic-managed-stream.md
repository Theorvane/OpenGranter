# Managed Anthropic public text streaming

## Issue and problem

Issue: #395. Native managed OpenAI text and function streams are already public; Anthropic native streaming is not yet connected. External-client compatibility remains gated by #116.

## Scope and expected behavior

Public managed Anthropic text streaming is activated through a captured registration-kind dispatcher and generated persisted direct/dual handlers. Both API bases and actual OpenAI/OpenRouter SDK text consumption preserve authentication, model/provider Deny, limits, required usage/audit, cancellation and safe partial failure. Gemini and Anthropic functions/thinking/server tools remain unsupported.

## Design

Reuse bounded SSE framing and the native text callback/summary contract. Capture exact approved upstream model and client alias before asynchronous work. Timestamp native Anthropic output once at the gateway, as in its existing nonstream response, because Messages has no created field. Consume sequential text blocks without accumulating response content. Input usage comes from message_start (or a final reported update); output usage in message_delta is cumulative, never summed. Missing or invalid counters remain unavailable. Cache/tool categories and model snapshot equivalence remain outside this bounded slice. No new glossary term or costly ADR decision is required.

Official protocol reference: https://platform.claude.com/docs/en/build-with-claude/streaming . Use fixed safe failures, propagate cancellation and await callbacks. Preserve authenticate, route scope, model/provider IAM, limits, secrets, required usage and audit ordering at existing managed coordination boundaries.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), and [contract](../../contracts/anthropic-managed-stream.md).

## TDD plan

Before production edits, run dispatcher-backed SDK/gateway tests and persisted direct/dual cases: missing dispatcher and unconnected Anthropic registrations must fail. Then add only captured native text dispatch and generated wiring; retain existing OpenAI function/text regressions.

Verify success, outside-scope and unsupported-event denial, malformed/incomplete/error failures, missing usage, callback backpressure and cancellation. Run focused tests, npm run format, and full npm run check.

## Delivery

Issue and plan precede production code. Report red/green evidence and risks in the PR. Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash merge. Broader compatibility #116 and unresolved architecture #7 stay open.

## Verification evidence

Activate native Anthropic text streaming through the generated persisted managed direct/dual gateway. A dispatcher captures enabled administrator registrations and selects only the OpenAI or Anthropic text adapter after the existing managed authorization and limits. Both /v1 and /api/v1 project the approved alias; cumulative native usage flows through required ledger/outcome audit before successful final usage/DONE. OpenAI functions remain restricted to their native adapter.

TDD: before production edits the SDK/gateway module failed with the missing dispatcher and both persisted direct/dual tests returned 502 instead of 200. After the minimal dispatcher/wiring change, all 55 focused cases pass, including actual OpenAI and OpenRouter SDK text streams on both bases, auth/model/provider/limit/capability gates, missing usage, required usage/audit failure, actual SDK abort, stored native registration/body caps, ignored runtime overrides, partial native failure, metadata secrecy and newly stored provider Deny before another secret lookup. Existing managed OpenAI text/function and persisted direct/dual regressions remain green.

Risks/limits: native Anthropic functions, reasoning/server tools and cache categories remain unsupported; Google Gemini streams, model snapshot equivalence, broader named external-client/live certification and full #116 remain open. Compatible SDK tests use controlled native upstream fixtures.


Full npm run check passes strict types, lint, 1953 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
