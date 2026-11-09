# Usage current-page failure recovery (#642)

1. Preserve the submitted usage filter/cursor and previous-page stack across read, cancel and CSV failure. Never consume unsubmitted form edits.
2. Keep existing first-page recovery separate; expose Retry current page only for transient unavailable/cancelled state. Invalid filters require correction.
3. Clear protected rows/details and revoke CSV URLs before retry; guard busy, detached, expired and disposed controls. Every retry uses existing fresh server IAM and required audit. No new authority/session, schema or deployment.
4. Meaningful RED/GREEN: failed second page -> exact retry -> previous, cancellation, export failure, stale controls, invalid filters, Deny and expiry. Extend signed SSO SQL HTTP integration for mandatory audit failure/recovery in source and built artifact.
5. Run focused tests, typecheck/lint/scripts/pinned compatibility, standard check and exact-head CI; independent formal approval before merge. Native browser proof is separate from artifact tests.
