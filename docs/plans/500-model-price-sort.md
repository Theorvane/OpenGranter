# Support exact price model discovery sorting

## Issue and problem

- Issue: [#500](https://github.com/Theorvane/OpenGranter/issues/500), part of #116.
- Compatible discovery publishes base price strings but rejects the official price ordering modes. Number conversion would collapse distinct values, underflow tiny positive prices and overflow otherwise valid price sums.

## Scope and expected behavior

- Accept `pricing-low-to-high` and `pricing-high-to-low` on /api/v1/models. Compare the exact sum of prompt and completion base prices, which has the same order as their equally weighted mean; never round or calculate a billed cost.
- Preserve equivalent-spelling ties in catalog order and place missing metadata last in both directions as local guarantees. Ignore optional components, discounts and conditional overrides.
- Retain the full catalog validation, model/final-provider IAM, combined filters, sorting before paging, fixed relative continuations, fresh page policy, immutable snapshots and required private audit. No /v1 query, schema, pin, provider or billing changes.

## Design

- Existing prices are nonnegative decimal/scientific strings bounded to 128 UTF-16 units with finite numeric conversion. Underflowing positive strings and zero with huge exponents are valid and must not be treated as missing or rounded to zero for ordering.
- Build a sparse base-10 digit map for the two mantissas using BigInt positions, normalize carries in ascending position order, then compare nonzero digits from highest position downward. An absent next position receives at most one carry, so no exponent-sized zero run or power-of-ten allocation is needed. Bound work/storage by the input lengths, including enormous negative exponent gaps.
- Cache each immutable metadata object's sum key only within the request's comparator. Missing-value handling occurs before applying ascending/descending direction.
- The [official OpenAPI](https://openrouter.ai/openapi.json) /models sort description checked on 2026-10-18 selects the average base prompt/completion price; existing query pin v2 already includes both literals. Stable ties and missing basic aliases last are explicit local rules.
- Update [contract](../../contracts/model-price-order.md), [discovery contract](../../contracts/model-discovery-exploration.md), PRD, architecture, acceptance and compatibility notes. No new domain term or ADR is required for this reversible ordering extension.

## TDD plan

- Write public raw and installed OpenRouter/OpenAI SDK cases first and record unsupported-sort 400 failures.
- Verify exact mean ordering, stable/equivalent ties, free/known/missing values, long carry chains, equivalent exponents, precise fractions, huge finite components, extreme underflow/gaps and an independent bounded integer-unit ordering oracle.
- Cover combined filters/paging, relative continuations, current IAM/Deny, authentication/invalid/legacy query ordering, hidden malformed prices, required failures, source immutability and private audit metadata. Existing benchmark/newest/context order remains covered.
- Implement the minimal parser, exact comparator and gateway integration; format and run focused regressions plus plain `npm run check`.

## Delivery

- Publish the issue branch and plan-linked ready PR with red/green/full-check evidence and require approval/CI before merge.
- Limits: published base prices may be stale/inaccurate and do not incorporate token mix, conditional overrides, discounts or other charges. These sorts do not estimate a request bill or choose an inference candidate. Broader discovery, full #116 and unresolved #7 remain open.

## Verification evidence

- Red: `node --experimental-strip-types --test test/model-price-order.test.ts test/sdk-model-price-order.test.ts` before implementation produced 15 failures and one pass; supported price queries returned 400 instead of 200, including through installed SDKs.
- Green: the same initial 16 tests passed after implementation. The final suite adds a stable missing-metadata case and strengthens carry, overflow and ignored-charge fixtures: all 17 price tests pass.
- Regression: price, benchmark and discovery exploration raw/SDK suites pass all 118 tests.
- Full gate: `env -u NODE_NO_WARNINGS -u NODE_OPTIONS npm run check` with the Node 22 runtime on PATH passes type checking, lint, 6,661 tests (one optional external PostgreSQL test skipped), planning/link/contract/secret checks and all three pinned schema integrity checks. No global warning suppression is needed.
- No source pin, database migration, provider credential or live provider call changed. Review and CI are still required before merge.
