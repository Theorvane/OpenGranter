# Client Seed Controls

## Issue and problem

- Issue: [#160](https://github.com/Theorvane/OpenGranter/issues/160).
- HTTP rejects standard seed requests and native adapters omit the control.

## Scope and expected behavior

- Accept optional nullable finite JavaScript safe integers. Null/omission preserves defaults; negative, zero and positive values remain exact.
- OpenAI/OpenRouter forward seed; Gemini generationConfig.seed must fit signed int32, even for seed-only settings. Anthropic non-null seeds, including zero, fail before secrets/transport.
- Preserve IAM, limits, required audit, existing settings and safe usage. No random seed injection, clamping, prompt rewriting or capability-based rerouting.
- Per-model support and deterministic output are not guaranteed. Provider fingerprint/response metadata, other parameters and full external-client conformance remain open.

## Design

- Shared safe-integer validator, optional ChatRequest field, scalar capture and native-boundary validation before awaits.
- Preserve broader safe-integer input for OpenAI/OpenRouter instead of restricting every route to Gemini's range. Reject native unsupported semantics using the existing safe 502 without a fabricated provider usage row.
- Sources checked 2026-09-29: [OpenRouter schema](https://openrouter.ai/openapi.json), installed OpenAI SDK, [Gemini API](https://ai.google.dev/api/generate-content) and [Google discovery schema](https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta), whose GenerationConfig seed is integer/int32.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/client-seed.md).

## TDD plan

- Public HTTP/SDK/native tests first: rejection/omission is the expected red outcome.
- Cover null/defaults, signed/zero/range edges, unsafe/nonfinite/fraction/type rejection, Gemini-only settings, unsupported Anthropic, native-range failures, captured values, IAM/limits/audit and transport accounting.
- Minimal normalization/mapping, focused green, touched lint, full npm run check.

## Delivery

- Ready issue-scoped PR with plan, red/green evidence, validation and model-support limitations.
- Revert optional field and mappings for rollback; no persisted-data migration.
- Pending schema-drift PR #159 is separate; seed is not added to its reviewed field allowlist here.

## Verification evidence

- Red: 13 focused failures and 1 pass before production changes; HTTP requests rejected seed and native adapters ignored/rejected no supplied control.
- Green: 14 focused HTTP/SDK/native tests pass, including integer bounds, null/omission, native-range/unsupported destinations, credential-await capture, seed-only configuration, IAM/limits/required audit and safe transport usage.
- `npm run check`: 769 tests pass and 1 optional PostgreSQL integration test is skipped locally. Typecheck, lint, planning/link/contract/fixture-secret checks and pinned schema integrity pass.
- Touched-file lint with warnings treated as errors and `git diff --check` pass.
- Based on main including merged PR #157. Pending schema expansion PR #159 remains separate; combined baseline validation must follow its eventual merge.
