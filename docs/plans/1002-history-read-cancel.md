# Explicit history page-read cancellation

## Issue and problem
Issue #1002, part of #637/#642. Pending Usage/Audit JSON reads offer no explicit cancellation without changing filters, screen or identity. Users must wait for timeout even when they no longer need a query.

## Scope and expected behavior
While a page read is loading, expose Cancel history request. Abort only that tab's JSON/CSV transport, clear rows and pagination, publish neutral cancelled status and retain the attempted applied filters and opaque cursor path for explicit Retry. Preserve unapplied input drafts. Never automatically replay. Late ignored-abort success or denial cannot repopulate data or terminate the current workspace. A fresh current 401/403 still clears both tabs. No permission widening, session/runtime/DDL/entry activation, deployment or paid provider changes.

## Design
Own usage-review.ts, audit-review.ts, history-app.ts, one public-boundary test file and this plan/contract appendix. Reuse existing stop/revision/client invalidation and retry(attempt) semantics. cancelRead is inert unless loading and not blocked; stop before publishing to suppress reentrant and late completions. Do not restore previously displayed rows as authorization evidence. Alternative navigation/dispose loses workspace state; no new backend API is needed. Base #1001 exact5f4838a66d01fcc1f227ec4d963805939af41c9d. No unresolved policy choices or new domain terms. Existing PRD/acceptance history loading/error and private-data lifetime requirements apply; contract: contracts/management-history-workspace.md.

## TDD plan
First RED public mount lacks Cancel history request. Cover both tabs, pending headers and streaming body, exact same-page retry, preserved drafts, stale success/401/403, current denial, retained callbacks after retry/disposal, no download/auto replay and inert nonloading review cancellation. GREEN smallest review/UI wiring. Run focused regression, changed-file Biome, planning/contracts/schema and standard npm run check; report unavailable checks accurately. Browser evidence must be separate from synthetic mount tests and installed E2E.

## Delivery and rollback
Draft child of #1001; exact-head required CI, independent formal approval and parent dependencies before merge. Remove the cancel action/methods to roll back; no migration. Original full PRD, installed login/persistence/provider/browser acceptance and operational handoff remain open.

## Verification checkpoint
Initial RED: 0 pass /16 expected failures (missing public cancel control/method), /tmp/og-1100-1002-red.log. Final GREEN16/16; eight-file serial regression99 pass /0 fail /0 skip, /tmp/og-1100-1002-regression.log. Invalid pagination fixture (empty nonterminal page, audit row not matching model scope) was corrected before final success; no production parser weakening. Changed-file Biome, planning/links/contracts/secret scan, all6 pinned schemas and diffcheck pass. Production browser-only bundle builds. Standard npm run check launched through complete native npm shim but typecheck was Killed; downstream stages did not run, no aggregate/typecheck pass. /tmp/og-1100-1002-fullcheck.log. Chromium page tools time out and visible renderer remains error9; no new browser success claimed. No installed access URL, login/IdP/PostgreSQL/provider/deployment/E2E acceptance or paid/production calls. All completion gates remain open.
