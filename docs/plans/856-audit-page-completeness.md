# Audit metadata page completeness (#856)

## Issue and problem
Refs #637 and #642. Array.map skips missing slots in untrusted SQL rows and injected audit pages. This can expose null JSON events or silently omit CSV evidence instead of rejecting the whole malformed page.

## Scope and expected behavior
Reject missing slots anywhere in bounded audit SQL results, including lookahead, and in the shared HTTP projection used by JSON and CSV. Keep dense empty and valid pages, existing ordering, filtering, audit:Read target authorization, mandatory audit and metadata redaction unchanged. No new authentication/session, DDL, content retention, listener activation or provider call.

## Design
Use Array.from to visit every slot through the existing validator, rather than duplicating field validation or filtering invalid evidence away. SQL validation remains private AuditHistoryUnavailable; public projection remains InvalidAuditHistoryQuery, contained by the existing HTTP error/audit boundary. No new domain terms or unresolved policy decisions are settled. Direct main6757eee, independent of unmerged UI and snapshot branches. Contract: contracts/audit-page-completeness.md; update PRD, architecture and acceptance.

## TDD plan
First reproduce sparse-only, first/middle/last holes and lookahead holes at SQL and projector boundaries; JSON and CSV HTTP reads must return503 and mandatory read-unavailable audit rather than200. Add dense valid and empty controls, redaction, Deny and audit-failure checks. Record meaningful RED before the smallest production patch. Run related focused tests, typecheck, lint, documentation and offline compatibility checks, then standard npm run check separately.

## Delivery
Exact HEAD CI plus independent formal approval required before merge. Rollback is limited to two collection traversal changes; no migration. Tests are local/fake-adapter and embedded SQL evidence, not live IdP, browser login, installed PostgreSQL or provider acceptance. Full PRD and UI/session integration remain open.

## Execution evidence

RED: /tmp/og-1230-red.log 11 tests, 9 expected failures, 2 controls pass, zero skips. SQL/projector failed to reject holes; public JSON and CSV incorrectly returned200. GREEN after two production traversal replacements: /tmp/og-1230-green.log 47/47 zero skips, including 12 new regression tests, real loopback JSON/CSV failure, existing embedded SQL keyset, HTTP and CSV cases. Typecheck passes. Remaining full-suite and CI results must be recorded separately; no full-suite success implied.
