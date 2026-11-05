# Usage previous-page navigation (#642)

## Issue and problem
1. Issue #642 requires paginated usage inspection. The current screen only moves forward; operators must reset to the first page and repeat requests to revisit an attempt.

## Scope and expected behavior
2. Add Previous page on successfully reached later pages, using previously requested filters and opaque cursors. Refetch through the authorized transport; never cache private rows or fabricate cursors. CSV continues to export the visible page.
3. Reset navigation on new filters, first-page retry, failed list/export, connect, identity clear and disposal. Ignore superseded responses. No session, listener, schema, production or paid-provider change.

## Design
4. Keep a memory-only stack of prior query filters. Publish it only after successful loading. Hide navigation while loading or exporting. No new API contract or authorization decision. See [contract](../../contracts/usage-previous-page.md); parent PR702 is required and all release gates remain open.

## TDD plan
5. First add a three-page regression proving backward refetch and unchanged cursor values; expect missing Previous page before implementation. Cover filters, failure, identity switch and CSV page consistency. Run focused usage UI/client/HTTP tests, full typecheck/lint, planning checks and full check.

## Delivery
6. Implement minimal screen changes in a separate worktree; submit stacked draft PR with exact-head independent review and required CI. Rollback is removal of this local navigation only. Structural DOM and actual HTTP evidence do not substitute for browser or installed acceptance.
