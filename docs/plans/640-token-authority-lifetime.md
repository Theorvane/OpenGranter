# Token mutation authority lifetime (#640)

1. Preserve existing SSO API, transport validation, IAM and audit. Add only a trusted single-grant host adapter; no session acquisition, renewal, UI or runtime activation.
2. Snapshot trusted request and expiry; check the clock before dispatch and after completion, including suspended timers. Dispose on logout/unmount. Never return a late secret.
3. Preserve singleflight and uncertain-outcome reconciliation lock. No authorize/reset method; constructing another adapter is not reconciliation. Fail closed on invalid clock/expiry and invalidate on 401/403.
4. RED/GREEN source and supported artifact: issue/revoke, suspended expiry, logout/expiry in flight, late secret, invalid expiry/clock, early timer, mutated grant, denial, unknown outcome.
5. Run tests, typecheck/lint/scripts/compatibility; publish dependent draft PR for exact-head review. No merge before required CI and formal approval.
