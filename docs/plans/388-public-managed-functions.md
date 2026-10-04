# Public managed OpenAI function streaming

## Issue and problem

Issue: #388. Complete external-client compatibility remains gated by #116.

## Scope and expected behavior

Activate the trusted native function stream port on both chat bases and generate it from stored native registrations in direct/dual PostgreSQL servers. Preserve authentication, complete model/final-provider IAM, limits, Jev/order selection, accounting/audit gates, no replay and cancellation. Both installed SDKs must complete two interleaved calls and correlated tool-result continuation on both bases with fresh Deny, persistence errors, unknown usage and abort. Keep exact native model IDs and rich/custom/server-tool/other-native-provider gaps open.

## Design

Reuse validated bounded framing, request snapshots and fixed administrator-registered
destinations. Preserve deny-by-default IAM and limits at the existing coordinator;
internal adapters require an already-authorized candidate. Secrets and response
content never enter operational metadata. Managed OpenAI text streaming is already public. This stage activates the bounded public managed function subset. It does not
define model snapshot equivalence or settle open architecture choices. No new glossary term or costly ADR decision is required.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md),
[acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md)
and [contract](../../contracts/public-managed-functions.md).

## TDD plan

Before code, add native SDK lifecycle tests and persisted direct/dual function acceptance. Expect unsupported 400. Verify result-history controls, Deny before keys, required handoff failure, no replay, unknown usage, native-body cancellation and generated adapter override prevention.

Cover success, unsupported input/registration, failure and cancellation through the
new public module boundary; retain existing provider regressions. Run focused
tests, npm run format and full npm run check.

## Delivery

Issue and plan precede code. Record actual red/green and full validation in the PR.
Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash
merge. Keep broader native/provider/application gaps and #116 open.

## Verification evidence

Activate trusted managed OpenAI function streaming on both chat bases and generate native adapters from stored registrations in direct/dual PostgreSQL servers. Route-specific stream availability prevents a native function port from enabling an unwired delegated function route. Shared auth/full model-provider IAM, limits, Jev/order selection, accounting/audit, bounded delivery and cancellation remain intact; completed calls stay outside operational metadata. Generated ports replace runtime overrides.

Red: 24 native SDK scenarios and persisted direct/dual function acceptance failed on unsupported 400 before wiring (26 failures). Green: 58 focused tests pass across actual OpenAI 7.23.0/OpenRouter 1.4.18 sockets on both bases, persisted direct/dual boundaries and existing managed text regressions. Both SDKs assemble two interleaved calls, send correlated results and re-evaluate Deny; pre-frame gates, safe partial/persistence failures without replay, missing usage and SDK abort are verified. Persisted factories ignore runtime function overrides and use stored Deny before new keys.

Native functions are now public; exact native IDs, custom/server tools, rich/multimodal calls, Anthropic/Gemini streams, direct named-client probes and full #116 remain open. Pin v19 is unchanged.


Full npm run check passes strict types, lint, 1868 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
