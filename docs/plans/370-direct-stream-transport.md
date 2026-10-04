# Direct OpenAI text-stream transport preparation

## Issue and problem

Issue: #370. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Expose an internal fixed-host direct OpenAI text-stream transport. Reuse existing native request controls and administrator output caps; capture approved candidate identity, client alias and complete prepared body before awaiting secrets. Nonstream adapters use the same captured scope. Always request include_usage for internal streams; reject other provider kinds and tool declarations/history before credentials. Support cancellation/deadline while awaiting secrets and fetch without inference retry. Response consumption and public managed streaming follow separately.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. This stage does not activate public
managed streaming, define model snapshot equivalence or settle open architecture
choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/direct-stream-transport.md).

## TDD plan

First reproduce mutation during secret resolution changing the outgoing upstream model and normalized client alias. Then add missing transport-boundary tests before implementing the optional streaming mode.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Verification evidence

Expose an internal direct OpenAI text-stream transport from the shared direct provider boundary. Prepared request body, approved candidate, client alias and registration kind are captured before secret resolution; nonstream normalization shares that same snapshot. Streaming requests force native include_usage and retain existing output caps/controls; unsupported provider kinds and tool declarations/history reject before credentials. Deadline/cancellation covers secret and fetch waits, including uncooperative operations and late response cleanup, without retry.

Red: mutation during secret await transmitted an unapproved upstream ID; the new transport entry point was absent. Additional regressions reproduced credential lookup after pre-abort and normalization using a second inconsistent registration snapshot. Green: 21 focused direct/transport tests pass; complete check passes. Native OpenAI sequence consumption, public managed streaming/accounting and broader native providers remain subsequent work. Pin v19 and public capabilities are unchanged; no full #116 claim.


Full npm run check passes strict types, lint, 1689 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
