# Portable Penalty Controls

## Issue and problem

- Issue: [#156](https://github.com/Theorvane/OpenGranter/issues/156).
- Client frequency_penalty/presence_penalty fields currently reject before routing, limiting standard SDK requests.

## Scope and expected behavior

- Each optional nullable finite number in [-2,2] maps independently; null/omission preserves provider defaults. Retain exact negative, zero and positive values without clamping.
- OpenAI/OpenRouter retain field names; Gemini maps native frequencyPenalty/presencePenalty. Direct Anthropic rejects supplied non-null penalties before secret/transport with safe existing failure accounting and no fabricated usage row.
- Capture scalars before awaits. Preserve IAM/limits/required audit, token/sampling/stop controls, usage and secrecy. No capability-based rerouting or prompt rewriting is added.
- Per-model support and broader sampling parameters remain deferred.

## Design

- Shared pure range validator plus optional typed fields on ChatRequest; HTTP and native boundaries normalize null and capture scalar values.
- Unsupported direct Anthropic requests fail instead of silently changing requested semantics. Explicit zero still counts as a supplied control; omission/null is the portable default path.
- Sources checked 2026-09-29: [OpenRouter parameters](https://github.com/OpenRouterTeam/docs/blob/main/api_reference/parameters.mdx), [official schema](https://openrouter.ai/openapi.json), installed OpenAI SDK types and [Gemini config](https://ai.google.dev/api/generate-content). The client range is a bounded portable contract, not universal model support.
- No new model capability policy. Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/client-penalties.md).

## TDD plan

- HTTP/SDK and native payload tests first; current HTTP rejects controls and native inputs ignore them.
- Cover boundaries, null/omission, independent/combined values, invalid types/nonfinite values, secret-await mutation, Google penalty-only configuration, unsupported Anthropic, IAM/limits/audit and safe transport accounting.
- Minimal validator/serialization changes, focused green, touched lint and full npm run check.

## Delivery

- Record red/green and full gates in a ready PR.
- Risk: native mappings rely on supported models; unknown capabilities remain explicit. Unsupported Anthropic returns safe 502 without a provider call; no automatic rerouting.
- Rollback restores unknown-field rejection.

## Verification evidence

- Red: focused public-boundary tests reported 13 failures and 1 pass before implementation; supplied controls were rejected at HTTP boundaries or omitted by native adapters.
- Green: all 14 focused tests pass, covering SDK requests, mapping/defaults, invalid inputs, unsupported Anthropic, pre-secret capture, authorization, limits, audit and safe failure accounting.
- Full gate: `npm run check` passes with 739 tests passing and 1 optional PostgreSQL integration test skipped locally. Type checking, linting, planning/link/contract/fixture-secret checks and pinned OpenRouter schema integrity pass.
- Touched-file lint with warnings treated as errors and `git diff --check` pass.
- This branch includes merged Anthropic refusal PR #153. Response-format PR #155 remains independently reviewable and is not included; cross-control integration must be validated when both changes merge.

## Approved response-format integration

- PR #155 is now merged. Resolve shared HTTP validation and adapter serialization conflicts by retaining both response_format and the penalty controls.
- The original red/green evidence remains the implementation basis. Additional combined tests check actual SDK serialization on both base paths, native credential-await capture and Anthropic null/default versus unsupported-control behavior.
- Focused format/penalty validation: 30 tests pass (17 penalty tests, 13 response-format tests). Full integrated validation is recorded below once complete.
- Earlier statements that PR #155 is independently pending describe the original delivery; this integration supersedes them. Model-specific support, strict schemas, native Anthropic JSON/penalties, capability-aware routing and full external-client workflows remain open.

- Integrated full gate: `npm run check` passes with 755 tests passing and 1 optional PostgreSQL integration test skipped locally. Typecheck, lint, planning/link/contract/fixture-secret validation and pinned OpenRouter schema integrity pass. Touched-file lint with warnings as errors and diff whitespace validation also pass.
