# Nullable Top-K Sampling

## Issue and problem

- Issue: [#162](https://github.com/Theorvane/OpenGranter/issues/162).
- Compatible HTTP paths reject top_k and native adapters omit it.

## Scope and expected behavior

- Optional nullable nonnegative JavaScript safe integer; preserve supplied zero/positive values and omitted/null defaults.
- OpenRouter/Anthropic retain top_k; Gemini generationConfig.topK uses native int32 bounds. Direct OpenAI non-null controls fail before credentials/transport, including zero.
- Preserve IAM, limits, required audit, existing controls and per-attempt usage. No clamping, default injection, prompt rewriting or capability-aware rerouting.
- Native mapping does not guarantee model support: newer Anthropic models reject top_k, and Gemini support is model-dependent. Full capabilities, other sampling/tool/stream workflows remain open.

## Design

- Pure nonnegative safe-integer validator plus typed optional field; HTTP and native boundaries normalize null/capture scalars before awaits.
- Broader safe-integer client contract preserves OpenRouter input; apply native int32 limits only to Gemini. Existing safe 502 and non-billed failure accounting for unsupported destinations.
- Sources checked 2026-09-29: [OpenRouter schema](https://openrouter.ai/openapi.json), [Anthropic API](https://platform.claude.com/docs/en/api/typescript/messages/create), [Gemini API](https://ai.google.dev/api/generate-content) and [native discovery](https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta).
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/client-top-k.md).

## TDD plan

- Public HTTP/SDK/native tests first: expected rejection/omission red.
- Cover zero/positive/null/default/bounds, native range/unsupported OpenAI, malformed/nonfinite/unsafe inputs, credential-await capture, Google-only generation settings and IAM/limits/audit/transport accounting.
- Minimal field/validator/native mapping, focused green, strict touched lint, full npm run check.

## Delivery

- Ready issue-numbered PR with red/green and full validation evidence.
- Rollback removes optional field/mappings; no persisted-data migration.
- Pending schema-drift and seed PRs remain independent. The source-drift allowlist does not cover top_k yet.

## Verification evidence

- Red: 13 focused failures and 1 pass before implementation; HTTP rejected controls and native adapters omitted supplied values.
- Green: 14 new tests pass; 31 pass together with the gateway suite. Corrected the native capture fixture to use the external top_k key and verified the native topK mapping independently.
- First full gate found one obsolete gateway test asserting that valid top_k is unsupported. Replace that case with unknown min_p and negative top_k, retaining rejection coverage while the dedicated suite verifies success.
- Updated full `npm run check`: 769 tests pass and 1 optional PostgreSQL integration is skipped locally. Typecheck, lint, planning/link/contract/fixture-secret and offline schema checks pass. Strict touched-file lint and diff whitespace validation pass.
- Approved seed PR #161 is now merging; integration evidence follows below. Schema PR #159 remains separately reviewable.

## Approved seed integration

- PR #161 is merged. Resolve shared validator/native-preparation conflicts by retaining both seed and top_k capture, destination validation, argument order and Gemini generation settings.
- Combined seed/top-k public-boundary suites: 28 tests pass. Updated full `npm run check`: 783 tests pass and 1 optional PostgreSQL integration is skipped locally; typecheck, lint, planning/link/contract/fixture-secret checks and offline schema integrity pass.
- Strict touched-file lint and diff whitespace validation pass. Original evidence above is historical; merged seed support is included in this delivery.
- Schema PR #159 is updated separately with current main and awaits its latest checks/review. No new capability policy or full-compatibility claim is introduced.

## Approved schema-harness integration

- PR #159 is merged. Integrate its eleven-field/two-definition source pin and structural drift harness while retaining all top-k and seed runtime acceptance cases.
- Full integrated `npm run check`: 793 tests pass and 1 optional PostgreSQL integration is skipped locally. Typecheck, lint, planning/link/contract/fixture-secret checks and offline source-pin integrity pass. Diff whitespace validation passes.
- Earlier pending-schema statements are historical and superseded. Additional seed/top_k source tracking is a separate issue #164; native support and full client/tool/stream conformance remain open.
