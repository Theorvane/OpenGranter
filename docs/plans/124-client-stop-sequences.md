# Client stop sequences

## Issue and problem

- Issue: [#124](https://github.com/Theorvane/OpenGranter/issues/124), compatibility parent #116.
- External clients send stop but the gateway rejects it and direct/delegated adapters omit native mappings.

## Scope and expected behavior

- Accept a string or dense string array with zero through four entries. Null/omission produces no explicit stop setting. Preserve contents and order without trimming or treating strings as character lists.
- OpenRouter/OpenAI send stop; Anthropic sends stop_sequences; Gemini sends generationConfig.stopSequences. Keep max_tokens settings in the same Gemini generationConfig.
- Capture immutable known values before secret lookup. Reject malformed/oversized/sparse arrays before secrets/transport; required HTTP denial audit remains mandatory.
- No source prompt/stop values enter operational audit or errors. IAM, limits and usage remain unchanged.
- Provider-specific longer lists, per-model stop support, sampling, streaming and tools remain compatibility work.

## Design

- Shared pure snapshot validator projects null/omission to absence, strings unchanged and frozen copies of arrays. HTTP and adapters use this boundary before asynchronous work.
- Four entries are the current portable OpenAI-compatible limit. Native model-specific constraints still require trusted capability metadata or upstream validation.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/client-stop-sequences.md).

## TDD plan

- Public HTTP and all four real adapters with fake transport: string/Unicode/list/empty/null/omission, native mapping and max_tokens combinations.
- Malformed/oversized/sparse arrays fail before credential work; source mutation during secret lookup cannot change stop values.
- Denied IAM, request limits, required audit and provider failures retain existing behavior, safe numeric API errors and usage accounting.
- Record red/green, format, warning-free focused lint and full npm run check.

## Delivery

- No migration or live requests. Stop support remains model-dependent; larger provider-specific lists stay rejected until capability-aware handling is implemented.
- Full compatibility remains open. Stop patterns are request content and cannot enter ordinary audit.

## Verification evidence

- Red: the new public-boundary suite failed 17 of 18 cases against the previous implementation; one existing denial case passed.
- Green: all 18 cases pass after the native mappings and immutable snapshots were implemented.
- `npm run check`: strict TypeScript, lint, 541 passing tests, one optional external PostgreSQL test skipped, and planning/link/contract/fixture checks passed.
- Focused Biome checks with `--error-on-warnings` passed without warnings for the new validator and test suite. `git diff --check` passed and the `CLAUDE.md` symbolic link remains intact.
- No live provider calls or credentials were used. Model-specific capability validation and broader OpenRouter compatibility remain open under #116.
