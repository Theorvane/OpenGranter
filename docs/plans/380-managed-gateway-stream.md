# Public managed OpenAI text streaming

## Issue and problem

Issue: #380. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Activate managed OpenAI text/refusal streaming through an optional trusted gateway port on both /v1 and /api/v1 and generate that port from stored native registrations in persisted direct/dual servers. Retain complete model/final-provider IAM, limits, Jev/order selection, required usage/audit and bounded cancellation. Reject managed tools/tool histories before inference; unsupported native registrations fail before provider-key lookup without silently changing candidate selection. Exact upstream model IDs remain required. Native tools, Anthropic/Gemini streaming and full #116 remain open.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. This stage activates the bounded managed OpenAI text stream subset. It does not
define model snapshot equivalence or settle open architecture choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/managed-gateway-stream.md).

## TDD plan

Write public gateway and real SDK/socket tests and extend the persisted direct server boundary before code. Expect managed streams to return 400; confirm denied auth/IAM/limit, unsupported tools/registration, required persistence failure, unknown usage and SDK cancellation paths.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Persisted history regression

Persisted stream acceptance also exposed a pre-existing audit-history ordering bug: selecting event_id as text made unqualified ORDER BY event_id lexicographic at event 10. This increment includes numeric source-column ordering, verified across multi-digit IDs and keyset pages, so the required metadata remains readable after multiple streams.

Before the fix, add a public reader regression with 12 events and verify incorrect first-page IDs (9, 8, 7 instead of 12, 11, 10), as well as the public HTTP AuditHistoryUnavailable failure with a larger page, then assert descending numeric IDs and stable keyset pages.

## Verification evidence

Managed OpenAI text/refusal streams now reach /v1 and /api/v1 through a trusted optional gateway port, generated from stored registrations in direct/dual PostgreSQL servers. The existing managed scope/ports remain shared with nonstream routing: authentication, full model/final-provider IAM, limits, Jev/order selection, per-attempt accounting and required audit precede completion. Managed tool controls/history reject even in dual composition; unsupported selected native kinds fail before provider keys without silently narrowing selection. Generated adapters replace runtime overrides.

Persisted acceptance exposed a pre-existing audit history bug: ORDER BY the text projection sorted event IDs lexicographically once IDs reached 10, causing wrong pages or safe 503 rejection. Qualify the numeric source column and verify multi-digit IDs and keyset continuation. The issue, plan and contract were updated before this fix.

Red: public/native SDK and persisted boundary tests returned unsupported 400 before wiring (15 failures). A separate audit-reader regression then returned IDs 9,8,7 instead of 12,11,10; the persisted HTTP audit path returned 503. Green: all 44 focused tests pass across gateway/native SDKs, persisted direct/dual servers and audit history. OpenAI 7.23.0 and OpenRouter 1.4.18 parse streams on both bases; SDK abort cancels the actual native body and records one failed billed attempt. Explicit Deny, authentication/limit, unsupported tools/native registration, required usage/audit failure, unknown usage, generated-port override prevention and multi-digit history are verified.

Exact configured upstream model IDs are required; model snapshot equivalence, native function streams, Anthropic/Gemini streams, direct named-client probes, live provider conformance and full #116 remain open. Optional Jev secrets retain the established coordinator stage. OpenRouter pin v19 is unchanged.


Full npm run check passes strict types, lint, 1784 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
