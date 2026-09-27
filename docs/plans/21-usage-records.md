# Per-Attempt Usage Record Contract

## Issue and problem

- Issue: [#21](https://github.com/Theorvane/OpenGranter/issues/21)
- Route attempts are audited, but there is no canonical usage record for later storage or queries. A caller could otherwise treat missing provider usage as zero, confuse an estimate with an upstream charge, or merge several possibly billed attempts into one request.

## Scope and expected behavior

- In scope: a pure TypeScript builder for one immutable-shape usage record per upstream attempt, explicit token availability, safe attribution, separate cost sources, possible-billing and duplicate flags, and public-boundary tests.
- Out of scope: durable storage, user queries, provider generation reconciliation, price calculation, currency conversion, retention, and gateway persistence wiring.
- The caller provides request and attempt IDs, fixed principal/credential/policy attribution, model alias, route kind, upstream model, selected candidate, actual inference provider when known, time, latency, outcome, and possible-billing/duplicate flags. The builder copies only approved metadata. Actual inference provider remains `null` when unreported; a selected candidate is not mistaken for the actual provider.
- Token usage is `reported`, `partial`, `missing`, or `invalid`; missing and invalid counts are `null`, never zero. Valid numbers are nonnegative safe integers. Estimated cost and upstream-billed cost are independent optional decimal amounts with currency and distinct provenance. A missing cost stays `null`. Invalid cost or required attribution fails with a fixed safe error.

## Design

- Add `src/usage/record-usage.ts` with a pure `buildUsageRecord` function and narrow input/output types. Validate untrusted usage and monetary values at this boundary; never copy arbitrary provider fields, prompt/response bodies, keys, or token strings into the record.
- Use decimal strings for money so the builder never rounds through floating-point arithmetic. Estimated cost requires a price-version reference; upstream-billed cost records whether OpenRouter or a direct provider reported it. The builder does not calculate either.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [harness](../harness.md), and the existing [Usage ledger glossary term](../../CONTEXT.md) to clarify per-attempt attribution. No ADR is needed.

## TDD plan

- First test a complete record with known token counts and separate estimate/billed amounts. Expect the new module to be missing before implementation.
- Add tests for missing, partial, and invalid token usage; unknown actual provider; failed possibly billed attempts with distinct attempt IDs; invalid money and identity; and exclusion of extra content and secret fields.
- Implement the smallest pure builder, then run focused red/green tests, `npm run format`, `npm run check`, and `git diff --check`.

## Delivery

- Commit on `feat/21-usage-records` with the contributor DCO and assistance trailers. Open a ready PR linked to #21 and this plan.
- Usage records will not yet appear in a dashboard or durable ledger. Gateway wiring must write each attempt idempotently and handle a post-call write failure without replaying inference.
