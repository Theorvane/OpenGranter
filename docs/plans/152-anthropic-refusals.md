# Native Anthropic Refusal Completions

## Issue and problem

- Issue: [#152](https://github.com/Theorvane/OpenGranter/issues/152).
- Empty Anthropic refusal content becomes 502; textual refusal loses its explicit outcome in compatible responses.

## Scope and expected behavior

- Explicit non-streaming stop_reason=refusal plus valid empty/text-only content maps to assistant content=null, refusal=null and finish_reason=content_filter through both prefixes.
- Discard partial refusal output and do not forward provider stop_details. Other normal text completions retain existing mappings.
- Missing/malformed/mixed/tool/thinking content and empty non-refusal content fail safely with possible billing. Streaming, rich content, automatic refusal fallback and category-based billing logic remain deferred.
- Preserve usage/missing/invalid states. Do not infer free usage from refusal or fabricate zero billed cost. Successful refusal delivery does not call a configured backup; IAM/limits/required audit remain shared. Content/details/keys stay out of metadata and errors.

## Design

- Extend the bounded Anthropic normalizer only after validating its content array. Use shared assistant completion validation for the null-content/filter envelope.
- Choose filtered null output instead of treating incomplete text as a usable answer. Local content_filter mapping is an adapter contract, not a native Anthropic field.
- Source checked 2026-09-29: [refusals](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback). The source defines explicit successful refusals and advises discarding partial output; native billing remains provider-defined.
- No new product decisions. Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/anthropic-refusals.md).

## TDD plan

- Public HTTP and actual SDK cases first: empty refusal currently 502, text refusal lacks filter signal.
- Verify both paths, empty/text refusal forms, normal text parity, provider usage/missing/invalid states, backup not called, malformed/mixed content and implicit/explicit Deny/limits/required audit.
- Minimal native adapter change; focused tests, touched-file lint and full npm run check.

## Delivery

- Record red/green and full validation; publish ready PR with limitations.
- Risk: compatible null output intentionally discards text in explicit refusals; audit success means delivery success. Rich refusals and provider billing-category projections remain deferred.
- Rollback restores prior refusal incompatibility.

### Verification evidence

- Red: `node --experimental-strip-types test/anthropic-refusals.test.ts`: 3 expected failures, 3 passes; refusal outcome and empty-refusal SDK/accounting cases failed.
- Green: same command: 6 passes.
- `npm run check`: 720 passes, 1 optional external PostgreSQL integration skipped, 0 failures. Strict types, lint, document/link/contract/fixture checks and pinned schema integrity passed.
- Touched-file Biome with warnings as errors and whitespace checks passed. This branch starts from approved main and does not include pending PR #151.

### Approved Gemini integration

- Integrated merged PR #151, preserving both native contracts and additive documentation sections. `npm run check`: 725 passes, 1 optional external PostgreSQL integration skipped, 0 failures; all gates passed.
- Updated head awaits current CI/review. Original native Anthropic red/green behavior is unchanged.
