# Filter model discovery by benchmark ranges

## Issue and problem

- Issue: [#502](https://github.com/Theorvane/OpenGranter/issues/502), part of #116.
- External clients can sort published Artificial Analysis indices but the six official minimum/maximum index query fields reject. Existing captured metadata already contains the relevant finite numbers or nulls.

## Scope and expected behavior

- Support min/max intelligence, coding and agentic index fields on /api/v1/models. Every supplied inclusive bound must match its corresponding captured score; missing/null scores cannot satisfy a bound. Without bounds, preserve current negative/missing-score behavior.
- Accept decimal/scientific nonnegative finite numbers with a 128 UTF-16 unit spelling bound. Use standard JavaScript numeric semantics, matching published numeric scores and SDK values; these are informational scores, not monetary values. Reject whitespace, signs before the coefficient, empty/null words, duplicate keys, unsupported names and reversed pairs after authentication but before catalog reads. Equal bounds are valid.
- Preserve complete hidden-catalog validation, enabled model/final-provider IAM, combined filters, all sorts, paging, current policy on every page, private required audit and snapshot capture. No inference/secret/limit/usage calls, legacy query expansion or storage changes.

## Design

- Parse validated query values into immutable per-index optional minimum/maximum ranges. Apply ranges to captured Artificial Analysis fields after IAM and before sorting/paging. Serialize numeric bounds canonically into fixed relative continuations; values may change spelling while preserving numeric meaning.
- Expand only model-query pin v2 to v3 with the six official inline numeric/null shapes and their nonnegative minimum. Fresh source also adds offset.schema.nullable:false while retaining the integer/null type array: capture this reviewed structural drift without changing runtime behavior. Removing this marker and the six additions must reconstruct v2 exactly. Record fresh fixed-host source/projection hashes and retrieval date, reject stale versions and test structural changes and malformed/missing/duplicate/inherited parameters. Request/response pins remain unchanged.
- Source: [official OpenAPI](https://openrouter.ai/openapi.json), inspected 2026-10-18. Local syntax/size limits and reversed-pair rejection are explicit restrictions. No score fetching, freshness assertion, provider ranking, cost or runtime capability guarantee follows.
- Update the PRD, architecture, acceptance, compatibility inventory and query/range contracts. No glossary change, costly architectural decision or new product question is required.

## TDD plan

- First add public HTTP and installed OpenRouter/OpenAI SDK tests for each index, minimum/maximum/equal pairs and composed discovery; verify expected 400 instead of 200 before implementation.
- Cover null/absent/negative/zero/fractional/extreme finite scores, all six fields together, inclusive edges, invalid syntax/reversed pairs, authentication ordering, current IAM/Deny, hidden malformed scores, dependency failures, audit mutation and private metadata.
- Extend independent schema shapes and drift cases before changing projector/pin; verify rejection of stale v2 even with valid hashes.
- Implement the minimal parser/range predicate/continuation and pin extension, format, run focused regressions and plain npm run check. No new packages.

## Delivery

- Issue-numbered branch, English plan-linked ready PR, recorded red/green/full-gate results and required approval/CI before merge.
- Risks: administrator scores can be stale/inaccurate and numeric precision is bounded by existing number semantics. Continuations reload current state rather than providing a stable snapshot. Roll back the query extension and pin together; no migration is involved. Full #116 and unresolved #7 remain open.

## Verification evidence

- Red before production changes: raw/SDK ranges plus independent query shapes produced 40 failures and 46 passes across 86 tests. Accepted range requests returned 400 instead of 200; the existing projection did not include the six expected fields.
- Fresh-source review detected the offset nullable:false marker. Added marker drift and historical projection assertions before refreshing the pin; the stale pin failed the expanded schema suite (55 failures, 20 passes).
- Green: all 224 range, query-schema/CLI, benchmark/price order and discovery exploration raw/SDK regressions pass. Removing v3 additions reproduces the exact v2 digest; removing prior exploration additions also reconstructs v1. The new projection matches the freshly downloaded official source.
- Full gate: with Node 22 on PATH, `env -u NODE_NO_WARNINGS -u NODE_OPTIONS npm run check` passes type checking, lint, 6,702 tests (one optional external PostgreSQL test skipped), planning/link/contract/fixture-secret checks and all three pin integrity checks. Two test-only type declarations were corrected after the first full gate stopped at type checking; no production type rule was weakened.
- Request/response pins remain byte-identical; no migration or live provider call is involved. Required CI and approval remain pending until PR review.
