# Gemini Safety Completion Mapping

## Issue and problem

- Issue: [#150](https://github.com/Theorvane/OpenGranter/issues/150).
- Native Gemini SAFETY responses without text currently become 502 instead of compatible filter outcomes.

## Scope and expected behavior

- Map promptFeedback.blockReason=SAFETY with absent/empty candidates and singleton finishReason=SAFETY with absent/empty model content to assistant content=null, finish_reason=content_filter.
- Preserve singleton/index validation. Reject contradictory prompt blocks with candidates, malformed/no-signal empty responses and populated blocked content safely with possible billing.
- Preserve alias and usage/missing/invalid states. Valid blocks are successful deliveries, never fallback triggers. IAM, limits and required audit precede invocation. No feedback/content/keys enter metadata audit, usage or errors.
- Other native reasons, Anthropic refusal mapping, tools/streaming and richer audit outcome classification remain deferred.

## Design

- Add bounded SAFETY branches before text normalization, using the shared completion envelope. Empty candidate content permits only optional model role and absent/empty parts. Do not synthesize refusal text or zero usage.
- Conservative validation avoids treating arbitrary empty upstream data as a successful block.
- Sources checked 2026-09-29: [Gemini response, PromptFeedback and FinishReason](https://ai.google.dev/api/generate-content). content_filter is the local compatibility mapping.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/gemini-safety.md).
- No new product decisions; other reason mappings need later conformance cases.

## TDD plan

- HTTP/actual SDK tests first; documented empty SAFETY outcomes currently produce 502.
- Verify both prefixes, usage/missing/invalid accounting, configured fallback not invoked, malformed/contradictory responses and implicit/explicit Deny/limits/required audit.
- Minimal native adapter branch, focused green, touched-file lint, full npm run check.

## Delivery

- Record red/green/full evidence and publish ready PR. The execution environment restarted before the earlier unpushed work was saved; restore and rerun all gates rather than reusing lost logs.
- Risk: audit success denotes delivery, not generated text. Unknown reasons and unusual block shapes remain conservative failures.
- Rollback reintroduces SAFETY-related 502 responses.

### Restored verification evidence

- Red: `node --experimental-strip-types test/gemini-safety.test.ts`: 4 expected failures, 1 pass against the restored baseline.
- Green: same command: 5 passes; both prefixes, actual SDK, known/missing/invalid usage, configured fallback, malformed/contradictory data and security gates.
- `npm run check`: 708 passes, 1 optional external PostgreSQL integration skipped, 0 failures. Typecheck, lint, document/link/contract/fixture checks and pinned schema integrity passed.
- Touched-file Biome with warnings as errors and whitespace checks passed. Lost pre-restart runs are not used as verification evidence.
