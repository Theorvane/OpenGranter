# Preserve CSV byte-order marks

## Issue and problem
Refs #642 / #637. The existing transport promises verbatim UTF-8 CSV, but the streaming TextDecoder silently strips the leading U+FEFF. Download consumers receive different text; a spreadsheet encoding marker is lost.

## Scope and expected behavior
Preserve an existing UTF-8 BOM; never insert one. Keep strict malformed-UTF-8 rejection, byte bounds, cancellation, authorization and server serialization unchanged. Only the previously delegated CSV transport is affected. No UI/workspace/session/download port or runtime activation.

## Design
Configure the existing streaming decoder to expose rather than consume the BOM. Decode split BOM and split non-ASCII sequences without altering bytes. No schema, pricing, formula mitigation or permission decisions. FE retains filter/pagination/download/expiry ownership. No new dependencies.

## TDD plan
Public client test with leading BOM split across byte chunks must initially fail because the returned CSV omits U+FEFF. Verify byte-for-byte re-encoding, embedded markers, ordinary UTF-8 and malformed truncated input. Run focused suite, typecheck, lint, planning checks and standard npm run check.

## Delivery
Update the export contract and PRD/architecture/acceptance references. Issue branch and exact-head review/CI before merge. Rollback changes decoder option only. Installed/provider/browser acceptance remains separate.
