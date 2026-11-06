# Token mutation authority lifetime (#640)

1. Preserve existing SSO API, transport validation, IAM and audit. Add only a trusted single-grant host adapter; no session acquisition, renewal, UI or runtime activation.
2. Snapshot trusted request and expiry; check the clock before dispatch and after completion, including suspended timers. Dispose on logout/unmount. Never return a late secret.
3. Preserve singleflight and uncertain-outcome reconciliation lock. No authorize/reset method; constructing another adapter is not reconciliation. Fail closed on invalid clock/expiry and invalidate on 401/403.
4. RED/GREEN source and supported artifact: issue/revoke, suspended expiry, logout/expiry in flight, late secret, invalid expiry/clock, early timer, mutated grant, denial, unknown outcome.
5. Run tests, typecheck/lint/scripts/compatibility; publish dependent draft PR for exact-head review. No merge before required CI and formal approval.

## Host secret-clearing integration follow-up

6. Expose one terminal onInvalidate notification (expiry or disposal) so the owning UI can clear an already displayed one-time secret without duplicating authority timers. Never send credentials in notifications; contain observer errors and retain terminal abort semantics. No DOM, session acquisition or activation.
7. RED/GREEN source and supported artifact: expiry after successful issue notifies once, logout/denial notification and throwing observer during in-flight disposal. Integrate authority with real loopback HTTP, signed JWT, migrated embedded SQL and token verification/revocation; verify denied/audit-failure and unknown-outcome behavior separately from native browser or installed SQL.

## Existing catalog authority fail-closed integration defect (#639)

8. Before implementation, reproduce thrown/negative clocks and throwing cancellation against the existing catalog authority used by the management screen. Keep DOM ownership, session acquisition and runtime unchanged.
9. Make invalid clocks expire and clear protected snapshots, and make cancellation failures unable to prevent session abort or notification. Validate nonnegative epoch expiry. Preserve fresh grants, read-only transport and observer semantics.
10. Verify both source factories and supported browser artifacts with meaningful RED/GREEN; run focused authority/screen/API tests and static checks. Update this same PR, not another dependency stack. Native-browser/session acceptance remains blocked and distinct.

Execution: corrected regression fixture against original HEAD: 0 pass / 12 fail / 0 skip (throw/negative clock and cancellation defects). Initial SSO fixture ownership was corrected before this baseline. Final focused management + signed-HTTP/embedded-SQL suites: 270 pass / 0 fail / 0 skip. Typecheck, lint (42 warnings/196 infos; no errors), planning/link/fixture checks, schema compatibility and diff checks pass. No new native-browser, installed SQL, session or live-provider evidence.
