# Validate Native Text Stop Reasons

## Issue and problem

- Issue: [#176](https://github.com/Theorvane/OpenGranter/issues/176).
- Direct Anthropic/Gemini successful text responses can collapse unsupported, malformed or missing native stop reasons to null, losing whether output needs tool continuation, was blocked or otherwise incomplete.

## Scope and expected behavior

- Anthropic end_turn/stop_sequence map to stop; max_tokens maps to length. Existing bounded refusal maps to content_filter. Other/malformed/missing reasons fail.
- Gemini STOP maps to stop; MAX_TOKENS maps to length. Existing bounded SAFETY maps to content_filter. Other/malformed/missing reasons fail even if text parts exist.
- Use existing safe post-response failure/accounting; preserve IAM/limits/audit gates, no provider text/reason in metadata/errors. No new retry/fallback rule, native tool workflow or new blocked-outcome mapping.

## Design

- Validate allowed native reason before building text completion; keep refusal/SAFETY special cases before the generic guard. The current null fallback loses semantics; rejecting unsupported outcomes preserves client truthfulness.
- Official references: [Anthropic stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons), [Gemini FinishReason](https://ai.google.dev/api/generate-content). Both document additional tool/blocked reasons beyond the supported text subset. The Gemini candidate reason may be absent while generation has not stopped, so a non-streaming successful text result cannot infer completion.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/native-stop-reasons.md). Rich native refusal/blocked mappings, content/usage classes, tools and streaming remain unresolved.

## TDD plan

- HTTP/SDK tests first for unsupported/malformed/missing reasons currently treated as successful null.
- Cover accepted text reasons and existing bounded refusal/SAFETY, both paths, SDK, possibly billed accounting, IAM/limit/audit denial and metadata/error leakage.
- Minimal normalizer guard, focused green, npm run check; retain strict TS and no added fixture secrets.

## Delivery

- Ready issue-numbered PR with red/green evidence and validation.
- Rollback only the guards; no stored-data migration or provider capability policy changes.

## Verification evidence

- Red: four expected failures and four passes before implementation; unsupported native reasons were reported as successful null-finish text.
- Green: all eight HTTP/SDK/security/accounting tests pass on both native providers and compatible paths.
- Final npm run check passes: 856 tests pass, one optional external PostgreSQL test skips. Type checking, lint, planning validation and pinned integrity pass; local PGlite tests run. Git diff whitespace checks pass.
