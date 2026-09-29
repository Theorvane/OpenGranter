# Optional Text Message Names

## Issue and problem

- Issue: [#166](https://github.com/Theorvane/OpenGranter/issues/166).
- External text messages with optional name currently fail exact-key validation.

## Scope and expected behavior

- Optional string name on system/developer/user/assistant text messages, including HTTP text-array normalization. Preserve exact string values, including empty/space/Unicode; null/non-string names reject.
- OpenAI/OpenRouter forward names. Direct Anthropic/Gemini fail supplied names before credentials/transport instead of dropping semantics or rewriting prompt text.
- Snapshot message/name/content before awaits. Authenticated principal alone controls IAM, limits and audit/usage attribution; caller names are prompt protocol data, never an identity override. Keep them out of metadata audit/errors.
- Existing instruction ordering, text-role scope, single response and control/failure contracts remain unchanged. Native named-speaker semantics, tools, multimodal and streaming remain open.

## Design

- Add optional readonly name to ChatMessage and exact-key/string validation in the shared immutable snapshot. The HTTP normalizer already preserves keys while joining text arrays.
- Preserve names only where a native field exists; unsupported direct providers reject safely before secret resolution with no fabricated provider usage. No new capability-aware candidate selection.
- Sources: official OpenRouter ChatSystem/Developer/User/AssistantMessage definitions, raw snapshot retrieved 2026-09-29, and installed OpenAI SDK types. OpenRouter declares name as optional string without bounds; do not invent regex/length constraints or nullable behavior.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/client-message-names.md).

## TDD plan

- HTTP/SDK/native tests first: exact-key rejection and native omission are expected red outcomes.
- Cover all roles/defaults/string values/text arrays, malformed/null inputs, instruction placement, immutable pre-await capture, direct unsupported names, IAM/limits/audit, principal attribution and safe transport accounting.
- Minimal shared snapshot and direct-provider guard, focused green, strict touched lint and full npm run check.

## Delivery

- Ready issue-scoped PR with plan, red/green, validation and remaining support gaps.
- Revert optional field and guards for rollback; no persisted-data migration or new identity policy.

## Verification evidence

- Red: the new message-name suite reproduced 11 expected failures and 2 passes before implementation; valid named text failed boundary validation or lost its name at the native snapshot.
- Green: all 13 new tests pass. The combined message-name/developer suite passes 32 tests across HTTP, native adapters and the installed SDK.
- The first full check found three obsolete developer cases treating a string name as invalid. Update that malformed-input fixture to name: null; the new suite separately verifies valid names.
- Final npm run check passes: 812 tests pass, one optional external PostgreSQL integration test skips. Type checking, lint, planning-document validation and pinned schema integrity pass; local PGlite tests run. Git diff whitespace checks pass.
