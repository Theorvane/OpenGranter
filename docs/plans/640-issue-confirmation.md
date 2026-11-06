# Token issuance target and expiry review (#640)

1. Preserve existing authenticated token mutation, current IAM, atomic decision audit and unknown-outcome latch. No session, route, DDL, provider or deployment activation.
2. Add a request-free review showing the exact submitted principal, integer expiry and ISO UTC time before explicit issuance confirmation. Reject an unrepresentable date, never silently coerce, trim, round or retarget.
3. Cancel without a request; consume the captured intent before dispatch. All workspace notifications, opposite action, renewal, expiry, logout, unmount/disposal and new submissions invalidate detached review controls.
4. Establish meaningful RED/GREEN source and supported artifact cases for captured input, cancel, duplicate/stale clicks, lifecycle and invalid dates; update existing screen/host assertions to explicitly confirm.
5. Exercise actual signed test-JWT loopback HTTP with migrated PGlite: review/cancel leave credentials and audit untouched; confirm exact target; current Deny after review prevents issuance and records the denied decision.
6. Run focused tests, typecheck, lint, planning and compatibility validation; submit exact-head PR for independent formal approval and all required CI. Native-browser login, installed PostgreSQL and live-company SSO remain separate unmet gates.
