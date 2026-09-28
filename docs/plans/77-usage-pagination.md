# Validate Complete Usage Pagination Boundaries

## Issue and problem

- Issue: #77
- Usage SQL and HTTP readers validate attribution/filter scope but accept duplicates, ascending rows, and records at/after the cursor. The SQL lookahead can falsely claim a continuation page. Internal cursor objects are not validated before SQL.

## Scope and expected behavior

Reject malformed cursors before SQL. Validate all normalized SQL rows, including lookahead, as strictly descending and before the requested cursor. Independently validate injected HTTP pages for JSON and CSV before constructing continuation or successful read audit. Keep principal/model/time permissions, projection, accounting fields, and cursor encoding unchanged.

## Design

Define descending order by occurrence time then UTF-8 byte order of attempt ID. PostgreSQL uses explicit C collation in both its tuple predicate and ORDER BY; application comparison uses UTF-8 buffers rather than JavaScript UTF-16 or locale ordering. See [ADR 0007](../adr/0007-usage-pagination-order.md). Share cursor validation and ordered-sequence validation through the usage module. Require a strict decrease from cursor and every preceding record, preventing duplicates and invalid lookahead. Preserve validation for malformed records and scope.

This defines previously unspecified tie ordering across deployments. Existing cursor encoding remains, but clients must restart pagination at rollout. The existing default-collation index may require sorting under a different locale; benchmark before adding an index. No schema migration, accounting mutation, or provider replay is introduced.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [HTTP cases](../../contracts/gateway_cases.json). The prior audit model-filter PR remains independent and is not a dependency.

## TDD plan

Reproduce accepted duplicate/ascending/equal-or-newer-than-cursor rows at SQL and HTTP boundaries, including hidden lookahead. Add malformed internal cursor cases that must never query SQL. Test valid equal-time UTF-8 ordering with punctuation and Unicode in real embedded PostgreSQL and injected JSON/CSV pages. Implement the smallest shared checks and matching SQL collation, retain denial/projection/accounting tests, then run focused tests and npm run check.

## Delivery

Issue and fresh branch from main, plan/ADR, red regressions, implementation, green evidence, documents/contracts, full gate, ready PR. Rollout restarts pagination; rollback also restarts cursors because tie ordering differs. No migration or index is added without measurements.

## Verification

Completed with the evidence below.

- Red: direct `node --experimental-strip-types` runs of the usage HTTP/SQL tests reproduced accepted duplicate/ascending/cursor-invalid pages (200 instead of 503) and malformed internal cursors reaching SQL.
- A further red HTTP case reproduced the cursor attempt reappearing with an older timestamp; seeding duplicate detection with the cursor attempt fixes it.
- Green: the same direct commands passed all 18 HTTP and 11 SQL tests. The existing second-page fake was corrected to return an empty next page instead of repeating the first record; its continuation assertions remain intact.
- `npm run check` passed TypeScript, Biome, 292 tests, and planning/link/contract/fixture validation. One real PostgreSQL integration test skipped locally without its explicit database URL; CI provisions PostgreSQL. This branch starts from main independently of pending PR #76.
- `git diff --check` passed. Restart pagination at rollout/revert; benchmark the explicit C-collation sort before choosing a new index under a non-C database locale.

### Integration after review

PR #76 was approved and merged. Integrated its audit model filtering into this branch while preserving both sets of additive documentation and HTTP cases. The combined `npm run check` passed TypeScript, Biome, 299 tests, and planning/link/contract/fixture checks; one real PostgreSQL integration skipped locally without its explicit database URL. No additional production behavior was introduced by conflict resolution.
