# Usage history filters

## Issue and problem

- Issue: #57
- The PRD requires usage review by principal, model, and time. The existing API supports principal and keyset pagination only.

## Scope and expected behavior

- GET /v1/usage accepts optional model alias `model`, inclusive `from_ms`, and exclusive `to_ms` occurrence-time filters.
- Times are canonical nonnegative safe-integer decimal milliseconds. When both bounds exist, from_ms must be smaller than to_ms. Model aliases are nonblank, at most 256 characters, without control characters. Duplicate or unknown parameters remain invalid.
- PostgreSQL binds all values, always retains the authorized principal filter, and applies the same filters on every page. Clients repeat filters with the cursor; a cursor cannot widen the principal scope.
- Both storage and HTTP validate every returned record against the filters. Malformed input returns 400; out-of-filter data returns safe 503 with required audit. Permission semantics and the response shape remain unchanged.
- No schema change, aggregation, CSV export, audit-history filtering, or query index redesign.

## Design

- Add an optional filter contract to UsageHistoryQuery and share its validation/matching functions across parser, reader, and HTTP boundary.
- Bind model against the record's modelAlias field and time against occurred_at_ms. Retain the existing principal/time index and keyset ordering.
- Update PRD, architecture, acceptance, and gateway contract cases.
- Different filter sets may use a cursor as a position; the filter predicates and principal predicate still constrain results. Signed filter-bound cursors are not introduced.

## TDD plan

- First parser test must fail because the existing parser rejects the new parameters.
- Verify inclusive/exclusive time boundaries, model filtering, equal-time pagination, foreign-principal exclusion, invalid ranges, malformed aliases, SQL literal binding, and out-of-filter result rejection.
- Cover authenticated success, explicit/default Deny, malformed queries, unavailable storage, and audit failure through the HTTP boundary.
- Implement the smallest change and run npm run check.

## Delivery

- Record red/green evidence, full checks, and query-performance limitations in the PR.
- Model filtering uses JSONB extraction and may need a dedicated index after measured workload evidence. Existing calls remain compatible.
