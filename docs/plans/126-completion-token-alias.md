# Completion-token alias

## Issue and problem

- Issue: [#126](https://github.com/Theorvane/OpenGranter/issues/126), compatibility parent #116.
- External clients use max_completion_tokens, which the current gateway rejects despite having an equivalent max_tokens pipeline.

## Scope and expected behavior

- Accept either positive safe-integer field at both HTTP chat paths and four adapter boundaries. Validate both supplied fields; accept equal pairs and reject unequal pairs with existing safe invalid-request/configuration errors.
- Project to the established output maximum and native mappings. Preserve configured direct caps and omission defaults.
- Capture the resolved primitive before credential lookup. IAM, limits, audit, usage and secret boundaries remain unchanged.
- Out of scope: reasoning-model capability metadata, native OpenAI reasoning parameter selection, streaming, tools, and all other compatibility gates.

## Design

- Share a pure resolver across the decoder and adapters. Normalize the HTTP request to canonical max_tokens so routing does not need client alias logic.
- Reject conflicting values instead of silently selecting one maximum. OpenRouter documents equal semantics but the referenced parameter page does not define simultaneous-value precedence; this conflict policy is an explicit local restriction.
- Document the restriction and native per-model gap in the [contract](../../contracts/client-output-limits.md), [compatibility matrix](../openrouter-compatibility.md), [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md).
- No costly architectural decision or new domain term is introduced.

## TDD plan

- Exercise real adapters and HTTP handlers with fake transport: alias-only/equal pairs, conflicting/invalid pairs, administrator caps and captured values during credential lookup.
- Verify implicit/explicit denial, request limits, required audit failure and upstream failure through HTTP without secret disclosure or accounting changes.
- Record failure against existing code, implement minimal shared resolution, run focused warning-free Biome and full npm run check.

## Delivery

- No migration or live upstream calls. Reverting removes alias acceptance and leaves legacy max_tokens behavior intact.
- Review independently of pending stop-sequence PR #125. Both add accepted request fields and require a small integration merge if #125 lands first.
- Full OpenRouter compatibility remains incomplete under #116.

## Verification evidence

- Red: 21 failures and one pass in the new 22-case adapter/HTTP suite against the previous implementation.
- Green: all 22 cases pass with the shared resolver and canonical HTTP projection.
- Full npm run check passed: strict TypeScript, lint, 545 passing tests, one optional external PostgreSQL test skipped, and planning/link/contract/fixture checks.
- Focused Biome with --error-on-warnings passed without warnings; git diff --check passed and the CLAUDE.md symlink remains intact.
- No live provider calls or credentials were used. Conflict handling and native reasoning-model gaps remain explicitly documented.
