# Explicit canonical history CSV cancellation

## Issue and problem
Issue #1000; original #637/#642 safe CSV and loading/error workflow. Existing reviews support cancelExport, but canonical UI users can only cancel by leaving the tab.

## Scope and expected behavior
While preparing CSV, expose Cancel CSV export. Stop only the export; preserve JSON records, applied scope, pagination and unapplied drafts. Distinguish cancellation from unavailability. A fresh explicit download rechecks the same authorized scope. No automatic retry/download, permission widening, session/runtime/DDL/activation, provider or deployment changes. An already saved file cannot be recalled.

## Design
Own history-app.ts, a new public-mount test, this plan and contracts/management-history-workspace.md. Reuse both review cancelExport implementations, their abort/revision protection and shared denial handling. Button uses existing generation/identity guards. Do not cancel JSON or recreate the workspace. Source #999 exact f21453ecdde5375ca3d205a7abf0bdf9681d1bd6 is the parent; no competing session/catalog/backend changes. No new domain terms or unresolved policy choices.

## TDD plan
RED public mount: missing Cancel CSV export in both tabs. Cover aborting pending headers and streamed body, late ignored-abort success/403, preserved rows/drafts/scope, explicit retry and current 401/403, local export failure, retired cancel callbacks after retry/disposal, no cancel button outside loading. GREEN smallest UI wiring and distinct sanitized cancellation text. Run serial focused/regression tests, changed-file lint, planning/contracts and full check. Native browser probe uses production bundle and synthetic HTTP only; report separately from installed E2E.

## Delivery and rollback
Draft child of #999, independent exact-head approval, required CI and satisfied parent ancestry before merge. Remove the button/message branch to roll back, no migration. Installed company login/PostgreSQL/provider acceptance and original full PRD remain incomplete. No production deployment or paid calls.

## Verification checkpoint
Initial RED: 0 pass / 12 expected failures (missing cancel action), /tmp/og-1000-1000-red.log. Small UI change GREEN initial12/12; added populated-page/pagination coverage, final serial regression70 pass /0 fail /0 skip in /tmp/og-1000-1000-regression-final2.log. Changed-file Biome, planning/links/contracts/fixture scan and all6 pinned compatibility schemas pass. Native browser bundle built; page tools timed out and desktop Chromium showed renderer error9, so no successful new native-browser verification is claimed. The loopback probe is synthetic, not an installed user access URL.

Standard npm run check did not reach typecheck: first native npm bootstrap lacked walk-up-path; alternate complete npm started the standard command but its nested npm failed Permission denied. Preserved /tmp/og-1000-1000-npm-bootstrap.log and /tmp/og-1000-1000-fullcheck.log. No local fullcheck/typecheck pass; exact-head CI remains required. No real login/IdP/PostgreSQL/provider/deployment/E2E claim.
