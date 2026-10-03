# Map reasoning effort to direct OpenAI

## Issue and problem

- Issue: [#278](https://github.com/Theorvane/OpenGranter/issues/278), release gate #116 and request controls #274.
- Direct OpenAI rejects the validated client reasoning_effort control before credentials even though native Chat Completions declares the same field.

## Scope and expected behavior

- Preserve exact optional none/minimal/low/medium/high/xhigh/max on direct OpenAI nonstream requests through both client bases. Null/omission inject no field or default.
- Capture once before asynchronous credentials. Preserve other generation/tool/history controls, fixed registered host, IAM/explicit Deny, limits, required audit/usage and safe billing uncertainty.
- Anthropic/Gemini non-null effort remains unsupported before credentials. Direct streams, structured reasoning, model capability discovery and richer reasoning response/usage projections remain outside scope.

## Design

- Reuse the shared union/validator; allow the OpenAI destination and pass the captured value into its native body builder only.
- Official OpenAI Chat Completions and installed SDK declare these seven values; support/defaults differ by model. Forward explicit values without inventing model aliases or asserting universal acceptance.
- No domain term or costly product decision changes. Repository grill-with-docs fact audit verifies native contract and limitations.
- Depends on [PR #275](https://github.com/Theorvane/OpenGranter/pull/275); rebase only this issue's commit after its squash merge.
- Update PRD, architecture, acceptance, compatibility inventory and [contract](../../contracts/client-reasoning-effort.md).

## TDD plan

- First public direct OpenAI request fails red with 502 instead of 200.
- Cover every enum/null/omission, invalid early rejection, unsupported destinations, immutable captures, no injected defaults, tool history, IAM/Deny/limits/audit/usage failures, safe possibly-billed upstream failure and actual OpenAI SDK sockets.
- Permit only OpenAI and project one captured native field; run focused tests and npm run check.

## Delivery

- Include red/green, official contract, checks and remaining model/response limitations in the PR.
- Rollback restores direct non-null rejection. No migration or new host.
- Require CI and approval before merge; integrated dependent heads require fresh validation.

## Verification evidence

- Red: public direct OpenAI request returned 502 instead of 200 with a valid effort.
- Green: 24 focused tests pass (eight new direct tests plus sixteen request-control regressions). All seven levels/null/omission, immutable captures, tool/history coexistence, safe possibly-billed failure accounting, denial/limits/required audit and ledger, unsupported managed streaming and real OpenAI SDK sockets are covered.
- npm run check passes 1,071 tests with one existing optional PostgreSQL skip, strict types, lint, document/link/contract/fixture checks and offline pin integrity.
- Current [official Chat Completions contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and installed OpenAI SDK 7.23.0 agree on seven values. Model capabilities/defaults remain variable; no universal native reasoning compatibility claim.
- Rebase only this issue's commit after dependency approval/merge and rerun checks.

Merge preparation retains the separate verbosity argument, body field and native capability guard alongside reasoning effort. A combined regression verifies distinct values through both public chat bases and immutable captures across the credential await. Full checks and required CI rerun on the actual rebased head.
