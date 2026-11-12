# Usage review screen state (#642)

## Issue and problem

Issue #642 under #637. Existing authorized usage JSON and CSV clients lack a shared screen filter/page/loading/empty/error lifecycle. UI owners must not stitch mismatched CSV filters or retain stale identity data.

## Scope and expected behavior

1. Add an opt-in DOM-free coordinator over the existing signed-SSO request port; do not edit frontend-owned entry, DOM or builder files.
2. Capture filters once, discard supplied cursors on new searches, and retain exact opaque next/back cursors. Never collect all history.
3. Expose loading, ready, empty and safe failure snapshots. Hide rows during navigation and after auth failure or disposal.
4. Export the displayed page with identical filters only on explicit request. Cancel stale exports when filters/page/identity change; no automatic download.
5. Exercise real clients through the coordinator including redaction, denial, races and cancellation. Require exact-head CI and formal approval before merge.

## Design and dependencies

Caller supplies an already-authorized request port, not credentials or principal authority. Server IAM and mandatory durable audit remain authoritative. Terminal 401/403 require a new coordinator. Caller must dispose on identity change/expiry. No browser session, retention, mutation, schema, provider or deployment changes. Canonical pure-shared build integration and rendered browser acceptance remain frontend-owned prerequisites.

## TDD plan

Use an unavailable-only baseline; expect ready/empty, next/back and filtered explicit export failures, not missing module failures. Add delayed races, denial, observer errors, malformed filters, disposal and navigation retry. Run focused regression, full TypeScript and static/planning checks. Report existing aggregate local toolchain limits separately.

## Delivery and recovery

Additive module with no entry activation; revert without migration. Contract: contracts/management-usage-review.md. Update PRD, architecture and acceptance. Record tests, SHA and review separately from browser/session/deployment evidence.

Usage-specific contract: retain validated exact estimated/reported cost comparisons, original decimal strings, missing/partial token availability and independent possible-duplicate/possibly-billed markers. No totals or reconciliation are invented. JSON and CSV use the same existing canonical path with different format values.
