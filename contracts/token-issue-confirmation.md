# Exact token issuance review

- Existing Issue token submits only a local review. Display exact principal ID, exact integer epoch milliseconds and ISO UTC expiry using text nodes. This is not validation of principal existence, ownership, lifetime allowance or IAM.
- A representable integer date is required for the preview. No rounding, timezone guessing or default expiry. The server remains responsible for current time, lifetime caps, principal state and authorization.
- Confirm issuance sends exactly the captured principal/expiry once through the existing workspace. Later form edits cannot retarget; cancel dispatches nothing.
- Each new issue/revoke submission and every workspace notification invalidates the prior review. Detached confirm/cancel, double click, renewal, expiry, logout, hide, unmount and disposal cannot send stale intentions.
- Required current IAM, transactional audit, one-time secret handling and reconciliation lock are unchanged. No API/session/runtime/DDL/provider change.

Acceptance: meaningful RED then GREEN source/artifact DOM cases and signed-test-JWT HTTP/migrated-PGlite evidence. These do not constitute native-browser or installed acceptance.
