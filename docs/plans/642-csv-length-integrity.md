# CSV response length integrity

## Issue and problem
Refs #642 / #637. The owned CSV transport bounds bytes but accepts clean EOF even when an unencoded response declares a different byte length. A partial CSV can look complete to a download consumer.

## Scope and expected behavior
Reject truncated or overlong identity-encoded CSV with unavailable, without exposing partial text. Preserve successful verbatim text, existing authorization/error states, cancellation and pagination. Compare UTF-8 bytes, not JavaScript character counts. Encoded Fetch responses are decoded by the browser, so their wire Content-Length must not be compared to decoded bytes; retain existing decoded size/deadline bounds. No UI/session/runtime/database changes.

## Design
Reuse the bounded stream byte counter. Check a supplied length at EOF only for absent or identity Content-Encoding. Do not parse or reserialize CSV. Missing lengths remain valid. No new permission, accounting or deployment decisions.

## TDD plan
1. Reproduce clean premature EOF and excess bytes through public read() with a failing unavailable assertion.
2. Cover multibyte split streams with exact byte length, absent length and compressed response length mismatch.
3. Add the smallest EOF check, run focused tests, typecheck, lint and npm run check.

## Delivery
Update the export contract and PRD/architecture/acceptance notes. Require exact-head CI and independent formal approval. Rollback removes the EOF check only. Browser/provider/installed acceptance remains open.
