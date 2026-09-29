# Client temperature sampling

## Issue and problem

- Issue: [#130](https://github.com/Theorvane/OpenGranter/issues/130), compatibility parent #116.
- External clients send temperature but the decoder rejects it and native adapters omit it.

## Scope and expected behavior

- Accept optional finite numeric temperature in 0..2 on both HTTP paths and OpenRouter/OpenAI/Gemini adapters. Direct Anthropic enforces native 0..1 before credential lookup. Never clamp values.
- Omission preserves upstream defaults; capture the primitive before asynchronous credential lookup.
- Preserve combined stop/output settings, direct output caps, authentication, IAM, limits, required audit, safe errors and per-attempt usage.
- Out of scope: model capability negotiation, reasoning-specific restrictions, temperature/top_p pairing, streaming and tools. PR #129 top_p support is merged and integrated in this branch.

## Design

- Shared pure temperature validation with an explicit maximum protects HTTP and adapter boundaries. Project only the validated known field and pass its captured scalar to native request construction.
- Provider-range violations use existing non-retryable/non-billable adapter failures. They occur after authorization/limits at HTTP execution, produce a safe upstream failure and a failed-attempt audit record, and never resolve credentials or call transport. Existing managed-route semantics omit ledger records for unstarted known non-billable attempts. This is distinct from globally malformed input, which produces required invalid-request audit before route work.
- No new error schema or route-selection policy. Unknown model-specific restrictions remain upstream errors until trusted capability metadata is implemented.
- Update [contract](../../contracts/client-temperature.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [compatibility inventory](../openrouter-compatibility.md).

## TDD plan

- Four real adapters with fake transport: bounds/fractions/omission, invalid internal inputs before secrets, captured values during credential lookup, native mapping and administrator output caps.
- Both HTTP paths combine stop/output settings with temperature and verify successful usage. Verify globally malformed denial audit, direct Anthropic range rejection/accounting, IAM/limit/audit enforcement and upstream failure safety.
- Demonstrate expected red, implement minimal validation/mapping, run focused warning-free Biome and full npm run check.

## Delivery

- No migrations or live upstream calls. Reverting restores unsupported-field rejection.
- Record full TDD/check evidence and provider/model restrictions in the PR. Full OpenRouter compatibility remains incomplete.

## Verification evidence

- Red: 22 failures and one pass in the new 23-case public adapter/HTTP suite against the previous implementation.
- Green: all 23 cases pass; existing chat-handler coverage also passes all 17 cases after replacing the obsolete temperature-as-unsupported fixture with unsupported top_k and invalid temperature.
- Initial expectations for range-failure ledger entries were corrected against established managed-route semantics: unstarted known non-billable failures receive failed-attempt audit, not usage ledger entries. No accounting implementation change was made.
- Final npm run check passed: strict TypeScript, lint, 587 passing tests, one optional external PostgreSQL test skipped, and planning/link/contract/fixture checks.
- Focused Biome with --error-on-warnings passed without warnings; diff checks passed and CLAUDE.md remains a symbolic link to AGENTS.md.
- No live provider calls or credentials were used. Native per-model capabilities and paired sampling restrictions remain explicit.

## Integration with merged top_p support

PR #129 is now merged. Integrate its scalar validation and native fields alongside temperature without changing either documented range. First add HTTP combined-parameter and adapter mutation regressions; verify they fail against temperature-only code, then preserve both settings through decoder and native mapping. Both stop and output maxima must also remain present. Fake model support in these tests does not certify real models or sampling combinations; capability negotiation remains open. Repeat full checks and request review of the integrated head before merge.

## Integrated-head verification

- Red: the two new combined HTTP/adapter cases failed against temperature-only code; the previous 23 temperature cases passed.
- Green: all 25 temperature cases pass after both scalar mappings were retained. Four adapters preserve temperature/top_p/stop/output settings; both scalars remain stable during secret lookup.
- Full npm run check passed with strict TypeScript, lint, 611 passing tests, one optional external PostgreSQL test skipped and document/contract/fixture checks.
- Focused warning-free Biome and diff checks passed; CLAUDE.md remains the AGENTS.md symlink. Updated PR #131 requests review of the integrated head.
