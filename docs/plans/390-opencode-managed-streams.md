# OpenCode managed native streaming conformance

## Issue and problem

Issue: #390. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Extend isolated OpenCode 1.18.5 probes from delegated routes to managed OpenAI text/function streams on both bases. Verify explicit custom-provider/model registration, text rendering, real fixture-only read-function execution and correlated result continuation, fresh IAM/limits, model/provider Deny and process-disconnect billed/missing accounting. Preserve fixed mocked upstream, isolated temporary Git/config/env and bounded process output/time. Default CI verifies both fixture route kinds; the installed-client gate runs 20 probes.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. Managed OpenAI text/function streaming is already public. This stage verifies the
bounded named-client subset without defining model snapshot equivalence or settling
open architecture choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/opencode-managed-streams.md).

## TDD plan

Before changing fixture scripts, extend socket tests to require managed accounting, native request shape and managed Deny audit. Expect delegated records/body/audit from the current fixture to fail. Then run the installed OpenCode version-pinned command across both route kinds, both bases and five modes, plus npm run check.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Verification evidence

Extend isolated OpenCode conformance from delegated routes to managed OpenAI text/function routes using generated native request/response fixtures at the fixed registered host. The runner covers both kinds and both bases with explicit custom-provider/model registration, rendered text, actual fixture-only read function/result continuation, model/provider Deny and process-termination cancellation/accounting. Preserve temporary Git/config/data/cache/state isolation, whitelist environment, exact read permission, disabled external config/plugins and existing deadlines/output caps.

Red: all 8 new managed fixture socket cases failed because the old fixture used delegated requests/accounting/audit. Green: 16 socket fixture cases pass across both route kinds. Explicit installed-client validation `npm run compatibility:opencode -- /Users/jungwon/.opencode/bin/opencode` passes all 20 OpenCode 1.18.5 probes. Real process events confirm tool execution/result continuation, rendered completion, 403 plus exit 1 on Deny, and cancelled billed/missing usage on disconnect. Full check passes; documentation and contract checker rerun after recording actual results.

No live provider/key is involved; exact native fixture IDs do not establish snapshot equivalence. Interactive retries/cancellation, automatic discovery, richer/custom tools, other applications/versions/native providers and full #116 remain open. Pin v19 is unchanged.


Full npm run check passes strict types, lint, 1876 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
