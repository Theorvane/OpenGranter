# Audit history time filters

## Issue and problem

- Issue: #61
- Audit reviewers need occurrence-time ranges; the current API supports principal and event-ID pagination only.

## Scope and expected behavior

- GET /v1/audit accepts optional inclusive from_ms and exclusive to_ms epoch milliseconds, with canonical nonnegative safe-integer decimal values.
- When both bounds exist, start must precede end. Unknown/repeated parameters remain invalid.
- Preserve audit:Read on the target principal, required audit writes, response shape, and descending event-ID pagination. Clients repeat filters on every page.
- SQL always binds principal, cursor, and time bounds. Storage and HTTP reject every out-of-range result rather than returning partial data.
- No schema change, timestamp-order change, retention, anonymous search, content auditing, or export.

## Design

- Add a small pure audit time-range contract, parsing, validation, and matching helpers shared by storage and HTTP.
- Extend the reader query and add an optional range argument to page projection, retaining old callers.
- Event ID still defines pagination order; occurrence-time filters need not be monotonic with event ID.
- Update PRD, architecture, acceptance, and gateway scenarios. A dedicated time index awaits workload evidence.

## TDD plan

- First HTTP test expects 200 for a valid range and fails with existing 400.
- Exercise start/end boundaries, equal-time filtered pages, foreign principals, invalid ranges, malformed bounds, default/explicit Deny, audit failures, and out-of-range storage/injected pages.
- Implement the smallest change and run npm run check.

## Delivery

- Record red/green and check evidence in the PR.
- This issue starts from main and is independent of pending PRs #58 and #60.
- Timing filters operate on recorded occurrence timestamps, not a claim of upstream clock accuracy. Cursor positions never widen principal scope.

## Integration update

Merge current main after usage-filter PR #58 landed; retain usage and audit range contracts and revalidate the combined suite.
