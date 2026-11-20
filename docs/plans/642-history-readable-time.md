# Readable UTC history timestamps

## Issue and problem
Refs #642 and #637. Usage/Audit review accepts UTC bounds but lists and details show only Unix milliseconds, obstructing investigation without an external converter.

## Scope and expected behavior
Show explicit ISO UTC with millisecond precision on both canonical history lists and record details. Retain exact Unix milliseconds in details and unchanged API/CSV, cursors and filters. Valid nonnegative safe integers outside the JavaScript Date range remain reviewable with a fixed UTC-unavailable message, not a fabricated date or failed page. No local-time inference, new authority, session/runtime/DDL, activation or provider calls.

## Design
A shared pure management formatter is used only after existing response/record validation. Use Date ISO rendering with range checking; do not change accepted server timestamps or interpret missing values as epoch. Existing detail raw timestamps remain authoritative. No unresolved policy choices are settled. See PRD, architecture, acceptance and contracts/history-readable-time.md.

## TDD plan
Public mount tests first: both Usage and Audit list/detail render UTC, exact raw milliseconds remain, epoch works, out-of-Date-range safe integer does not remove a valid row, refresh Deny clears data, failed refresh clears data, disposal clears roots. Expect missing UTC assertions to fail before implementation. Then implement the small formatter and update the three render sites. Run focused serial tests, strict typecheck/lint, docs/compatibility, public browser bundle and native browser checks. Run npm run check; distinguish local resource failure from CI success.

## Delivery
Extend existing unmerged draft #980, preserving parent dependencies. No deployed/IdP/PostgreSQL/provider acceptance claim. Rollback is removing only this presentation change; no stored data changes.

## Verification
Original source with corrected valid fixture records: 0 PASS / 6 FAIL (missing UTC list/detail). Final focused serial suites: 75 PASS / 0 FAIL / 0 SKIP, including signed synthetic JWT + migrated PGlite real HTTP pagination/CSV, exact UTC + raw timestamp assertions, fresh Deny and mandatory read audits. Native Chromium with Asia/Seoul timezone: both tabs list/detail exact UTC, epoch, out-of-Date-range fallback, failed refresh, Deny clearing and disposal PASS. Strict TypeScript, full lint (existing warnings/information), docs/links/fixture scan, offline compatibility pins and browser bundle PASS. Literal npm run check passed typecheck/lint but gateway-disk-recovery worker was SIGKILLed; no full-check pass. Only its verified own npm/sh/Node descendant tree was stopped; no browser/display process targeted. Local synthetic browser/HTTP is not company IdP, installed PostgreSQL or provider acceptance.
