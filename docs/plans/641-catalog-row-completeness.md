# Complete SQL catalog snapshots (#641)

## Issue and problem

Parent #637, implementation #641. The SQL reader uses Array.map, which skips missing rows. The SSO service then filters these holes, returning a successful empty or partial list and success audit for an incomplete snapshot. This is distinct from the HTTP service-result repair in #840.

## Scope and expected behavior

Reject an incomplete SQL row collection as catalog unavailable before visibility filtering or success audit. Preserve valid empty/dense snapshots, the 1000-row bound, duplicate validation, exact detail queries, current IAM and audit-failure precedence. No new permissions, browser session, runtime activation, schema or provider calls.

## Design

Iterate every SQL row through existing validation, building the result only after validation. Do not filter or compact holes: that hides a missing publication. Shared proxy/SSO readers receive the same invariant. Existing PRD catalog integrity and contracts/sso-model-catalog.md apply. No unresolved product decision is implemented; login/BFF approval remains separate.

## TDD plan

First add reader tests for leading/trailing/all-hole arrays and a signed-test-JWT plus migrated PGlite SSO public-handler test injecting an incomplete SQL adapter result. Expect current reader resolution and HTTP200 to fail assertions. Then replace the skipping map with complete iteration. Verify fixed503, no partial data, authenticated unavailable audit and audit failure precedence. Include valid empty list control and existing detail/proxy regressions.

## Delivery

Run targeted tests, TypeScript, lint, planning checks and full npm run check. Report local resource failures independently from remote CI. Exact-head required CI and independent formal approval are mandatory before merge. Rollback is an isolated code revert. Socket/IdP/installed PostgreSQL/provider E2E are not claimed from these tests.

## Execution evidence (2026-11-10)

- RED: shared reader did not reject incomplete rows; signed SSO public-handler integration returned 200 instead of 503 (2 failures, 24 passes).
- GREEN: reader plus signed-test-JWT/migrated-PGlite service and HTTP tests: 26 passes, zero failures/skips. Failure audit attribution and audit-unavailable precedence verified.
- TypeScript, full lint (existing diagnostics), planning/link/fixture-secret checks and whitespace check passed.
- Full npm run check is launched separately; completion is not claimed until its final log is read.
- Incomplete SQL results are injected adapter faults, not evidence that pg or installed PostgreSQL emitted sparse arrays. No company IdP/native-browser/installed/provider acceptance.
